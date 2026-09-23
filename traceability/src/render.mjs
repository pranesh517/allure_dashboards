// Shapes the aggregated data (see aggregate.mjs) into the plain, JSON-safe
// objects written to data/summary.json, data/requirements.json and
// data/tests.json. Pure — no fs — so it's node:test-able; process.mjs does
// the actual writing.

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
  return {
    id: r.id,
    key: r.key,
    title: r.title,
    epic: r.epic,
    feature: r.feature,
    priority: r.priority,
    status: r.status,
    testCount: r.tests.length,
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

// Every test, traced or not — the "Tests" reverse view.
export function buildTestsData(tests, dashboardUrl) {
  return tests.map((t) => ({ ...testSummary(t, dashboardUrl), requirementIds: t.requirementIds }));
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
    dashboardUrl: dashboardUrl ? String(dashboardUrl).replace(/#.*$/, '').replace(/\/+$/, '') : null,
  };
}
