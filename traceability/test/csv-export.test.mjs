import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTraceabilityCsv } from '../src/csv-export.mjs';

test('buildTraceabilityCsv: one row per requirement/test pair', () => {
  const requirements = [
    {
      id: 'REQ-1', title: 'Login', epic: 'Auth', feature: 'Login form', priority: 'high', status: 'passing',
      tests: [{ testCaseId: 'TC-1', name: 'logs in', status: 'passed', severity: 'critical', suite: 'Auth', durationMs: 120, uuid: 'u1' }],
    },
  ];
  const csv = buildTraceabilityCsv({ requirements, orphanTests: [] });
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'requirement_id,requirement_title,epic,feature,priority,requirement_status,test_case_id,test_name,test_status,test_severity,test_suite,test_duration_ms,test_uuid');
  assert.equal(lines[1], 'REQ-1,Login,Auth,Login form,high,passing,TC-1,logs in,passed,critical,Auth,120,u1');
});

test('buildTraceabilityCsv: a not-covered requirement gets one row with blank test columns', () => {
  const requirements = [{ id: 'REQ-2', title: null, epic: null, feature: null, priority: null, status: 'not-covered', tests: [] }];
  const csv = buildTraceabilityCsv({ requirements, orphanTests: [] });
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[1], 'REQ-2,,,,,not-covered,,,,,,,');
});

test('buildTraceabilityCsv: orphan tests get rows with blank requirement columns', () => {
  const orphanTests = [{ testCaseId: 'TC-9', name: 'stray', status: 'passed', severity: 'minor', suite: 'Misc', durationMs: 10, uuid: 'u9' }];
  const csv = buildTraceabilityCsv({ requirements: [], orphanTests });
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[1], ',,,,,,TC-9,stray,passed,minor,Misc,10,u9');
});

test('buildTraceabilityCsv: a test covering two requirements produces two rows', () => {
  const sharedTest = { testCaseId: 'TC-1', name: 'shared', status: 'passed', severity: 'normal', suite: 'S', durationMs: 5, uuid: 'u1' };
  const requirements = [
    { id: 'REQ-1', title: null, epic: null, feature: null, priority: null, status: 'passing', tests: [sharedTest] },
    { id: 'REQ-2', title: null, epic: null, feature: null, priority: null, status: 'passing', tests: [sharedTest] },
  ];
  const csv = buildTraceabilityCsv({ requirements, orphanTests: [] });
  assert.equal(csv.trim().split('\r\n').length, 3);
});

test('buildTraceabilityCsv: quotes fields containing commas, quotes or newlines', () => {
  const requirements = [{ id: 'REQ-1', title: 'Has, a comma and "quotes"', epic: 'Multi\nline', feature: null, priority: null, status: 'not-covered', tests: [] }];
  const csv = buildTraceabilityCsv({ requirements, orphanTests: [] });
  assert.match(csv, /"Has, a comma and ""quotes"""/);
  assert.match(csv, /"Multi\nline"/);
});
