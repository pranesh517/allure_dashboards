// Pure aggregation: turns normalized tests (see extract.mjs) plus an optional
// requirements-file into everything the report needs — the requirement/test
// indexes, per-requirement status, coverage math, orphan tests, and coverage
// broken down by epic/feature. No filesystem access, so it's node:test-able
// without fixtures on disk.

const SEVERITY_RANK = { blocker: 0, critical: 1, normal: 2, minor: 3, trivial: 4 };
const STATUS_RANK = { failed: 0, broken: 1, unknown: 2, skipped: 3, passed: 4 };

export function pct(n, total) {
  return total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
}

// Allure records a retry as a second, later `*-result.json` sharing the same
// historyId. The processor only reads whichever files exist on disk (it can't
// tell run order from the filename), so "last" is decided by whichever result
// has the later stop/start time; a tie keeps whichever came later in the
// directory listing. The group size is kept as the retry count.
export function dedupeRetries(rawResults) {
  const byHistory = new Map();
  for (const r of rawResults) {
    const hid = r.historyId || r.fullName || r.name || r.uuid || JSON.stringify(r).slice(0, 40);
    if (!byHistory.has(hid)) byHistory.set(hid, []);
    byHistory.get(hid).push(r);
  }
  const tests = [];
  const retryCounts = new Map();
  for (const [hid, group] of byHistory) {
    retryCounts.set(hid, group.length);
    let winner = group[0];
    let winnerTime = winner.stop ?? winner.start ?? 0;
    for (const r of group.slice(1)) {
      const t = r.stop ?? r.start ?? 0;
      if (t >= winnerTime) {
        winner = r;
        winnerTime = t;
      }
    }
    tests.push(winner);
  }
  return { tests, retryCounts };
}

// requirement key (uppercased id) -> { key, displayId, tests: [] }. A test
// covering several requirements is added to each one's list.
export function buildRequirementIndex(tests) {
  const index = new Map();
  for (const t of tests) {
    for (let i = 0; i < t.requirementIds.length; i++) {
      const value = t.requirementIds[i];
      const key = t.requirementKeys[i];
      if (!index.has(key)) index.set(key, { key, displayId: value, tests: [] });
      index.get(key).tests.push(t);
    }
  }
  return index;
}

// Status precedence: any failed/broken test outranks everything else (a
// requirement isn't "passing" because 9 of 10 tests did); a mix of only
// passed+skipped is "partial" rather than counted as covered outright, since
// a skipped test proves nothing; no linked tests is "not-covered".
export function deriveStatus(tests) {
  if (!tests || !tests.length) return 'not-covered';
  const statuses = tests.map((t) => t.status);
  if (statuses.some((s) => s === 'failed' || s === 'broken')) return 'failing';
  if (statuses.every((s) => s === 'passed')) return 'passing';
  if (statuses.every((s) => s === 'skipped')) return 'skipped';
  if (statuses.every((s) => s === 'passed' || s === 'skipped')) return 'partial';
  return 'partial'; // e.g. an `unknown`-status test mixed in with no failures — flag it, don't hide it
}

// Merges the requirement index built from test results with an optional
// requirements-file. With a file: the file's rows are the full requirement
// list (so a requirement with zero tests still appears, `not-covered`) and
// its casing wins for display; ids seen in results but absent from the file
// come back separately as `unknown`. Without a file: every id seen in results
// is the requirement list (nothing can be `not-covered` in that mode, since
// by construction every entry has at least one test).
export function mergeRequirements(requirementIndex, requirementRows) {
  if (requirementRows && requirementRows.length) {
    const fileKeys = new Set(requirementRows.map((r) => r.key));
    const requirements = requirementRows.map((row) => {
      const matched = requirementIndex.get(row.key);
      const tests = matched ? matched.tests : [];
      return {
        id: row.id,
        key: row.key,
        title: row.title || null,
        epic: row.epic || null,
        feature: row.feature || null,
        priority: row.priority || null,
        tests,
        status: deriveStatus(tests),
      };
    });
    const unknown = [...requirementIndex.values()]
      .filter((e) => !fileKeys.has(e.key))
      .map((e) => ({
        id: e.displayId,
        key: e.key,
        title: null,
        epic: null,
        feature: null,
        priority: null,
        tests: e.tests,
        status: deriveStatus(e.tests),
      }));
    return { requirements, unknown, denominatorSource: 'file' };
  }

  const requirements = [...requirementIndex.values()].map((e) => ({
    id: e.displayId,
    key: e.key,
    title: null,
    epic: null,
    feature: null,
    priority: null,
    tests: e.tests,
    status: deriveStatus(e.tests),
  }));
  return { requirements, unknown: [], denominatorSource: 'results' };
}

// `covered` = has at least one linked test, of any status — distinct from
// `coveragePercent`, which is stricter (all-passing only), so a requirement
// that's covered-but-failing shows up in both `covered` and `failing`, but
// only counts against `coveragePercent` in the denominator, not the numerator.
export function computeCoverage(requirements) {
  const total = requirements.length;
  const covered = requirements.filter((r) => r.status !== 'not-covered').length;
  const notCovered = total - covered;
  const failing = requirements.filter((r) => r.status === 'failing').length;
  const passing = requirements.filter((r) => r.status === 'passing').length;
  return { total, covered, notCovered, failing, coveragePercent: pct(passing, total) };
}

