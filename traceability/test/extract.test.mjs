import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  labelValues,
  linkId,
  applyPattern,
  extractAnnotationValues,
  extractTestCaseId,
  collectLabels,
  normalizeTest,
} from '../src/extract.mjs';

test('labelValues matches label name case-insensitively and skips empty values', () => {
  const labels = [
    { name: 'Requirement', value: 'REQ-1' },
    { name: 'requirement', value: 'REQ-2' },
    { name: 'requirement', value: '' },
    { name: 'other', value: 'x' },
  ];
  assert.deepEqual(labelValues(labels, 'requirement'), ['REQ-1', 'REQ-2']);
});

test('linkId prefers name, falls back to the URL last path segment', () => {
  assert.equal(linkId({ name: 'JIRA-42', url: 'https://x/browse/JIRA-99' }), 'JIRA-42');
  assert.equal(linkId({ url: 'https://x.atlassian.net/browse/JIRA-42' }), 'JIRA-42');
  assert.equal(linkId({ url: 'https://x/browse/JIRA-42/' }), 'JIRA-42');
  assert.equal(linkId({ url: 'not a url///' }), 'not a url');
  assert.equal(linkId({}), null);
});

test('applyPattern: no pattern returns the trimmed raw value', () => {
  assert.deepEqual(applyPattern('  REQ-1  ', null), { value: 'REQ-1', matched: true });
});

test('applyPattern: pattern with a capture group extracts group 1', () => {
  const p = /^REQ:(\w+)$/;
  assert.deepEqual(applyPattern('REQ:42', p), { value: '42', matched: true });
});

test('applyPattern: pattern with no capture group uses the whole match', () => {
  const p = /[A-Z]+-\d+/;
  assert.deepEqual(applyPattern('ticket JIRA-42 filed', p), { value: 'JIRA-42', matched: true });
});

test('applyPattern: no match is reported, not silently dropped', () => {
  const p = /^REQ-\d+$/;
  assert.deepEqual(applyPattern('not-a-req', p), { value: null, matched: false });
});

test('extractAnnotationValues: source label only reads labels', () => {
  const test1 = {
    labels: [{ name: 'requirement', value: 'REQ-1' }],
    links: [{ type: 'requirement', name: 'REQ-2' }],
  };
  const { ids } = extractAnnotationValues(test1, { annotation: 'requirement', source: 'label' });
  assert.deepEqual(ids.map((i) => i.value), ['REQ-1']);
});

test('extractAnnotationValues: source link only reads links', () => {
  const test1 = {
    labels: [{ name: 'requirement', value: 'REQ-1' }],
    links: [{ type: 'requirement', name: 'REQ-2' }],
  };
  const { ids } = extractAnnotationValues(test1, { annotation: 'requirement', source: 'link' });
  assert.deepEqual(ids.map((i) => i.value), ['REQ-2']);
});

test('extractAnnotationValues: source auto unions labels and links, deduped case-insensitively', () => {
  const test1 = {
    labels: [{ name: 'requirement', value: 'REQ-1' }, { name: 'requirement', value: 'req-1' }],
    links: [{ type: 'requirement', name: 'REQ-2' }],
  };
  const { ids } = extractAnnotationValues(test1, { annotation: 'requirement', source: 'auto' });
  assert.deepEqual(ids.map((i) => i.value), ['REQ-1', 'REQ-2']);
});

test('extractAnnotationValues: source tag reads the "tag" label, filtered by pattern', () => {
  const test1 = { labels: [{ name: 'tag', value: 'smoke' }, { name: 'tag', value: 'REQ-7' }], links: [] };
  const { ids } = extractAnnotationValues(test1, { annotation: 'requirement', source: 'tag', pattern: /^REQ-\d+$/ });
  assert.deepEqual(ids.map((i) => i.value), ['REQ-7']);
});

