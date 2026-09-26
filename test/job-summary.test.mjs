import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobSummary, diffRuns, mdCell } from '../src/job-summary.mjs';

function run(label, tests, extra = {}) {
  const counts = { passed: 0, failed: 0, broken: 0, skipped: 0, unknown: 0 };
  for (const t of tests) counts[t.status]++;
  return {
    title: 'Dash',
    label,
    total: tests.length,
    ...counts,
    passRate: tests.length ? Math.round((counts.passed / tests.length) * 1000) / 10 : 0,
    durationMs: 1500,
    flakyCount: tests.filter((t) => t.flaky).length,
    tests,
    ...extra,
  };
}

const t = (historyId, status, extra = {}) => ({ historyId, name: historyId, suite: 'S', status, flaky: false, message: null, ...extra });

test('diffRuns classifies new failures, still failing, fixed and newly flaky by historyId', () => {
  const prev = [t('a', 'passed'), t('b', 'failed'), t('c', 'broken'), t('d', 'passed'), t('e', 'failed', { flaky: true })];
  const curr = [t('a', 'failed', { flaky: true }), t('b', 'broken'), t('c', 'passed'), t('d', 'passed'), t('e', 'passed', { flaky: true }), t('new', 'failed')];
  const d = diffRuns(curr, prev);
  assert.deepEqual(d.newFailures.map((x) => x.historyId), ['a', 'new']);
  assert.deepEqual(d.stillFailing.map((x) => x.historyId), ['b']);
  assert.deepEqual(d.fixed.map((x) => x.historyId), ['c', 'e']);
  assert.deepEqual(d.newlyFlaky.map((x) => x.historyId), ['a'], 'e was already flaky last run; new has no previous run');
});

test('diffRuns: failing -> skipped is not "fixed"', () => {
  const d = diffRuns([t('a', 'skipped')], [t('a', 'failed')]);
  assert.equal(d.fixed.length, 0);
});

test('buildJobSummary: headline with pass-rate delta and change counts', () => {
  const previous = run('#1', [t('a', 'passed'), t('b', 'passed')]);
  const current = run('#2', [t('a', 'failed', { message: 'boom\nsecond line' }), t('b', 'passed')]);
  const md = buildJobSummary({ current, previous });
  assert.match(md, /^### Dash — #2\n/);
  assert.match(md, /❌ \*\*50% pass rate\*\* \(-50 pts vs #1\)/);
  assert.match(md, /\*\*1\*\* new failure · \*\*0\*\* newly flaky · \*\*0\*\* fixed · \*\*0\*\* still failing/);
  assert.match(md, /#### 🔴 New failures \(1\)\n\n\| Test \| Suite \| Status \| Error \|\n\| --- \| --- \| --- \| --- \|\n\| a \| S \| failed \| boom \|/);
  assert.doesNotMatch(md, /Fixed|Newly flaky \(/);
});

test('buildJobSummary: no previous run says how to get the comparison', () => {
  const md = buildJobSummary({ current: run('#1', [t('a', 'passed')]), previous: null });
  assert.match(md, /✅ \*\*100% pass rate\*\* · 1 test · /);
  assert.match(md, /set `history-path`/);
});

test('buildJobSummary: dashboard-url links the run and each test (http/https only)', () => {
  const previous = run('#1', [t('a b', 'passed')]);
  const current = run('#2', [t('a b', 'failed')]);
  const md = buildJobSummary({ current, previous, dashboardUrl: 'https://x.github.io/repo/' });
  assert.match(md, /\[a b\]\(https:\/\/x\.github\.io\/repo\/#test=a%20b\)/);
  assert.match(md, /\[Open the dashboard ↗\]\(https:\/\/x\.github\.io\/repo\/\)/);
  assert.doesNotMatch(buildJobSummary({ current, previous, dashboardUrl: 'javascript:alert(1)' }), /javascript:/);
});

test('buildJobSummary caps each list and says how many more', () => {
  const ids = Array.from({ length: 13 }, (_, i) => `t${i}`);
  const md = buildJobSummary({
    current: run('#2', ids.map((id) => t(id, 'failed'))),
    previous: run('#1', ids.map((id) => t(id, 'passed'))),
  });
  assert.equal((md.match(/\| S \| failed \|/g) || []).length, 10);
  assert.match(md, /…and 3 more\./);
});

test('mdCell neutralises pipes, HTML, markdown and newlines from test data', () => {
  assert.equal(mdCell('a|b <img src=x> *c*\n[d](e)'), 'a\\|b &lt;img src=x&gt; \\*c\\* \\[d\\](e)');
});
