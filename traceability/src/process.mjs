#!/usr/bin/env node
// CLI entrypoint: reads raw Allure results (+ an optional requirements-file),
// runs them through extract.mjs / aggregate.mjs / render.mjs / csv-export.mjs,
// and writes a static traceability-matrix site + data/*.json + traceability.csv.
//
// Zero external dependencies, same as the sibling dashboard action — nothing
// to `npm install` on the runner. Self-contained: everything this needs lives
// under traceability/, so the folder works even checked out on its own.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { normalizeTest } from './extract.mjs';
import {
  dedupeRetries,
  buildRequirementIndex,
  mergeRequirements,
  computeCoverage,
  computeOrphanTests,
  collectIgnoredValues,
  coverageByGroup,
} from './aggregate.mjs';
import { parseRequirementsText } from './requirements-io.mjs';
import { buildRequirementsData, buildUnknownData, buildOrphanTestsData, buildTestsData, buildSummary } from './render.mjs';
import { buildTraceabilityCsv } from './csv-export.mjs';

const SOURCES = ['auto', 'label', 'link', 'tag'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '';
      args[key] = val;
    }
  }
  return args;
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function loadRawResults(resultsDir) {
  const files = (await fs.readdir(resultsDir)).filter((f) => f.endsWith('-result.json'));
  const results = [];
  for (const f of files) {
    try {
      results.push(JSON.parse(await fs.readFile(path.join(resultsDir, f), 'utf8')));
    } catch {
      // an unparsable result file is skipped, not fatal — matches the dashboard action
    }
  }
  return results;
}

// Thrown for both input-validation problems and the fail-gates at the end.
// Caught once at the bottom of this file so a `fail()` call always halts
// execution immediately (a bare `process.exit()` inside a helper doesn't
// guarantee the caller stops before its next line runs).
class TraceabilityError extends Error {}

function fail(message) {
  throw new TraceabilityError(message);
}

function compilePattern(raw, inputName) {
  if (!raw) return null;
  try {
    return new RegExp(raw);
  } catch (e) {
    fail(`"${inputName}" is not a valid regular expression: ${raw}\n${e.message}`);
  }
}

function annotationConfig(args, prefix) {
  const annotation = args[`${prefix}-annotation`] || null;
  const source = args[`${prefix}-source`] || 'auto';
  if (!SOURCES.includes(source)) {
    fail(`"${prefix}-source" must be one of ${SOURCES.join(', ')}, got "${source}".`);
  }
  const pattern = compilePattern(args[`${prefix}-id-pattern`], `${prefix}-id-pattern`);
  return { annotation, source, pattern };
}

async function loadRequirementsFile(filePath) {
  if (!filePath) return [];
  if (!(await pathExists(filePath))) fail(`requirements-file not found: ${filePath}`);
  const ext = path.extname(filePath).toLowerCase();
  const format = ext === '.json' ? 'json' : ext === '.csv' ? 'csv' : null;
  if (!format) fail(`requirements-file must end in .csv or .json, got: ${filePath}`);
  const text = await fs.readFile(filePath, 'utf8');
  try {
    return parseRequirementsText(text, format);
  } catch (e) {
    fail(`requirements-file (${filePath}): ${e.message}`);
  }
}

function parseBoolInput(v) {
  return String(v).trim().toLowerCase() === 'true';
}

