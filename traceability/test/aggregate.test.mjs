import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTest } from '../src/extract.mjs';
import {
  pct,
  dedupeRetries,
  buildRequirementIndex,
  deriveStatus,
  mergeRequirements,
  computeCoverage,
  computeOrphanTests,
  collectIgnoredValues,
  coverageByGroup,
} from '../src/aggregate.mjs';

const CFG = { requirement: { annotation: 'requirement', source: 'auto', pattern: null }, testcase: { annotation: null } };

function t(overrides) {
  return normalizeTest(
    {
      uuid: overrides.uuid || 'u',
      historyId: overrides.historyId || overrides.uuid || 'u',
      name: overrides.name || 'test',
      fullName: overrides.fullName || overrides.name || 'test',
      status: overrides.status || 'passed',
      start: overrides.start ?? 0,
      stop: overrides.stop ?? 0,
      labels: [
        ...(overrides.requirements || []).map((v) => ({ name: 'requirement', value: v })),
        ...(overrides.severity ? [{ name: 'severity', value: overrides.severity }] : []),
        ...(overrides.epic ? [{ name: 'epic', value: overrides.epic }] : []),
        ...(overrides.feature ? [{ name: 'feature', value: overrides.feature }] : []),
      ],
      links: [],
    },
    CFG,
  );
}

test('pct handles zero total without dividing by zero', () => {
  assert.equal(pct(0, 0), 0);
  assert.equal(pct(1, 4), 25);
  assert.equal(pct(1, 3), 33.3);
});

test('dedupeRetries keeps the result with the latest stop time, counts the group', () => {
  const raw = [
    { historyId: 'h1', status: 'failed', start: 0, stop: 100 },
    { historyId: 'h1', status: 'passed', start: 200, stop: 300 },
    { historyId: 'h2', status: 'passed', start: 0, stop: 50 },
  ];
  const { tests, retryCounts } = dedupeRetries(raw);
  assert.equal(tests.length, 2);
  const h1 = tests.find((r) => r.historyId === 'h1');
  assert.equal(h1.status, 'passed');
  assert.equal(retryCounts.get('h1'), 2);
  assert.equal(retryCounts.get('h2'), 1);
});

test('buildRequirementIndex: a test covering two requirements is indexed under both', () => {
  const tests = [t({ uuid: 'a', requirements: ['REQ-1', 'REQ-2'] }), t({ uuid: 'b', requirements: ['REQ-1'] })];
  const index = buildRequirementIndex(tests);
  assert.deepEqual([...index.keys()].sort(), ['REQ-1', 'REQ-2']);
  assert.equal(index.get('REQ-1').tests.length, 2);
  assert.equal(index.get('REQ-2').tests.length, 1);
});

test('deriveStatus precedence: any failed/broken outranks passed', () => {
  assert.equal(deriveStatus([t({ status: 'passed' }), t({ status: 'failed' })]), 'failing');
  assert.equal(deriveStatus([t({ status: 'passed' }), t({ status: 'broken' })]), 'failing');
});

test('deriveStatus: all passed -> passing; all skipped -> skipped; mix -> partial; none -> not-covered', () => {
  assert.equal(deriveStatus([t({ status: 'passed' }), t({ status: 'passed' })]), 'passing');
  assert.equal(deriveStatus([t({ status: 'skipped' })]), 'skipped');
  assert.equal(deriveStatus([t({ status: 'passed' }), t({ status: 'skipped' })]), 'partial');
  assert.equal(deriveStatus([]), 'not-covered');
});

test('mergeRequirements with a requirements-file: file rows are the full list, unmatched become not-covered', () => {
  const tests = [t({ uuid: 'a', requirements: ['REQ-1'], status: 'passed' })];
  const index = buildRequirementIndex(tests);
  const rows = [
    { id: 'REQ-1', key: 'REQ-1', title: 'Login works', epic: null, feature: null, priority: 'high' },
    { id: 'REQ-2', key: 'REQ-2', title: 'Logout works', epic: null, feature: null, priority: null },
  ];
  const { requirements, unknown, denominatorSource } = mergeRequirements(index, rows);
  assert.equal(denominatorSource, 'file');
  assert.equal(requirements.length, 2);
  const req1 = requirements.find((r) => r.id === 'REQ-1');
  const req2 = requirements.find((r) => r.id === 'REQ-2');
  assert.equal(req1.status, 'passing');
  assert.equal(req2.status, 'not-covered');
  assert.deepEqual(unknown, []);
});

