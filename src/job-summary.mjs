// Builds the Markdown written to $GITHUB_STEP_SUMMARY: this run's numbers,
// and what changed since the previous run in history — new failures, newly
// flaky tests, fixed tests. Pure (no fs, no env) so it's node:test-able;
// process.mjs decides whether and where to write it.
//
// "Previous run" is the latest.json carried in via history-path, so the
// comparison is only as meaningful as that history: without history-path
// there's nothing to compare against and the summary says so.

const FAILING = new Set(['failed', 'broken']);
const MAX_ROWS = 10;
const MAX_MESSAGE = 140;

// Test names and error messages are untrusted test data landing in Markdown
// that GitHub renders (with a limited HTML subset): neutralise table pipes,
// HTML, and line breaks so one test can't break or inject into the table.
export function mdCell(value) {
  return String(value ?? '')
    .replace(/\r?\n|\r/g, ' ')
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    .replace(/\|/g, '\\|')
    .replace(/[`*_[\]]/g, '\\$&')
    .trim();
}

function firstLine(message) {
  if (!message) return '';
  const line = String(message).split(/\r?\n/).find((l) => l.trim()) || '';
  return line.length > MAX_MESSAGE ? `${line.slice(0, MAX_MESSAGE - 1)}…` : line;
}

function signed(n, digits = 1) {
  const r = Number(n.toFixed(digits));
  if (r === 0) return '±0';
  return r > 0 ? `+${r}` : `${r}`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// Only http(s) — a dashboard-url is workflow config, but it still ends up
// as a clickable link.
function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href.replace(/#.*$/, '').replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

function testName(t, dashboardUrl) {
  const name = mdCell(t.name);
  return dashboardUrl ? `[${name}](${dashboardUrl}/#test=${encodeURIComponent(t.historyId)})` : name;
}

// Compares two runs' test lists by historyId (Allure's stable cross-run id).
// A test that's new this run counts as a new failure if it fails — it didn't
// fail before — but can't be "fixed" or "newly flaky".
export function diffRuns(currentTests, previousTests) {
  const prev = new Map((previousTests || []).map((t) => [t.historyId, t]));
  const newFailures = [];
  const stillFailing = [];
  const fixed = [];
  const newlyFlaky = [];
  for (const t of currentTests) {
    const p = prev.get(t.historyId);
    const failingNow = FAILING.has(t.status);
    const failingBefore = p ? FAILING.has(p.status) : false;
    if (failingNow && !failingBefore) newFailures.push(t);
    else if (failingNow && failingBefore) stillFailing.push(t);
    else if (!failingNow && failingBefore && t.status === 'passed') fixed.push(t);
    if (t.flaky && p && !p.flaky) newlyFlaky.push(t);
  }
  return { newFailures, stillFailing, fixed, newlyFlaky };
}

function section(lines, heading, tests, row, header) {
  if (!tests.length) return;
  lines.push('', `#### ${heading} (${tests.length})`, '', header, header.replace(/[^|]+/g, ' --- '));
  for (const t of tests.slice(0, MAX_ROWS)) lines.push(row(t));
  if (tests.length > MAX_ROWS) lines.push('', `…and ${tests.length - MAX_ROWS} more.`);
}

// `current` is the run just processed: { title, label, total, passed,
// failed, broken, skipped, passRate, durationMs, flakyCount, tests }.
// `previous` is the prior run's snapshot in the same shape, or null.
export function buildJobSummary({ current, previous, dashboardUrl }) {
  const url = dashboardUrl ? safeUrl(dashboardUrl) : null;
  const lines = [`### ${mdCell(current.title)} — ${mdCell(current.label)}`, ''];

  const icon = current.failed + current.broken > 0 ? '❌' : '✅';
  const rateDelta = previous ? ` (${signed(current.passRate - previous.passRate)} pts vs ${mdCell(previous.label)})` : '';
  lines.push(
    `${icon} **${current.passRate}% pass rate**${rateDelta} · ${current.total} test${current.total === 1 ? '' : 's'} · ` +
      `${current.passed} passed · ${current.failed} failed · ${current.broken} broken · ` +
      `${current.skipped} skipped · ${current.flakyCount} flaky · ${formatDuration(current.durationMs)}`,
  );

  if (!previous) {
    lines.push('', '_No previous run in history to compare against — set `history-path` to see new failures, newly flaky and fixed tests._');
  } else {
    const d = diffRuns(current.tests, previous.tests);
    const headline = [
      `**${d.newFailures.length}** new failure${d.newFailures.length === 1 ? '' : 's'}`,
      `**${d.newlyFlaky.length}** newly flaky`,
      `**${d.fixed.length}** fixed`,
      `**${d.stillFailing.length}** still failing`,
    ].join(' · ');
    lines.push('', headline);

    section(lines, '🔴 New failures', d.newFailures,
      (t) => `| ${testName(t, url)} | ${mdCell(t.suite)} | ${t.status} | ${mdCell(firstLine(t.message))} |`,
      '| Test | Suite | Status | Error |');
    section(lines, '🟡 Newly flaky', d.newlyFlaky,
      (t) => `| ${testName(t, url)} | ${mdCell(t.suite)} | ${t.status} |`,
      '| Test | Suite | Status now |');
    section(lines, '🟢 Fixed', d.fixed,
      (t) => `| ${testName(t, url)} | ${mdCell(t.suite)} |`,
      '| Test | Suite |');
  }

  if (url) lines.push('', `[Open the dashboard ↗](${url}/)`);
  return lines.join('\n') + '\n';
}