function writeOutputs(lines) {
  if (process.env.GITHUB_OUTPUT) return fs.appendFile(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  return Promise.resolve();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const resultsDir = args.results;
  if (!resultsDir || !(await pathExists(resultsDir))) fail(`allure-results directory not found: ${resultsDir}`);

  const requirementCfg = annotationConfig(args, 'requirement');
  if (!requirementCfg.annotation) fail('"requirement-annotation" is required.');
  const testcaseCfg = annotationConfig(args, 'testcase');

  const requirementRows = await loadRequirementsFile(args['requirements-file']);

  let minCoverage = null;
  if (args['min-coverage'] !== undefined && args['min-coverage'] !== '') {
    minCoverage = Number(args['min-coverage']);
    if (!Number.isFinite(minCoverage) || minCoverage < 0 || minCoverage > 100) {
      fail(`"min-coverage" must be a number between 0 and 100, got: ${args['min-coverage']}`);
    }
  }
  const failOnUncovered = parseBoolInput(args['fail-on-uncovered'] || 'false');
  const failOnFailing = parseBoolInput(args['fail-on-failing'] || 'false');

  const outputDir = args.output || 'traceability-report';
  const title = args.title || 'Traceability Matrix';
  const dashboardUrl = args['dashboard-url'] || null;

  // ---- extract + aggregate ------------------------------------------------
  const rawResults = await loadRawResults(resultsDir);
  const { tests: dedupedRaw, retryCounts } = dedupeRetries(rawResults);
  const tests = dedupedRaw.map((raw) => normalizeTest(raw, { requirement: requirementCfg, testcase: testcaseCfg }));

  const requirementIndex = buildRequirementIndex(tests);
  const { requirements, unknown, denominatorSource } = mergeRequirements(requirementIndex, requirementRows);
  const coverage = computeCoverage(requirements);
  const orphans = computeOrphanTests(tests);
  const ignoredValues = collectIgnoredValues(tests);
  const byEpic = coverageByGroup(requirements, 'epic');
  const byFeature = coverageByGroup(requirements, 'feature');

  // ---- write site shell, then data ----------------------------------------
  const siteTemplate = args['site-template'];
  if (siteTemplate && (await pathExists(siteTemplate))) {
    await copyDir(siteTemplate, outputDir);
  } else {
    await fs.mkdir(outputDir, { recursive: true });
  }
  const dataDir = path.join(outputDir, 'data');
  await fs.mkdir(dataDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const summary = buildSummary({
    title,
    generatedAt,
    coverage,
    denominatorSource,
    orphans,
    unknown,
    ignoredValues,
    byEpic,
    byFeature,
    totalTests: tests.length,
    retryCounts,
  });
  const requirementsData = buildRequirementsData(requirements, dashboardUrl);
  const unknownData = buildUnknownData(unknown, dashboardUrl);
  const orphanTestsData = buildOrphanTestsData(orphans.tests, dashboardUrl);
  const testsData = buildTestsData(tests, dashboardUrl);

  await fs.writeFile(path.join(dataDir, 'summary.json'), JSON.stringify(summary));
  await fs.writeFile(path.join(dataDir, 'requirements.json'), JSON.stringify({ requirements: requirementsData, unknown: unknownData }));
  await fs.writeFile(path.join(dataDir, 'tests.json'), JSON.stringify({ tests: testsData, orphanTests: orphanTestsData, ignoredValues }));
  await fs.writeFile(path.join(outputDir, 'traceability.csv'), buildTraceabilityCsv({ requirements, orphanTests: orphans.tests }));

  // ---- outputs -------------------------------------------------------------
  await writeOutputs([
    `total-requirements=${coverage.total}`,
    `covered-requirements=${coverage.covered}`,
    `uncovered-requirements=${coverage.notCovered}`,
    `failing-requirements=${coverage.failing}`,
    `coverage-percent=${coverage.coveragePercent}`,
    `orphan-tests=${orphans.count}`,
    `site-path=${outputDir}`,
  ]);

  console.log(
    `Traceability matrix written to ${outputDir} (${coverage.total} requirements, ${coverage.coveragePercent}% coverage, ${coverage.notCovered} not covered, ${orphans.count} orphan tests).`,
  );

  // ---- fail gates ------------------------------------------------------------
  // Checked last, after everything is written, so the report is still there to
  // look at even when the step fails the job.
  const failures = [];
  if (minCoverage !== null && coverage.coveragePercent < minCoverage) {
    failures.push(`coverage ${coverage.coveragePercent}% is below the minimum ${minCoverage}%`);
  }
  if (failOnUncovered && coverage.notCovered > 0) {
    failures.push(`${coverage.notCovered} requirement(s) have no tests`);
  }
  if (failOnFailing && coverage.failing > 0) {
    failures.push(`${coverage.failing} requirement(s) have a failing or broken linked test`);
  }
  if (failures.length) fail(failures.join('; '));
}

main().catch((e) => {
  const message = e instanceof TraceabilityError ? e.message : e.stack || String(e);
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
