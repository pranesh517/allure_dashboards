import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTest } from '../src/extract.mjs';
import { buildRequirementsData, buildOrphanTestsData, buildTestsData, buildSummary } from '../src/render.mjs';

const CFG = { requirement: { annotation: 'requirement', source: 'auto', pattern: null }, testcase: { annotation: null } };

function t(overrides) {
  return normalizeTest(
    {
      uuid: overrides.uuid || 'u',
      historyId: overrides.historyId || overrides.uuid || 'u',
      name: overrides.name || 'test',
      fullName: overrides.fullName || overrides.name || 'test',
      status: overrides.status || 'passed',
      labels: (overrides.requirements || []).map((v) => ({ name: 'requirement', value: v })),
      links: [],
    },
    CFG,
  );
}

test('buildRequirementsData nests test summaries with a dashboard deep link', () => {
  const test1 = t({ uuid: 'a', historyId: 'h-a', requirements: ['REQ-1'] });
  const requirements = [{ id: 'REQ-1', key: 'REQ-1', title: 'T', epic: 'E', feature: 'F', priority: 'high', status: 'passing', tests: [test1] }];
  const out = buildRequirementsData(requirements, 'https://example.com/dashboard/');
  assert.equal(out.length, 1);
  assert.equal(out[0].testCount, 1);
  assert.equal(out[0].tests[0].dashboardUrl, 'https://example.com/dashboard#test=h-a');
});

test('buildRequirementsData omits dashboardUrl entirely when not configured', () => {
  const test1 = t({ uuid: 'a', requirements: ['REQ-1'] });
  const requirements = [{ id: 'REQ-1', key: 'REQ-1', title: null, epic: null, feature: null, priority: null, status: 'passing', tests: [test1] }];
  const out = buildRequirementsData(requirements, null);
  assert.equal(out[0].tests[0].dashboardUrl, null);
});

test('buildOrphanTestsData and buildTestsData shape their rows', () => {
  const orphan = t({ uuid: 'a' });
  assert.equal(buildOrphanTestsData([orphan], null)[0].testCaseId, orphan.testCaseId);
  const traced = t({ uuid: 'b', requirements: ['REQ-1'] });
  const rows = buildTestsData([orphan, traced], null);
  assert.deepEqual(rows[0].requirementIds, []);
  assert.deepEqual(rows[1].requirementIds, ['REQ-1']);
});

test('buildSummary counts retried tests (group size > 1) without exposing the raw Map', () => {
  const summary = buildSummary({
    title: 'T',
    generatedAt: '2026-01-01T00:00:00.000Z',
    coverage: { total: 1, covered: 1, notCovered: 0, failing: 0, coveragePercent: 100 },
    denominatorSource: 'file',
    orphans: { count: 2, rate: 40 },
    unknown: [{ id: 'REQ-9' }],
    ignoredValues: [{ value: 'x' }],
    byEpic: [],
    byFeature: [],
    totalTests: 5,
    retryCounts: new Map([['h1', 1], ['h2', 3], ['h3', 2]]),
  });
  assert.equal(summary.retriedTests, 2);
  assert.equal(summary.unknownRequirements, 1);
  assert.equal(summary.ignoredValues, 1);
  assert.equal(typeof JSON.stringify(summary), 'string');
});
