// Pure input-validation helpers for the CLI (process.mjs), split out so they
// can be node:test-ed without triggering process.mjs's top-level `main()`.

export class ValidationError extends Error {}

const SOURCES = ['auto', 'label', 'link', 'tag'];

// Compiles an `*-id-pattern` input into a RegExp. Two forms:
//   - `/pattern/flags` — used exactly as given (an escape hatch for a
//     deliberately case-sensitive pattern, e.g. `/^REQ-\d+$/` with no `i`).
//   - anything else — compiled with the `i` flag, so a pattern like
//     `REQ-\d+` matches "REQ-1" and "req-1" alike. This matches the
//     case-insensitive id policy used everywhere else (see aggregate.mjs) —
//     without it, a differently-cased id would be silently dropped as
//     "ignored" instead of tracked, which would be surprising.
export function compilePattern(raw, inputName) {
  if (!raw) return null;
  const slashForm = /^\/(.*)\/([a-z]*)$/i.exec(raw);
  try {
    return slashForm ? new RegExp(slashForm[1], slashForm[2]) : new RegExp(raw, 'i');
  } catch (e) {
    throw new ValidationError(`"${inputName}" is not a valid regular expression: ${raw}\n${e.message}`);
  }
}

export function validateSource(source, inputName) {
  if (!SOURCES.includes(source)) {
    throw new ValidationError(`"${inputName}" must be one of ${SOURCES.join(', ')}, got "${source}".`);
  }
  return source;
}

export function validateMinCoverage(raw, inputName) {
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new ValidationError(`"${inputName}" must be a number between 0 and 100, got: ${raw}`);
  }
  return n;
}

export function parseBoolInput(v) {
  return String(v ?? 'false').trim().toLowerCase() === 'true';
}

export function requirementsFileFormat(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.csv') return 'csv';
  throw new ValidationError(`requirements-file must end in .csv or .json, got: ${filePath}`);
}
