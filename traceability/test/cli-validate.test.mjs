import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError, compilePattern, validateSource, validateMinCoverage, parseBoolInput, requirementsFileFormat } from '../src/cli-validate.mjs';

test('compilePattern: bare pattern is compiled case-insensitively', () => {
  const p = compilePattern('^REQ-\\d+$', 'requirement-id-pattern');
  assert.ok(p.test('REQ-1'));
  assert.ok(p.test('req-1'));
});

test('compilePattern: /pattern/flags form is used exactly as given (opt-in case sensitivity)', () => {
  const p = compilePattern('/^REQ-\\d+$/', 'requirement-id-pattern');
  assert.ok(p.test('REQ-1'));
  assert.ok(!p.test('req-1'));
});

test('compilePattern: no input returns null', () => {
  assert.equal(compilePattern('', 'x'), null);
  assert.equal(compilePattern(undefined, 'x'), null);
});

test('compilePattern: invalid regex throws ValidationError naming the input', () => {
  assert.throws(() => compilePattern('(unclosed', 'requirement-id-pattern'), (e) => e instanceof ValidationError && /requirement-id-pattern/.test(e.message));
});

test('validateSource accepts the four known values, rejects anything else', () => {
  assert.equal(validateSource('auto', 'x'), 'auto');
  assert.equal(validateSource('tag', 'x'), 'tag');
  assert.throws(() => validateSource('bogus', 'requirement-source'), ValidationError);
});

test('validateMinCoverage: empty/undefined is null, valid range passes, out of range throws', () => {
  assert.equal(validateMinCoverage(undefined, 'x'), null);
  assert.equal(validateMinCoverage('', 'x'), null);
  assert.equal(validateMinCoverage('80', 'x'), 80);
  assert.throws(() => validateMinCoverage('150', 'min-coverage'), ValidationError);
  assert.throws(() => validateMinCoverage('not-a-number', 'min-coverage'), ValidationError);
});

test('parseBoolInput: only the string "true" (any case) is true', () => {
  assert.equal(parseBoolInput('true'), true);
  assert.equal(parseBoolInput('TRUE'), true);
  assert.equal(parseBoolInput('false'), false);
  assert.equal(parseBoolInput(''), false);
  assert.equal(parseBoolInput(undefined), false);
});

test('requirementsFileFormat: .csv and .json accepted case-insensitively, anything else throws', () => {
  assert.equal(requirementsFileFormat('reqs.CSV'), 'csv');
  assert.equal(requirementsFileFormat('dir/reqs.json'), 'json');
  assert.throws(() => requirementsFileFormat('reqs.txt'), ValidationError);
});
