// Pure extraction helpers: turn one raw Allure `*-result.json` object into a
// normalized test record, plus the requirement/test-case IDs it carries.
//
// Nothing here touches the filesystem — that's process.mjs's job — which is
// what keeps this testable with node:test and no fixtures on disk.

const STATUSES = ['passed', 'failed', 'broken', 'skipped', 'unknown'];

export function labelValues(labels, name) {
  const target = String(name).toLowerCase();
  const out = [];
  for (const l of labels || []) {
    if (l && l.name && String(l.name).toLowerCase() === target && l.value != null && l.value !== '') {
      out.push(String(l.value));
    }
  }
  return out;
}

function linkEntries(links, type) {
  const target = String(type).toLowerCase();
  return (links || []).filter((l) => l && l.type && String(l.type).toLowerCase() === target);
}

// A link's id is its `name` (e.g. @TmsLink("JIRA-42")'s visible label) if set,
// else the last path segment of its `url` (e.g. .../browse/JIRA-42 -> JIRA-42).
export function linkId(link) {
  if (link.name) return String(link.name);
  if (link.url) {
    let pathname = String(link.url);
    try {
      pathname = new URL(link.url).pathname;
    } catch {
      // not a valid absolute URL — fall through and split the raw string
    }
    const segs = pathname.split('/').filter(Boolean);
    if (segs.length) {
      try {
        return decodeURIComponent(segs[segs.length - 1]);
      } catch {
        return segs[segs.length - 1];
      }
    }
  }
  return null;
}

// Applies an optional id-pattern to a raw annotation value. No pattern: the
// trimmed raw value is the id. A pattern with a capture group extracts group
// 1; without one, the whole match is used. No match: the value is reported
// as ignored rather than silently dropped.
export function applyPattern(raw, pattern) {
  const s = String(raw).trim();
  if (!pattern) return { value: s || null, matched: true };
  const m = pattern.exec(String(raw));
  if (!m) return { value: null, matched: false };
  const extracted = m[1] !== undefined ? m[1] : m[0];
  return { value: String(extracted).trim(), matched: true };
}

// Collects every id for one annotation off one test: `source` picks which
// parts of the result are consulted (auto = labels ∪ links; tag = the Allure
// `tag` label, filtered by `pattern` if given). Ids are deduped
// case-insensitively (first-seen casing wins) and matched against `pattern`
// if provided; values that don't match are returned separately as `ignored`
// so the report can surface them instead of pretending they don't exist.
export function extractAnnotationValues(test, cfg) {
  if (!cfg || !cfg.annotation) return { ids: [], ignored: [] };
  const { annotation, source = 'auto', pattern = null } = cfg;
  const ids = [];
  const ignored = [];
  const seenKeys = new Set();

  const push = (raw, sourceType) => {
    const { value, matched } = applyPattern(raw, pattern);
    if (!matched) {
      ignored.push({ value: String(raw), source: sourceType });
      return;
    }
    if (!value) return;
    const key = value.toUpperCase();
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    ids.push({ value, key, source: sourceType });
  };

  if (source === 'auto' || source === 'label') {
    for (const v of labelValues(test.labels, annotation)) push(v, 'label');
  }
  if (source === 'auto' || source === 'link') {
    for (const l of linkEntries(test.links, annotation)) {
      const id = linkId(l);
      if (id) push(id, 'link');
    }
  }
  if (source === 'tag') {
    for (const v of labelValues(test.labels, 'tag')) push(v, 'tag');
  }

  return { ids, ignored };
}

// A test has one test-case id, not several. Falls back to `fullName` (and
// flags `explicit: false`) when the configured annotation is absent, unset,
// or resolves to nothing usable — so every test is still identifiable in the
// reverse view even with no test-management-tool link.
export function extractTestCaseId(test, cfg) {
  const { ids } = cfg && cfg.annotation ? extractAnnotationValues(test, cfg) : { ids: [] };
  if (ids.length) return { id: ids[0].value, explicit: true, source: ids[0].source };
  return { id: test.fullName || test.name || test.uuid || 'unnamed test', explicit: false, source: 'fullName' };
}

// Every label as { name: [values] } (a label can repeat — several @Tag
// annotations become several entries with the same name).
export function collectLabels(labels) {
  const byName = new Map();
  for (const l of labels || []) {
    if (!l || !l.name || l.value == null || l.value === '') continue;
    const name = String(l.name);
    const value = String(l.value);
    if (!byName.has(name)) byName.set(name, []);
    const values = byName.get(name);
    if (!values.includes(value)) values.push(value);
  }
  return Object.fromEntries(byName);
}

// `config` is `{ requirement: {annotation, source, pattern}, testcase: {...} }`
// with `pattern` already compiled to a RegExp (or null) by the caller, so a
// bad regex fails fast at startup instead of once per test.
export function normalizeTest(raw, config) {
  const labels = raw.labels || [];
  const links = raw.links || [];
  const status = STATUSES.includes(raw.status) ? raw.status : 'unknown';
  const start = raw.start || raw.time?.start || 0;
  const stop = raw.stop || raw.time?.stop || start;
  const fullName = raw.fullName || raw.name || raw.uuid || 'unnamed test';
  const historyId = raw.historyId || fullName;
  const severity = (labelValues(labels, 'severity')[0] || 'normal').toLowerCase();
  const suite = labelValues(labels, 'suite')[0] || labelValues(labels, 'parentSuite')[0] || 'Uncategorized';

  const req = extractAnnotationValues({ labels, links }, config.requirement);
  const tc = extractTestCaseId({ labels, links, fullName, name: raw.name, uuid: raw.uuid }, config.testcase);

  return {
    uuid: raw.uuid || historyId,
    historyId,
    name: raw.name || fullName,
    fullName,
    status,
    start: start || null,
    stop: stop || null,
    durationMs: Math.max(0, stop - start),
    severity,
    suite,
    labels: collectLabels(labels),
    requirementIds: req.ids.map((i) => i.value),
    requirementKeys: req.ids.map((i) => i.key),
    ignoredRequirementValues: req.ignored,
    testCaseId: tc.id,
    hasExplicitTestCaseId: tc.explicit,
  };
}
