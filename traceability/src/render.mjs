// Shapes the aggregated data (see aggregate.mjs) into the plain, JSON-safe
// objects written to data/summary.json, data/requirements.json and
// data/tests.json. Pure — no fs — so it's node:test-able; process.mjs does
// the actual writing.

import { resolveGroupValues } from './aggregate.mjs';

// Every label the report's "Coverage by" tabs can group requirements by.
// Sent per-requirement (see requirementEntry below) so the static site can
// filter the Matrix tab on a bar click without needing each test's full
// label set client-side — resolveGroupValues() already mirrors exactly how
// coverageByGroup() itself decided a requirement's group.
const GROUP_LABELS = ['epic', 'feature', 'story'];

// `dashboardUrl#test=<historyId>` is a deep link the Allure Dashboard action
// understands (it pre-fills the search box with the historyId and expands
// the matching row) when both actions are used together and the dashboard
// is new enough to read the hash. Left out entirely when dashboardUrl isn't
// configured, rather than linking to a page that can't do anything with it.
function testLink(historyId, dashboardUrl) {
  if (!dashboardUrl) return null;
  const base = String(dashboardUrl).replace(/#.*$/, '').replace(/\/+$/, '');
  return `${base}#test=${encodeURIComponent(historyId)}`;
}

function testSummary(t, dashboardUrl) {
  return {
    testCaseId: t.testCaseId,
    name: t.name,
    fullName: t.fullName,
    status: t.status,
    severity: t.severity,
    suite: t.suite,
    durationMs: t.durationMs,
    uuid: t.uuid,
    historyId: t.historyId,
    hasExplicitTestCaseId: t.hasExplicitTestCaseId,
    dashboardUrl: testLink(t.historyId, dashboardUrl),
  };
}

function requirementEntry(r, dashboardUrl) {
  const groups = {};
  for (const label of GROUP_LABELS) groups[label] = resolveGroupValues(r, label);
  return {
    id: r.id,
    key: r.key,
    title: r.title,
    epic: r.epic,
    feature: r.feature,
    priority: r.priority,
    status: r.status,
    testCount: r.tests.length,
    groups,
    tests: r.tests.map((t) => testSummary(t, dashboardUrl)),
  };
}

export function buildRequirementsData(requirements, dashboardUrl) {
  return requirements.map((r) => requirementEntry(r, dashboardUrl));
}

export function buildUnknownData(unknown, dashboardUrl) {
  return unknown.map((r) => requirementEntry(r, dashboardUrl));
}

export function buildOrphanTestsData(orphanTests, dashboardUrl) {
  return orphanTests.map((t) => testSummary(t, dashboardUrl));
}

// Every test, traced or not — the "Tests" reverse view. Steps ride only
// here (not in requirements.json's nested summaries) so a test covering
// several requirements doesn't repeat its step tree once per requirement;
// the Matrix tab looks them up by uuid.
export function buildTestsData(tests, dashboardUrl) {
  return tests.map((t) => ({ ...testSummary(t, dashboardUrl), requirementIds: t.requirementIds, steps: t.steps || [] }));
}

export function buildSummary({
  title,
  generatedAt,
  coverage,
  denominatorSource,
  orphans,
  unknown,
  ignoredValues,
  byEpic,
  byFeature,
  byStory,
  annotationCoverage,
  totalTests,
  retryCounts,
  dashboardUrl,
}) {
  const retriedCount = [...retryCounts.values()].filter((n) => n > 1).length;
  return {
    title,
    generatedAt,
    denominatorSource, // 'file' (requirements-file is the full list) or 'results' (every id seen in results)
    requirements: coverage,
    totalTests,
    orphanTests: { count: orphans.count, rate: orphans.rate },
    unknownRequirements: unknown.length,
    ignoredValues: ignoredValues.length,
    retriedTests: retriedCount,
    byEpic,
    byFeature,
    byStory,
    annotationCoverage,
    dashboardUrl: dashboardUrl ? String(dashboardUrl).replace(/#.*$/, '').replace(/\/+$/, '') : null,
  };
}