test('extractAnnotationValues: values failing the pattern are reported as ignored', () => {
  const test1 = { labels: [{ name: 'requirement', value: 'not-a-req' }, { name: 'requirement', value: 'REQ-1' }], links: [] };
  const { ids, ignored } = extractAnnotationValues(test1, { annotation: 'requirement', source: 'label', pattern: /^REQ-\d+$/ });
  assert.deepEqual(ids.map((i) => i.value), ['REQ-1']);
  assert.deepEqual(ignored, [{ value: 'not-a-req', source: 'label' }]);
});

test('extractAnnotationValues: no annotation configured returns nothing', () => {
  assert.deepEqual(extractAnnotationValues({ labels: [], links: [] }, { annotation: null }), { ids: [], ignored: [] });
  assert.deepEqual(extractAnnotationValues({ labels: [], links: [] }, null), { ids: [], ignored: [] });
});

test('extractTestCaseId: explicit annotation wins', () => {
  const t = { labels: [{ name: 'testcase', value: 'TC-1' }], fullName: 'pkg.Test.method' };
  const r = extractTestCaseId(t, { annotation: 'testcase', source: 'label' });
  assert.deepEqual(r, { id: 'TC-1', explicit: true, source: 'label' });
});

test('extractTestCaseId: falls back to fullName when missing, flags explicit:false', () => {
  const t = { labels: [], fullName: 'pkg.Test.method' };
  const r = extractTestCaseId(t, { annotation: 'testcase', source: 'label' });
  assert.deepEqual(r, { id: 'pkg.Test.method', explicit: false, source: 'fullName' });
});

test('extractTestCaseId: unconfigured annotation always falls back', () => {
  const t = { labels: [{ name: 'testcase', value: 'TC-1' }], fullName: 'pkg.Test.method' };
  const r = extractTestCaseId(t, { annotation: null });
  assert.equal(r.explicit, false);
  assert.equal(r.id, 'pkg.Test.method');
});

test('collectLabels groups repeated label names into arrays, dedup and empties skipped', () => {
  const labels = [
    { name: 'tag', value: 'smoke' },
    { name: 'tag', value: 'smoke' },
    { name: 'tag', value: 'regression' },
    { name: 'owner', value: '' },
  ];
  assert.deepEqual(collectLabels(labels), { tag: ['smoke', 'regression'] });
});

test('normalizeTest wires extraction into a full test record', () => {
  const raw = {
    uuid: 'u1',
    historyId: 'h1',
    name: 'checks tax',
    fullName: 'pkg.Checkout.tax',
    status: 'failed',
    start: 1000,
    stop: 1500,
    labels: [
      { name: 'requirement', value: 'REQ-1' },
      { name: 'requirement', value: 'REQ-2' },
      { name: 'severity', value: 'Critical' },
      { name: 'suite', value: 'Checkout' },
    ],
    links: [],
  };
  const config = {
    requirement: { annotation: 'requirement', source: 'auto', pattern: null },
    testcase: { annotation: null },
  };
  const t = normalizeTest(raw, config);
  assert.equal(t.status, 'failed');
  assert.equal(t.severity, 'critical');
  assert.equal(t.suite, 'Checkout');
  assert.deepEqual(t.requirementIds, ['REQ-1', 'REQ-2']);
  assert.deepEqual(t.requirementKeys, ['REQ-1', 'REQ-2']);
  assert.equal(t.hasExplicitTestCaseId, false);
  assert.equal(t.testCaseId, 'pkg.Checkout.tax');
  assert.equal(t.durationMs, 500);
});

test('normalizeTest defaults an invalid/missing status to "unknown"', () => {
  const raw = { uuid: 'u', historyId: 'h', name: 'n', fullName: 'n', status: 'weird', labels: [], links: [] };
  const config = { requirement: { annotation: null }, testcase: { annotation: null } };
  assert.equal(normalizeTest(raw, config).status, 'unknown');
});