// Tests with no requirement id at all — nothing in this matrix traces to
// them. Sorted worst-first (severity, then failing status) so the riskiest
// gaps surface without the viewer having to sort a few thousand rows by hand.
export function computeOrphanTests(tests) {
  const orphans = tests.filter((t) => !t.requirementIds.length);
  const ranked = [...orphans].sort((a, b) => {
    const sev = (SEVERITY_RANK[a.severity] ?? 2) - (SEVERITY_RANK[b.severity] ?? 2);
    if (sev) return sev;
    return (STATUS_RANK[a.status] ?? 2) - (STATUS_RANK[b.status] ?? 2);
  });
  return { tests: ranked, count: orphans.length, rate: pct(orphans.length, tests.length) };
}

// How many of ALL tests (traced or not) carry at least one value for a given
// plain Allure label — epic/feature/story are always labels, never links, so
// this is a simpler, more direct question than "is this test covered by a
// requirement": it's "did anyone bother to tag this test at all", regardless
// of whether that tag maps to anything in a requirements-file.
export function countTestsWithLabel(tests, labelName) {
  const count = tests.filter((t) => (t.labels?.[labelName] || []).length > 0).length;
  return { count, rate: pct(count, tests.length) };
}

// How many tests carry each of Epic/Feature/Story at all, plus a row for
// whichever annotation is actually configured as `requirement-annotation`
// (using requirementIds/orphans — already respects source/pattern — rather
// than assuming "requirement" is a label name itself). A team with no
// dedicated requirement id often points requirement-annotation straight at
// "epic" or "feature"; when that happens the matching fixed row is dropped
// instead of showing the identical count twice under two names.
export function buildAnnotationCoverage(tests, orphans, requirementAnnotation) {
  const rows = [
    { name: 'Epic', key: 'epic', ...countTestsWithLabel(tests, 'epic') },
    { name: 'Feature', key: 'feature', ...countTestsWithLabel(tests, 'feature') },
    { name: 'Story', key: 'story', ...countTestsWithLabel(tests, 'story') },
  ]
    .filter((row) => row.key !== requirementAnnotation.toLowerCase())
    .map(({ key, ...row }) => row);
  rows.push({
    name: requirementAnnotation.charAt(0).toUpperCase() + requirementAnnotation.slice(1),
    count: tests.length - orphans.count,
    rate: pct(tests.length - orphans.count, tests.length),
    isRequirement: true,
  });
  return rows;
}

// Every ignored-by-pattern value across all tests, deduped, so the Gaps tab
// can list "these annotation values looked like ids but didn't match your
// pattern" instead of the viewer having to guess why a test seems untraced.
export function collectIgnoredValues(tests) {
  const seen = new Set();
  const out = [];
  for (const t of tests) {
    for (const v of t.ignoredRequirementValues || []) {
      const key = `${v.source}\u0000${v.value}\u0000${t.uuid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ value: v.value, source: v.source, test: t.name, testUuid: t.uuid });
    }
  }
  return out;
}

// Which value(s) of `groupLabel` (epic/feature/story/...) a requirement
// belongs to: the requirements-file column of that name if the file
// supplied it; otherwise the union of that label's values across the
// requirement's own covering tests (so grouping still works with no file,
// or for a label — like story — the file never has a column for). Returns
// [] when nothing resolves; callers that need an "Unassigned" bucket add it
// themselves. Exported (not just used by coverageByGroup below) because the
// static report needs the same per-requirement values client-side, to
// filter the Matrix tab when a "Coverage by" bar is clicked — sending it
// once here is what lets that filter work for a label with no file column,
// same as one with a file column.
export function resolveGroupValues(req, groupLabel) {
  if (req[groupLabel]) return [req[groupLabel]];
  const fromTests = new Set();
  for (const t of req.tests) for (const v of t.labels?.[groupLabel] || []) fromTests.add(v);
  return [...fromTests];
}

// Coverage per value of a grouping label (epic, feature, story, ...). A
// requirement that resolves to several group values (disagreeing tests, or
// a multi-value label) is counted in each one, same as the dashboard's
// grouped view; one with none lands in "Unassigned".
export function coverageByGroup(requirements, groupLabel) {
  const byGroup = new Map();
  for (const req of requirements) {
    let values = resolveGroupValues(req, groupLabel);
    if (!values.length) values = ['Unassigned'];
    for (const name of values) {
      if (!byGroup.has(name)) byGroup.set(name, { name, requirements: [] });
      byGroup.get(name).requirements.push(req);
    }
  }
  return [...byGroup.values()]
    .map((g) => {
      const c = computeCoverage(g.requirements);
      const testUuids = new Set();
      for (const r of g.requirements) for (const t of r.tests) testUuids.add(t.uuid);
      return { name: g.name, ...c, testCount: testUuids.size };
    })
    .sort((a, b) => (a.name === 'Unassigned') - (b.name === 'Unassigned') || b.total - a.total || a.name.localeCompare(b.name));
}
