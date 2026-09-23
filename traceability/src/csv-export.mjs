// Builds the `traceability.csv` audit export. Pure string-building, no fs.

function csvField(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(values) {
  return values.map(csvField).join(',');
}

const HEADER = [
  'requirement_id',
  'requirement_title',
  'epic',
  'feature',
  'priority',
  'requirement_status',
  'test_case_id',
  'test_name',
  'test_status',
  'test_severity',
  'test_suite',
  'test_duration_ms',
  'test_uuid',
];

// One row per requirement/test pair. A requirement with zero tests still
// gets one row (blank test_* columns) so "not covered" is visible in the
// export, not just absent from it. Orphan tests (no requirement id at all)
// get their own rows with blank requirement_* columns, appended after the
// requirement rows, so the export accounts for every test and every
// requirement — nothing that exists in the report is missing from the CSV.
export function buildTraceabilityCsv({ requirements, orphanTests }) {
  const lines = [csvRow(HEADER)];

  for (const req of requirements || []) {
    const base = [req.id, req.title, req.epic, req.feature, req.priority, req.status];
    if (!req.tests || !req.tests.length) {
      lines.push(csvRow([...base, '', '', '', '', '', '', '']));
      continue;
    }
    for (const t of req.tests) {
      lines.push(
        csvRow([...base, t.testCaseId, t.name, t.status, t.severity, t.suite, t.durationMs, t.uuid]),
      );
    }
  }

  for (const t of orphanTests || []) {
    lines.push(
      csvRow(['', '', '', '', '', '', t.testCaseId, t.name, t.status, t.severity, t.suite, t.durationMs, t.uuid]),
    );
  }

  return lines.join('\r\n') + '\r\n';
}