test('mergeRequirements: an id used by a test but absent from the file is "unknown", not silently in the matrix', () => {
  const tests = [t({ uuid: 'a', requirements: ['REQ-9'] })];
  const index = buildRequirementIndex(tests);
  const rows = [{ id: 'REQ-1', key: 'REQ-1', title: null, epic: null, feature: null, priority: null }];
  const { requirements, unknown } = mergeRequirements(index, rows);
  assert.equal(requirements.length, 1);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].id, 'REQ-9');
});

test('mergeRequirements without a file: every id seen in results is the list, denominator is "results"', () => {
  const tests = [t({ uuid: 'a', requirements: ['REQ-1'] }), t({ uuid: 'b', requirements: ['REQ-2'] })];
  const index = buildRequirementIndex(tests);
  const { requirements, denominatorSource } = mergeRequirements(index, []);
  assert.equal(denominatorSource, 'results');
  assert.equal(requirements.length, 2);
});

test('mergeRequirements: file id matching is case-insensitive, file casing wins for display', () => {
  const tests = [t({ uuid: 'a', requirements: ['req-1'] })];
  const index = buildRequirementIndex(tests);
  const rows = [{ id: 'REQ-1', key: 'REQ-1', title: null, epic: null, feature: null, priority: null }];
  const { requirements } = mergeRequirements(index, rows);
  assert.equal(requirements[0].id, 'REQ-1');
  assert.equal(requirements[0].tests.length, 1);
});

test('computeCoverage: covered counts any linked test; coveragePercent only counts all-passing requirements', () => {
  const requirements = [
    { status: 'passing' },
    { status: 'failing' },
    { status: 'partial' },
    { status: 'not-covered' },
  ];
  const c = computeCoverage(requirements);
  assert.equal(c.total, 4);
  assert.equal(c.covered, 3); // passing + failing + partial all have >=1 test
  assert.equal(c.notCovered, 1);
  assert.equal(c.failing, 1);
  assert.equal(c.coveragePercent, 25); // only the 1 passing / 4 total
});

test('computeOrphanTests: tests with no requirement id, sorted worst severity/status first', () => {
  const tests = [
    t({ uuid: 'a', requirements: ['REQ-1'] }), // traced, excluded
    t({ uuid: 'b', severity: 'minor', status: 'passed' }),
    t({ uuid: 'c', severity: 'blocker', status: 'passed' }),
    t({ uuid: 'd', severity: 'blocker', status: 'failed' }),
  ];
  const { tests: orphans, count, rate } = computeOrphanTests(tests);
  assert.equal(count, 3);
  assert.equal(rate, 75);
  assert.deepEqual(orphans.map((o) => o.uuid), ['d', 'c', 'b']);
});

test('collectIgnoredValues dedupes identical (value, source, test) triples', () => {
  const tests = [
    { uuid: 'a', name: 'A', ignoredRequirementValues: [{ value: 'x', source: 'label' }, { value: 'x', source: 'label' }] },
    { uuid: 'b', name: 'B', ignoredRequirementValues: [{ value: 'x', source: 'label' }] },
  ];
  const out = collectIgnoredValues(tests);
  assert.equal(out.length, 2);
});

test('coverageByGroup: groups by requirements-file column when present, else by the tests\' own label', () => {
  const t1 = t({ uuid: 'a', requirements: ['REQ-1'], epic: 'Checkout' });
  const requirements = [
    { id: 'REQ-1', epic: 'Billing', feature: null, tests: [t1], status: 'passing' }, // file wins over the test's own epic label
    { id: 'REQ-2', epic: null, feature: null, tests: [], status: 'not-covered' },
  ];
  const byEpic = coverageByGroup(requirements, 'epic');
  const billing = byEpic.find((g) => g.name === 'Billing');
  const unassigned = byEpic.find((g) => g.name === 'Unassigned');
  assert.equal(billing.total, 1);
  assert.equal(unassigned.total, 1);
});

test('coverageByGroup: falls back to the union of covering tests\' label values when the file has none', () => {
  const t1 = t({ uuid: 'a', requirements: ['REQ-1'], epic: 'Checkout' });
  const requirements = [{ id: 'REQ-1', epic: null, feature: null, tests: [t1], status: 'passing' }];
  const byEpic = coverageByGroup(requirements, 'epic');
  assert.equal(byEpic.length, 1);
  assert.equal(byEpic[0].name, 'Checkout');
});
