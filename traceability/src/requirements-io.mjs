// Parses the optional `requirements-file` (CSV or JSON) into a flat list of
// { id, key, title, epic, feature, priority }. No dependency — a small
// RFC4180-ish CSV parser (quoted fields, "" escaped quotes, \r\n or \n).
// `key` is the uppercased id, used everywhere else for case-insensitive
// matching against ids extracted from test results; `id` keeps the file's
// own casing, which is what the report displays.

export function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c !== ''))
    .map((r) => {
      const obj = {};
      header.forEach((h, i) => {
        obj[h] = (r[i] ?? '').trim();
      });
      return obj;
    });
}

function stringOrNull(v) {
  return v == null || v === '' ? null : String(v);
}

// Column/key names are matched case-insensitively ("ID", "Id", "id" all
// work). Throws with a clear message if no id column is found — that's a
// configuration error the action should fail fast on, not silently ignore.
export function normalizeRequirementRows(objs) {
  if (!objs.length) return [];
  const keys = Object.keys(objs[0]);
  const findKey = (name) => keys.find((k) => k.toLowerCase() === name);
  const idKey = findKey('id');
  if (!idKey) {
    throw new Error('requirements-file has no "id" column (CSV header) or key (JSON object) — every row needs one.');
  }
  const titleKey = findKey('title');
  const epicKey = findKey('epic');
  const featureKey = findKey('feature');
  const priorityKey = findKey('priority');

  const seen = new Set();
  const out = [];
  for (const o of objs) {
    const id = stringOrNull(o[idKey]);
    if (!id) continue; // a row with no id is silently skipped, not a fatal error
    const key = id.toUpperCase();
    if (seen.has(key)) continue; // duplicate id: first row wins
    seen.add(key);
    out.push({
      id,
      key,
      title: titleKey ? stringOrNull(o[titleKey]) : null,
      epic: epicKey ? stringOrNull(o[epicKey]) : null,
      feature: featureKey ? stringOrNull(o[featureKey]) : null,
      priority: priorityKey ? stringOrNull(o[priorityKey]) : null,
    });
  }
  return out;
}

// `format` is 'csv' or 'json' — the caller (process.mjs) decides which from
// the file extension, so this stays pure and doesn't touch the filesystem.
export function parseRequirementsText(text, format) {
  if (format === 'json') {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`requirements-file is not valid JSON: ${e.message}`);
    }
    const arr = Array.isArray(data) ? data : Array.isArray(data?.requirements) ? data.requirements : null;
    if (!arr) throw new Error('requirements-file JSON must be an array of requirements, or { "requirements": [...] }.');
    return normalizeRequirementRows(arr);
  }
  return normalizeRequirementRows(rowsToObjects(parseCsv(text)));
}
