import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, rowsToObjects, normalizeRequirementRows, parseRequirementsText } from '../src/requirements-io.mjs';

test('parseCsv handles a plain, quoted, and escaped-quote field', () => {
  const text = 'id,title\nREQ-1,Simple\n"REQ-2","Has, a comma"\n"REQ-3","Has ""quotes"" inside"\n';
  const rows = parseCsv(text);
  assert.deepEqual(rows, [
    ['id', 'title'],
    ['REQ-1', 'Simple'],
    ['REQ-2', 'Has, a comma'],
    ['REQ-3', 'Has "quotes" inside'],
  ]);
});

test('parseCsv tolerates \\r\\n line endings and a trailing newline', () => {
  const text = 'id\r\nREQ-1\r\nREQ-2\r\n';
  assert.deepEqual(parseCsv(text), [['id'], ['REQ-1'], ['REQ-2']]);
});

test('rowsToObjects trims header/values and skips fully-blank rows', () => {
  const rows = [[' id ', ' title '], ['REQ-1', ' Login '], ['', '']];
  assert.deepEqual(rowsToObjects(rows), [{ id: 'REQ-1', title: 'Login' }]);
});

test('normalizeRequirementRows matches column names case-insensitively', () => {
  const objs = [{ ID: 'REQ-1', Title: 'Login', Epic: 'Auth', Feature: 'Login form', Priority: 'high' }];
  const out = normalizeRequirementRows(objs);
  assert.deepEqual(out, [{ id: 'REQ-1', key: 'REQ-1', title: 'Login', epic: 'Auth', feature: 'Login form', priority: 'high' }]);
});

test('normalizeRequirementRows throws a clear error with no id column', () => {
  assert.throws(() => normalizeRequirementRows([{ title: 'x' }]), /no "id" column/);
});

test('normalizeRequirementRows: first occurrence of a duplicate id wins, rows with no id are skipped', () => {
  const objs = [
    { id: 'REQ-1', title: 'First' },
    { id: 'REQ-1', title: 'Second' },
    { id: '', title: 'No id' },
  ];
  const out = normalizeRequirementRows(objs);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'First');
});

test('parseRequirementsText: csv format end to end', () => {
  const out = parseRequirementsText('id,title\nREQ-1,Login\n', 'csv');
  assert.deepEqual(out, [{ id: 'REQ-1', key: 'REQ-1', title: 'Login', epic: null, feature: null, priority: null }]);
});

test('parseRequirementsText: json array format', () => {
  const out = parseRequirementsText(JSON.stringify([{ id: 'REQ-1', priority: 1 }]), 'json');
  assert.deepEqual(out, [{ id: 'REQ-1', key: 'REQ-1', title: null, epic: null, feature: null, priority: '1' }]);
});

test('parseRequirementsText: json { requirements: [...] } format', () => {
  const out = parseRequirementsText(JSON.stringify({ requirements: [{ id: 'REQ-1' }] }), 'json');
  assert.equal(out.length, 1);
});

test('parseRequirementsText: invalid JSON gives a clear error', () => {
  assert.throws(() => parseRequirementsText('{not json', 'json'), /not valid JSON/);
});

test('parseRequirementsText: JSON that is neither an array nor {requirements} errors clearly', () => {
  assert.throws(() => parseRequirementsText(JSON.stringify({ foo: 1 }), 'json'), /array of requirements/);
});
