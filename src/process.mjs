#!/usr/bin/env node
// Turns a raw Allure `allure-results/` directory into the JSON a static
// dashboard can render, and (optionally) merges it with prior history so
// trend charts and flaky-test detection work across runs.
//
// Zero external dependencies on purpose: this runs inside the GitHub Action
// on every consumer's runner, so no npm install step, no supply-chain surface.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const STATUSES = ['passed', 'failed', 'broken', 'skipped', 'unknown'];
const SEVERITY_ORDER = ['blocker', 'critical', 'normal', 'minor', 'trivial'];

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

async function readJsonSafe(p, fallback) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else {
      await fs.copyFile(s, d);
    }
  }
}

function labelValue(labels, name) {
  const hit = (labels || []).find((l) => l.name === name);
  return hit ? hit.value : undefined;
}

function hashOf(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function sanitizeId(id) {
  return String(id).replace(/[^A-Za-z0-9_.-]/g, '_') || 'run';
}

async function loadRawResults(resultsDir) {
  const files = (await fs.readdir(resultsDir)).filter((f) => f.endsWith('-result.json'));
  const results = [];
  for (const f of files) {
    const data = await readJsonSafe(path.join(resultsDir, f), null);
    if (data) results.push(data);
  }
  return results;
}

// Fixtures (@Before/@After, beforeEach/afterEach, setup/teardown, ...) are
// never part of a test's own `-result.json` — Allure records them separately
// in `-container.json` files as `befores`/`afters`, linked to the tests they
// wrap via `children` (a list of test uuids). This is where a screenshot
// taken in a teardown hook on failure (a very common pattern — TestNG
// `@AfterMethod`, Playwright/Cypress `afterEach`, RSpec `after`, ...) ends up,
// so without reading containers that screenshot is invisible no matter what
// the test's own result says.
async function loadContainers(resultsDir) {
  const files = (await fs.readdir(resultsDir)).filter((f) => f.endsWith('-container.json'));
  const containers = [];
  for (const f of files) {
    const data = await readJsonSafe(path.join(resultsDir, f), null);
    if (data) containers.push(data);
  }
  return containers;
}

function normalizeAttachment(raw) {
  return {
    name: raw.name || 'attachment',
    type: raw.type || '',
    source: raw.source || null,
  };
}

function normalizeStep(raw) {
  const start = raw.start || 0;
  const stop = raw.stop || start;
  return {
    name: raw.name || 'step',
    status: STATUSES.includes(raw.status) ? raw.status : 'unknown',
    durationMs: Math.max(0, stop - start),
    attachments: (raw.attachments || []).map(normalizeAttachment),
    steps: (raw.steps || []).map(normalizeStep),
  };
}

function normalizeFixture(raw, phase) {
  return { phase, ...normalizeStep(raw) };
}

// Maps a test's uuid to the before/after fixtures that wrapped it, across
// every container in the run (one container can wrap many tests, e.g. a
// shared `describe` block's hooks; a test's teardown can also be split
// across more than one container).
function buildFixtureMap(containers) {
  const map = new Map();
  for (const c of containers) {
    const fixtures = [
      ...(c.befores || []).map((f) => normalizeFixture(f, 'before')),
      ...(c.afters || []).map((f) => normalizeFixture(f, 'after')),
    ];
    if (!fixtures.length) continue;
    for (const childUuid of c.children || []) {
      if (!map.has(childUuid)) map.set(childUuid, []);
      map.get(childUuid).push(...fixtures);
    }
  }
  return map;
}

function normalizeTest(raw) {
  const labels = raw.labels || [];
  const suite = labelValue(labels, 'suite') || labelValue(labels, 'parentSuite') || 'Uncategorized';
  const parentSuite = labelValue(labels, 'parentSuite') || suite;
  const severity = (labelValue(labels, 'severity') || 'normal').toLowerCase();
  const status = STATUSES.includes(raw.status) ? raw.status : 'unknown';
  const start = raw.start || raw.time?.start || 0;
  const stop = raw.stop || raw.time?.stop || start;
  const fullName = raw.fullName || raw.name || raw.uuid || 'unnamed test';
  const historyId = raw.historyId || hashOf(fullName);

  return {
    uuid: raw.uuid || hashOf(fullName + Math.random()),
    historyId,
    name: raw.name || fullName,
    fullName,
    suite,
    parentSuite,
    severity: SEVERITY_ORDER.includes(severity) ? severity : 'normal',
    feature: labelValue(labels, 'feature'),
    epic: labelValue(labels, 'epic'),
    status,
    durationMs: Math.max(0, stop - start),
    message: raw.statusDetails?.message || null,
    trace: raw.statusDetails?.trace || null,
    flaky: !!raw.flaky,
    steps: (raw.steps || []).map(normalizeStep),
    attachments: (raw.attachments || []).map(normalizeAttachment),
  };
}

// Allure attachments only carry a `source` filename pointing at a sibling
// file in the raw results dir (e.g. `<uuid>-attachment.png`) — they are never
// inlined. Walk every test's own attachments plus every nested step's, copy
// each referenced file into the generated site, and rewrite `source` into a
// `path` the dashboard can fetch/render (images) or link to (everything
// else). Missing files (never uploaded, wrong path, etc.) are left with no
// `path` so the UI can say so instead of rendering a broken link.
async function resolveAttachments(tests, resultsDir, outputDir, runId) {
  const relDir = path.posix.join('data', 'attachments', sanitizeId(runId));
  const destDir = path.join(outputDir, ...relDir.split('/'));
  let destDirReady = false;
  const seenNames = new Set();

  async function copyOne(att) {
    const source = att.source;
    delete att.source; // internal raw-results filename — never meaningful to the client
    if (!source) return;
    const src = path.join(resultsDir, source);
    if (!(await pathExists(src))) return;
    if (!destDirReady) {
      await fs.mkdir(destDir, { recursive: true });
      destDirReady = true;
    }
    let destName = sanitizeId(source);
    while (seenNames.has(destName)) destName = `${hashOf(destName)}_${destName}`;
    seenNames.add(destName);
    await fs.copyFile(src, path.join(destDir, destName));
    att.path = `./${relDir}/${destName}`;
  }

  async function walk(node) {
    for (const att of node.attachments || []) await copyOne(att);
    for (const step of node.steps || []) await walk(step);
    for (const fixture of node.fixtures || []) await walk(fixture);
  }

  for (const t of tests) await walk(t);
}

function classifyCategory(test, categories) {
  if (test.status !== 'failed' && test.status !== 'broken') return null;
  for (const cat of categories || []) {
    const statusOk = !cat.matchedStatuses || cat.matchedStatuses.includes(test.status);
    if (!statusOk) continue;
    const msgOk = !cat.messageRegex || (test.message && safeRegexTest(cat.messageRegex, test.message));
    const traceOk = !cat.traceRegex || (test.trace && safeRegexTest(cat.traceRegex, test.trace));
    if ((cat.messageRegex || cat.traceRegex) ? (msgOk || traceOk) : true) {
      return cat.name;
    }
  }
  return test.status === 'failed' ? 'Product defects' : 'Test defects';
}

function safeRegexTest(pattern, str) {
  try {
    return new RegExp(pattern, 's').test(str);
  } catch {
    return false;
  }
}

function pct(n, total) {
  return total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
}

function emptyStatusCounts() {
  return { passed: 0, failed: 0, broken: 0, skipped: 0, unknown: 0 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resultsDir = args.results;
  const outputDir = args.output || 'allure-dashboard';
  const historyDir = args.history || '';
  const runId = args['run-id'] || String(Date.now());
  const runLabel = args['run-label'] || runId;
  const maxHistory = parseInt(args['max-history'] || '100', 10);
  const title = args.title || 'Allure Dashboard';
  const siteTemplate = args['site-template'];

  if (!resultsDir || !(await pathExists(resultsDir))) {
    console.error(`allure-results directory not found: ${resultsDir}`);
    process.exit(1);
  }

  const rawResults = await loadRawResults(resultsDir);
  const containers = await loadContainers(resultsDir);
  const categories = await readJsonSafe(path.join(resultsDir, 'categories.json'), []);
  const tests = rawResults.map(normalizeTest);

  const fixtureMap = buildFixtureMap(containers);
  for (const t of tests) t.fixtures = fixtureMap.get(t.uuid) || [];

  // ---- prior history / flaky tracking -----------------------------------
  const priorHistory = historyDir
    ? await readJsonSafe(path.join(historyDir, 'history.json'), [])
    : [];
  const flakyMap = historyDir
    ? await readJsonSafe(path.join(historyDir, 'flaky-history.json'), {})
    : {};

  for (const test of tests) {
    const entry = flakyMap[test.historyId] || { name: test.fullName, observations: [] };
    entry.name = test.fullName;
    const prevObs = entry.observations[entry.observations.length - 1];
    if (prevObs && prevObs.status !== test.status && test.status !== 'skipped' && prevObs.status !== 'skipped') {
      test.flaky = true;
    }
    entry.observations.push({ runId, status: test.status });
    if (entry.observations.length > 20) entry.observations = entry.observations.slice(-20);
    flakyMap[test.historyId] = entry;
  }

  for (const key of Object.keys(flakyMap)) {
    const obs = flakyMap[key].observations;
    let transitions = 0;
    for (let i = 1; i < obs.length; i++) {
      if (obs[i].status !== obs[i - 1].status) transitions++;
    }
    flakyMap[key].flakyScore = obs.length > 1 ? Math.round((transitions / (obs.length - 1)) * 100) / 100 : 0;
  }

  const flakyTests = tests.filter((t) => t.flaky);

  // ---- aggregates ----------------------------------------------------------
  const counts = emptyStatusCounts();
  for (const t of tests) counts[t.status]++;
  const total = tests.length;

  const suiteMap = new Map();
  for (const t of tests) {
    const key = t.suite;
    if (!suiteMap.has(key)) suiteMap.set(key, { name: key, ...emptyStatusCounts(), total: 0 });
    const s = suiteMap.get(key);
    s[t.status]++;
    s.total++;
  }
  const suites = [...suiteMap.values()].sort((a, b) => b.failed + b.broken - (a.failed + a.broken) || b.total - a.total);

  const severityMap = new Map();
  for (const sev of SEVERITY_ORDER) severityMap.set(sev, { name: sev, ...emptyStatusCounts(), total: 0 });
  for (const t of tests) {
    const s = severityMap.get(t.severity) || severityMap.get('normal');
    s[t.status]++;
    s.total++;
  }
  const severities = SEVERITY_ORDER.map((s) => severityMap.get(s)).filter((s) => s.total > 0);

  const categoryMap = new Map();
  for (const t of tests) {
    const cat = classifyCategory(t, categories);
    if (!cat) continue;
    if (!categoryMap.has(cat)) categoryMap.set(cat, { name: cat, count: 0, tests: [] });
    const c = categoryMap.get(cat);
    c.count++;
    if (c.tests.length < 25) c.tests.push({ name: t.name, suite: t.suite, message: t.message });
  }
  const failureCategories = [...categoryMap.values()].sort((a, b) => b.count - a.count);

  const slowest = [...tests].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10)
    .map((t) => ({ name: t.name, suite: t.suite, status: t.status, durationMs: t.durationMs }));

  const durationTotal = tests.reduce((sum, t) => sum + t.durationMs, 0);
  const passRate = pct(counts.passed, total);

  const runSummary = {
    runId,
    label: runLabel,
    timestamp: new Date().toISOString(),
    total,
    ...counts,
    passRate,
    durationMs: durationTotal,
    flakyCount: flakyTests.length,
  };

  const history = [runSummary, ...priorHistory].slice(0, maxHistory);

  // ---- write site shell (needed before attachments can be copied in) ------
  if (siteTemplate && (await pathExists(siteTemplate))) {
    await copyDir(siteTemplate, outputDir);
  } else {
    await fs.mkdir(outputDir, { recursive: true });
  }
  const dataDir = path.join(outputDir, 'data');
  const runsDir = path.join(dataDir, 'runs');
  await fs.mkdir(runsDir, { recursive: true });

  await resolveAttachments(tests, resultsDir, outputDir, runId);

  const latest = {
    ...runSummary,
    title,
    suites,
    severities,
    categories: failureCategories,
    slowest,
    flakyTests: flakyTests.map((t) => ({
      name: t.name,
      suite: t.suite,
      status: t.status,
      severity: t.severity,
      history: (flakyMap[t.historyId]?.observations || []).slice(-10),
    })),
    tests: tests.map((t) => ({
      name: t.name,
      fullName: t.fullName,
      suite: t.suite,
      severity: t.severity,
      status: t.status,
      durationMs: t.durationMs,
      flaky: t.flaky,
      message: t.message,
      trace: t.trace,
      steps: t.steps,
      attachments: t.attachments,
      fixtures: t.fixtures,
    })),
  };

  // ---- write site ------------------------------------------------------
  // Carry forward full per-run snapshots for every run still retained in
  // `history` (after the max-history cap), so the dashboard can browse back
  // to any previous run, not just its rollup numbers. Snapshots live under
  // data/runs/<runId>.json and must be persisted across CI runs the same
  // way history.json and flaky-history.json are (via --history).
  const priorRunsDir = historyDir ? path.join(historyDir, 'runs') : null;
  const retainedIds = new Set(history.map((r) => r.runId));
  if (priorRunsDir && (await pathExists(priorRunsDir))) {
    const files = await fs.readdir(priorRunsDir);
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      if (retainedIds.has(id) && sanitizeId(id) + '.json' === f && id !== runId) {
        await fs.copyFile(path.join(priorRunsDir, f), path.join(runsDir, f));
      }
    }
  }

  await fs.writeFile(path.join(dataDir, 'latest.json'), JSON.stringify(latest, null, 2));
  await fs.writeFile(path.join(runsDir, `${sanitizeId(runId)}.json`), JSON.stringify(latest, null, 2));
  await fs.writeFile(path.join(dataDir, 'history.json'), JSON.stringify(history, null, 2));
  await fs.writeFile(path.join(dataDir, 'flaky-history.json'), JSON.stringify(flakyMap, null, 2));
  await fs.writeFile(path.join(dataDir, 'meta.json'), JSON.stringify({ title, generatedAt: new Date().toISOString() }, null, 2));

  // ---- outputs -----------------------------------------------------------
  const outputLines = [
    `total=${total}`,
    `passed=${counts.passed}`,
    `failed=${counts.failed}`,
    `broken=${counts.broken}`,
    `skipped=${counts.skipped}`,
    `pass-rate=${passRate}`,
    `flaky-count=${flakyTests.length}`,
    `site-path=${outputDir}`,
  ];
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, outputLines.join('\n') + '\n');
  } else {
    console.log(outputLines.join('\n'));
  }

  console.log(`Allure dashboard written to ${outputDir} (${total} tests, ${passRate}% pass rate, ${flakyTests.length} flaky).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
