import { donut, lineChart, heatStrip } from './charts.js';

const STATUS_META = {
  passed: { color: 'var(--status-good)', label: 'Passed' },
  failed: { color: 'var(--status-critical)', label: 'Failed' },
  broken: { color: 'var(--status-serious)', label: 'Broken' },
  skipped: { color: 'var(--status-skipped)', label: 'Skipped' },
  unknown: { color: 'var(--status-warning)', label: 'Unknown' },
};
const STATUS_ORDER = ['passed', 'failed', 'broken', 'skipped', 'unknown'];

const SEVERITY_COLOR = {
  blocker: 'var(--seq-650)',
  critical: 'var(--seq-500)',
  normal: 'var(--seq-400)',
  minor: 'var(--seq-250)',
  trivial: 'var(--seq-100)',
};

function statusColor(status) {
  return (STATUS_META[status] || STATUS_META.unknown).color;
}

function chip(status, extraLabel) {
  const meta = STATUS_META[status] || STATUS_META.unknown;
  return `<span class="chip ${status}"><span class="dot"></span>${extraLabel || meta.label}</span>`;
}

function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

async function loadJSON(p, fallback) {
  try {
    const res = await fetch(p, { cache: 'no-store' });
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

function applyStoredTheme() {
  const saved = localStorage.getItem('allure-dashboard-theme');
  if (saved) document.documentElement.dataset.theme = saved;
}

function setupThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  const current = () => document.documentElement.dataset.theme
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('allure-dashboard-theme', next);
  });
}

function renderKPIs(latest, prevRun) {
  const grid = document.getElementById('kpi-grid');
  const delta = prevRun ? latest.passRate - prevRun.passRate : null;
  const deltaHtml = delta == null ? ''
    : `<div class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}pt vs previous run</div>`;

  grid.innerHTML = '';
  const ringTile = el(`<div class="card kpi-ring"></div>`);
  ringTile.appendChild(donut({ percent: latest.passRate, color: 'var(--status-good)', trackColor: 'var(--gridline)' }));
  const ringText = el(`
    <div class="kpi">
      <div class="value">${latest.passRate}%</div>
      <div class="label">Pass rate</div>
      ${deltaHtml}
    </div>`);
  ringTile.appendChild(ringText);
  grid.appendChild(ringTile);

  const tiles = [
    { value: latest.total, label: 'Total tests' },
    { value: latest.failed + latest.broken, label: 'Failed + broken' },
    { value: formatDuration(latest.durationMs), label: 'Total duration' },
    { value: latest.flakyCount, label: 'Flaky tests' },
  ];
  for (const t of tiles) {
    grid.appendChild(el(`<div class="card kpi"><div class="value">${t.value}</div><div class="label">${t.label}</div></div>`));
  }
}

function renderTrends(history) {
  const chrono = [...history].reverse();
  const passEl = document.getElementById('trend-passrate');
  passEl.innerHTML = '';
  passEl.appendChild(lineChart({
    points: chrono.map((r) => ({ label: r.label, value: r.passRate })),
    color: 'var(--status-good)',
    unit: '%',
  }));

  const durEl = document.getElementById('trend-duration');
  durEl.innerHTML = '';
  durEl.appendChild(lineChart({
    points: chrono.map((r) => ({ label: r.label, value: Math.round(r.durationMs / 1000) })),
    color: 'var(--cat-blue)',
    valueFormat: (v) => v,
    unit: 's',
  }));
}

function renderSuiteBars(suites) {
  const container = document.getElementById('suite-bars');
  container.innerHTML = '';
  if (!suites.length) { container.innerHTML = '<div class="empty-state">No suites found.</div>'; return; }
  for (const s of suites.slice(0, 12)) {
    const row = el(`
      <div class="bar-row">
        <div class="name" title="${s.name}">${s.name}</div>
        <div class="bar-track"></div>
        <div class="total">${s.total}</div>
      </div>`);
    const track = row.querySelector('.bar-track');
    for (const status of STATUS_ORDER) {
      const n = s[status];
      if (!n) continue;
      const seg = document.createElement('div');
      seg.className = 'bar-seg';
      seg.style.background = statusColor(status);
      seg.style.width = `${(n / s.total) * 100}%`;
      seg.title = `${STATUS_META[status].label}: ${n}`;
      track.appendChild(seg);
    }
    container.appendChild(row);
  }
  renderLegend('suite-legend', STATUS_ORDER.map((s) => ({ label: STATUS_META[s].label, color: statusColor(s) })));
}

function renderSeverityBars(severities) {
  const container = document.getElementById('severity-bars');
  container.innerHTML = '';
  if (!severities.length) { container.innerHTML = '<div class="empty-state">No severity labels found.</div>'; return; }
  const max = Math.max(...severities.map((s) => s.total));
  for (const s of severities) {
    const row = el(`
      <div class="bar-row">
        <div class="name">${s.name}</div>
        <div class="bar-track"></div>
        <div class="total">${s.total}</div>
      </div>`);
    const track = row.querySelector('.bar-track');
    const seg = document.createElement('div');
    seg.className = 'bar-seg';
    seg.style.background = SEVERITY_COLOR[s.name] || 'var(--seq-400)';
    seg.style.width = `${(s.total / max) * 100}%`;
    seg.style.borderRadius = '3px';
    track.style.background = 'transparent';
    track.appendChild(seg);
    container.appendChild(row);
  }
}

function renderLegend(id, items) {
  const node = document.getElementById(id);
  if (!node) return;
  node.innerHTML = items.map((i) => `<span class="item"><span class="swatch" style="background:${i.color}"></span>${i.label}</span>`).join('');
}

function renderCategories(categories) {
  const container = document.getElementById('categories');
  container.innerHTML = '';
  if (!categories.length) { container.innerHTML = '<div class="empty-state">No failures — nothing to categorize 🎉</div>'; return; }
  for (const c of categories) {
    const details = el(`
      <details style="margin-bottom:10px;">
        <summary style="cursor:pointer; font-size:13px; display:flex; justify-content:space-between;">
          <span>${c.name}</span><span style="color:var(--text-muted)">${c.count}</span>
        </summary>
        <div style="padding:8px 4px 2px; font-size:12px; color:var(--text-secondary);"></div>
      </details>`);
    const body = details.querySelector('div');
    body.innerHTML = c.tests.slice(0, 8).map((t) => `<div style="padding:4px 0; border-top:1px solid var(--gridline);"><strong>${t.name}</strong>${t.message ? ` — ${escapeHtml(t.message).slice(0, 140)}` : ''}</div>`).join('');
    container.appendChild(details);
  }
}

function renderFlaky(flakyTests) {
  const container = document.getElementById('flaky-body');
  container.innerHTML = '';
  if (!flakyTests.length) { container.innerHTML = '<tr><td colspan="4" class="empty-state">No flaky tests detected in recent history 🎉</td></tr>'; return; }
  for (const t of flakyTests) {
    const row = el(`
      <tr>
        <td><strong>${t.name}</strong><div style="color:var(--text-muted); font-size:11px;">${t.suite}</div></td>
        <td>${chip(t.status)}</td>
        <td></td>
        <td class="num">${t.history.length} runs seen</td>
      </tr>`);
    row.children[2].appendChild(heatStrip(t.history, statusColor));
    container.appendChild(row);
  }
}

// Client-side pager: renders "Showing a–b of N", a page-size picker and
// prev/next into `container`. `onChange` redraws the owning table.
function createPager(container, { sizes, size, noun = '', onChange }) {
  const state = { page: 0, size };
  function render(total) {
    const pages = Math.max(1, Math.ceil(total / state.size));
    if (state.page >= pages) state.page = pages - 1;
    const first = total ? state.page * state.size + 1 : 0;
    const last = Math.min(total, (state.page + 1) * state.size);
    container.innerHTML = `
      <span class="pager-info">${total ? `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}${noun ? ' ' + noun : ''}` : ''}</span>
      <label class="pager-size">Rows
        <select>${sizes.map((n) => `<option value="${n}"${n === state.size ? ' selected' : ''}>${n}</option>`).join('')}</select>
      </label>
      <button class="pager-btn" data-dir="-1" ${state.page === 0 ? 'disabled' : ''}>‹ Prev</button>
      <span class="pager-info">Page ${state.page + 1} of ${pages}</span>
      <button class="pager-btn" data-dir="1" ${state.page >= pages - 1 ? 'disabled' : ''}>Next ›</button>`;
    container.querySelector('select').addEventListener('change', (e) => {
      state.size = parseInt(e.target.value, 10);
      state.page = 0;
      onChange();
    });
    container.querySelectorAll('.pager-btn').forEach((b) => b.addEventListener('click', () => {
      state.page += parseInt(b.dataset.dir, 10);
      onChange();
      container.closest('.card').scrollIntoView({ block: 'start' });
    }));
  }
  return {
    reset() { state.page = 0; },
    slice(rows) { return rows.slice(state.page * state.size, (state.page + 1) * state.size); },
    render,
  };
}

const slowestView = { rows: [], pager: null };

function drawSlowest() {
  const body = document.getElementById('slowest-body');
  body.innerHTML = '';
  const rows = slowestView.rows;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="3" class="empty-state">No test durations recorded.</td></tr>';
  }
  for (const t of slowestView.pager.slice(rows)) {
    body.appendChild(el(`
      <tr>
        <td><strong>${escapeHtml(t.name)}</strong><div style="color:var(--text-muted); font-size:11px;">${escapeHtml(t.suite)}</div></td>
        <td>${chip(t.status)}</td>
        <td class="num">${formatDuration(t.durationMs)}</td>
      </tr>`));
  }
  slowestView.pager.render(rows.length);
}

// Ranks every test in the run by duration. Runs whose snapshot has no test
// list (or predates it) fall back to the processor's precomputed top-10.
function renderSlowest(tests, fallback) {
  if (!slowestView.pager) {
    slowestView.pager = createPager(document.getElementById('slowest-pager'), { sizes: [10, 25, 50, 100], size: 10, noun: 'tests', onChange: drawSlowest });
  }
  slowestView.rows = tests.length ? [...tests].sort((a, b) => b.durationMs - a.durationMs) : fallback;
  slowestView.pager.reset();
  drawSlowest();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function openLightbox(src, alt) {
  const box = el(`<div class="lightbox"><img src="${src}" alt="${escapeHtml(alt || '')}"></div>`);
  box.addEventListener('click', () => box.remove());
  document.body.appendChild(box);
}

// Test detail rows (including nested step attachments) are inserted via
// innerHTML, so listeners can't be attached to individual thumbnails up
// front — a node's outerHTML string carries no event bindings. Delegate
// from a single document-level listener instead; it works no matter where
// or how many times this markup gets re-inserted.
function setupAttachmentLightbox() {
  document.addEventListener('click', (ev) => {
    const link = ev.target.closest('.attachment-thumb');
    if (!link) return;
    ev.preventDefault();
    openLightbox(link.getAttribute('href'), link.title);
  });
}

function renderAttachments(attachments) {
  if (!attachments || !attachments.length) return '';
  const items = attachments.map((a) => {
    if (!a.path) {
      return `<span class="attachment-missing">${escapeHtml(a.name)} (file not found)</span>`;
    }
    if ((a.type || '').startsWith('image/')) {
      return `<a href="${a.path}" class="attachment-thumb" title="${escapeHtml(a.name)}" target="_blank" rel="noopener"><img src="${a.path}" alt="${escapeHtml(a.name)}" loading="lazy"></a>`;
    }
    return `<a href="${a.path}" class="attachment-file" target="_blank" rel="noopener">📎 ${escapeHtml(a.name)}</a>`;
  }).join('');
  return `<div class="attachments">${items}</div>`;
}

function renderSteps(steps) {
  if (!steps || !steps.length) return '';
  return `<ul class="steps-list">${steps.map((s) => `
    <li class="step-item">
      <div class="step-row">${chip(s.status)}<span class="step-name">${escapeHtml(s.name)}</span><span class="step-duration">${formatDuration(s.durationMs)}</span></div>
      ${renderAttachments(s.attachments)}
      ${renderSteps(s.steps)}
    </li>`).join('')}</ul>`;
}

// Fixtures (@Before/@After, beforeEach/afterEach, ...) aren't part of the
// test's own step tree — they wrap it — so they get their own section
// rather than being folded into "Steps". This is where a screenshot taken
// in a teardown hook on failure shows up.
function renderFixtures(fixtures) {
  if (!fixtures || !fixtures.length) return '';
  return `<ul class="steps-list">${fixtures.map((f) => `
    <li class="step-item">
      <div class="step-row">${chip(f.status)}<span class="fixture-phase">${f.phase === 'before' ? 'Before' : 'After'}</span><span class="step-name">${escapeHtml(f.name)}</span><span class="step-duration">${formatDuration(f.durationMs)}</span></div>
      ${renderAttachments(f.attachments)}
      ${renderSteps(f.steps)}
    </li>`).join('')}</ul>`;
}

// ---- labels ---------------------------------------------------------------
// Every Allure label (epic, feature, story, tag, owner, layer, ...) arrives as
// `labels: { name: [values] }`. Snapshots from before labels were captured only
// have suite/severity, so fall back to those.
const PRIMARY_LABELS = ['epic', 'feature', 'story', 'tag'];
const UNASSIGNED = Symbol('unassigned');

function labelsOf(t) {
  return t.labels || { suite: [t.suite], severity: [t.severity] };
}

function labelValues(t, name) {
  const labels = labelsOf(t);
  return Object.hasOwn(labels, name) ? labels[name] : [];
}

function labelTitle(name) {
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Behaviors labels first, then owner/severity, then everything else A–Z.
function orderLabelNames(names) {
  const lead = [...PRIMARY_LABELS, 'owner', 'severity'];
  const rank = (n) => (lead.includes(n) ? lead.indexOf(n) : lead.length);
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function tagClass(name) {
  return PRIMARY_LABELS.includes(name) ? `tag tag-${name}` : 'tag';
}

function tagChip(name, value) {
  return `<span class="${tagClass(name)}" title="${escapeHtml(labelTitle(name))}">${escapeHtml(value)}</span>`;
}

// Compact epic/feature/story/tag chips shown under a test's name in the table.
function labelChips(t, max = 6) {
  const items = [];
  for (const name of PRIMARY_LABELS) for (const v of labelValues(t, name)) items.push([name, v]);
  if (!items.length) return '';
  const more = items.length - max;
  return `<div class="tag-row">${items.slice(0, max).map(([n, v]) => tagChip(n, v)).join('')}${more > 0 ? `<span class="tag tag-more">+${more}</span>` : ''}</div>`;
}

function haystack(t) {
  if (t._hay === undefined) {
    t._hay = [t.name, t.fullName, t.suite, t.historyId, ...Object.values(labelsOf(t)).flat()].join('\n').toLowerCase();
  }
  return t._hay;
}

// Test data is untrusted input: only ever link out to http(s) URLs.
function safeHref(url) {
  try {
    const u = new URL(url, location.href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function descriptionText(t) {
  if (t.description) return t.description;
  if (!t.descriptionHtml) return '';
  // Parsed in an inert document (nothing executes), then reduced to text.
  const doc = new DOMParser().parseFromString(t.descriptionHtml, 'text/html');
  doc.querySelectorAll('script, style').forEach((n) => n.remove());
  return (doc.body.textContent || '').trim();
}

function renderMetadata(t) {
  const rows = [];
  const add = (k, html) => rows.push(`<dt>${escapeHtml(k)}</dt><dd>${html}</dd>`);

  const labels = labelsOf(t);
  for (const name of orderLabelNames(Object.keys(labels))) {
    add(labelTitle(name), labels[name].map((v) => tagChip(name, v)).join(' '));
  }
  if (t.parameters && t.parameters.length) {
    add('Parameters', t.parameters.map((p) => `<div><span class="meta-key">${escapeHtml(p.name)}</span> ${escapeHtml(p.value)}</div>`).join(''));
  }
  if (t.links && t.links.length) {
    add('Links', t.links.map((l) => {
      const href = l.url ? safeHref(l.url) : null;
      const label = `${escapeHtml(l.name)}${l.type && l.type !== 'link' ? ` <span class="meta-key">${escapeHtml(l.type)}</span>` : ''}`;
      return `<div>${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label}</div>`;
    }).join(''));
  }
  const description = descriptionText(t);
  if (description) add('Description', `<div class="meta-text">${escapeHtml(description)}</div>`);

  const flags = [];
  if (t.flaky) flags.push(chip('flaky', 'Flaky'));
  if (t.known) flags.push('<span class="tag">Known issue</span>');
  if (t.muted) flags.push('<span class="tag">Muted</span>');
  if (flags.length) add('Flags', flags.join(' '));

  if (t.start) add('Started', escapeHtml(new Date(t.start).toLocaleString()));
  if (t.stop) add('Finished', escapeHtml(new Date(t.stop).toLocaleString()));
  add('Duration', formatDuration(t.durationMs));
  if (t.stage) add('Stage', escapeHtml(t.stage));
  if (t.titlePath && t.titlePath.length) add('Title path', escapeHtml(t.titlePath.join(' › ')));
  if (t.fullName) add('Full name', `<code>${escapeHtml(t.fullName)}</code>`);
  if (t.testCaseId) add('Test case ID', `<code>${escapeHtml(t.testCaseId)}</code>`);
  if (t.historyId) add('History ID', `<code>${escapeHtml(t.historyId)}</code>`);

  return `<dl class="meta-grid">${rows.join('')}</dl>`;
}

function renderTestDetail(t) {
  const sections = [];
  if (t.message || t.trace) {
    sections.push(`<div class="detail-section"><h4>Error</h4><pre>${escapeHtml(t.message || '')}${t.trace ? '\n\n' + escapeHtml(t.trace) : ''}</pre></div>`);
  }
  if (t.attachments && t.attachments.length) {
    sections.push(`<div class="detail-section"><h4>Screenshots &amp; attachments</h4>${renderAttachments(t.attachments)}</div>`);
  }
  if (t.steps && t.steps.length) {
    sections.push(`<div class="detail-section"><h4>Steps</h4>${renderSteps(t.steps)}</div>`);
  }
  if (t.fixtures && t.fixtures.length) {
    sections.push(`<div class="detail-section"><h4>Setup &amp; teardown</h4>${renderFixtures(t.fixtures)}</div>`);
  }
  sections.push(`<div class="detail-section"><h4>Metadata</h4>${renderMetadata(t)}</div>`);
  return `<div class="test-detail-body">${sections.join('')}</div>`;
}

// ---- test rows ------------------------------------------------------------
// One expandable test row (+ its hidden detail row). The detail panel is built
// on first open, so a page of rows costs nothing until someone drills in.
function appendTestRows(body, t) {
  const row = el(`
    <tr class="test-row">
      <td><strong>${escapeHtml(t.name)}</strong>${t.flaky ? ' ' + chip('flaky', 'Flaky') : ''}<div style="color:var(--text-muted); font-size:11px;">${escapeHtml(t.suite)}</div>${labelChips(t)}</td>
      <td>${chip(t.status)}</td>
      <td>${escapeHtml(t.severity)}</td>
      <td class="num">${formatDuration(t.durationMs)}</td>
      <td class="num">▸</td>
    </tr>`);
  const detail = el('<tr class="test-detail"><td colspan="5"></td></tr>');
  row.addEventListener('click', () => {
    if (!detail.dataset.ready) {
      detail.firstElementChild.innerHTML = renderTestDetail(t);
      detail.dataset.ready = '1';
    }
    detail.classList.toggle('open');
    row.classList.toggle('expanded');
  });
  body.appendChild(row);
  body.appendChild(detail);
}

// Renders `items` into `host` step-by-step, with a "show more" button in
// `footer` until everything is on screen.
function appendChunked(host, footer, items, step, renderItem, noun) {
  let shown = 0;
  const btn = el('<button class="show-more"></button>');
  footer.appendChild(btn);
  const next = () => {
    for (const item of items.slice(shown, shown + step)) renderItem(item);
    shown = Math.min(items.length, shown + step);
    const left = items.length - shown;
    if (left > 0) btn.textContent = `Show ${Math.min(step, left)} more ${noun} (${left.toLocaleString()} remaining)`;
    else btn.remove();
  };
  btn.addEventListener('click', next);
  next();
}

// ---- grouped view (Epic / Feature / Story / tag / any label) ---------------
const STATUS_RANK = { failed: 0, broken: 1, unknown: 2, skipped: 3, passed: 4 };

function countStatuses(tests) {
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
  for (const t of tests) counts[t.status] = (counts[t.status] || 0) + 1;
  return counts;
}

// Nests `tests` by each label in `path` in turn. A test carrying several
// values for a label (two tags, two stories) sits under each of them; one with
// none lands in "Unassigned". Keyed through a Map so odd label values are safe.
function buildGroups(tests, path) {
  if (!path.length) return null;
  const [key, ...rest] = path;
  const byValue = new Map();
  for (const t of tests) {
    const values = labelValues(t, key);
    for (const v of values.length ? values : [UNASSIGNED]) {
      if (!byValue.has(v)) byValue.set(v, []);
      byValue.get(v).push(t);
    }
  }
  const nodes = [...byValue].map(([name, group]) => ({
    name, level: key, tests: group, counts: countStatuses(group), children: buildGroups(group, rest),
  }));
  const bad = (n) => n.counts.failed + n.counts.broken;
  nodes.sort((a, b) => (a.name === UNASSIGNED) - (b.name === UNASSIGNED)
    || bad(b) - bad(a) || b.tests.length - a.tests.length
    || String(a.name).localeCompare(String(b.name)));
  return nodes;
}

function groupOptions(tests) {
  const present = new Set();
  for (const t of tests) for (const k of Object.keys(labelsOf(t))) present.add(k);
  const options = [];
  const behaviors = ['epic', 'feature', 'story'].filter((k) => present.has(k));
  if (behaviors.length > 1) {
    options.push({ id: 'behaviors', label: `Behaviors (${behaviors.map(labelTitle).join(' › ')})`, path: behaviors });
  }
  for (const name of orderLabelNames(present)) options.push({ id: `label:${name}`, label: labelTitle(name), path: [name] });
  return options;
}

function renderLeaf(tests) {
  const wrap = el(`
    <div class="group-leaf">
      <div class="table-scroll"><table>
        <thead><tr><th>Test</th><th>Status</th><th>Severity</th><th>Duration</th><th></th></tr></thead>
        <tbody></tbody>
      </table></div>
      <div class="leaf-footer"></div>
    </div>`);
  const ranked = [...tests].sort((a, b) => (STATUS_RANK[a.status] ?? 2) - (STATUS_RANK[b.status] ?? 2));
  const body = wrap.querySelector('tbody');
  appendChunked(body, wrap.querySelector('.leaf-footer'), ranked, 50, (t) => appendTestRows(body, t), 'tests');
  return wrap;
}

function renderGroupNode(node) {
  const total = node.tests.length;
  const c = node.counts;
  const failures = c.failed + c.broken;
  const name = node.name === UNASSIGNED ? 'Unassigned' : node.name;
  const segments = STATUS_ORDER.filter((s) => c[s]).map((s) => `<span style="width:${(c[s] / total) * 100}%;background:${statusColor(s)}"></span>`).join('');
  const wrap = el(`
    <div class="group">
      <button class="group-head" aria-expanded="false">
        <span class="caret">▸</span>
        <span class="group-name">${escapeHtml(name)}</span>
        <span class="group-level">${escapeHtml(labelTitle(node.level))}</span>
        <span class="group-stats">
          ${failures ? chip('failed', `${failures.toLocaleString()} failed`) : ''}
          <span class="group-bar" title="${STATUS_ORDER.filter((s) => c[s]).map((s) => `${STATUS_META[s].label}: ${c[s]}`).join(', ')}">${segments}</span>
          <span class="group-counts">${total.toLocaleString()} test${total === 1 ? '' : 's'} · ${pct(c.passed, total)}% passed</span>
        </span>
      </button>
      <div class="group-body" hidden></div>
    </div>`);
  const head = wrap.querySelector('.group-head');
  const bodyEl = wrap.querySelector('.group-body');
  head.addEventListener('click', () => {
    const open = bodyEl.hidden;
    bodyEl.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    wrap.classList.toggle('open', open);
    if (open && !bodyEl.dataset.ready) {
      bodyEl.dataset.ready = '1';
      if (node.children) {
        const footer = el('<div class="leaf-footer"></div>');
        appendChunked(bodyEl, footer, node.children, 50, (child) => bodyEl.appendChild(renderGroupNode(child)), node.children[0] ? `${labelTitle(node.children[0].level).toLowerCase()} groups` : 'groups');
        bodyEl.appendChild(footer);
      } else {
        bodyEl.appendChild(renderLeaf(node.tests));
      }
    }
  });
  return wrap;
}

function pct(n, total) {
  return total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
}

// ---- All tests card: list + grouped views ----------------------------------
const testsView = { tests: [], activeStatus: 'all', view: 'list', groupBy: null, options: [], pager: null, groupPager: null };

function filteredTests() {
  const q = document.getElementById('test-search').value.trim().toLowerCase();
  const { activeStatus } = testsView;
  return testsView.tests.filter((t) => {
    const statusOk = activeStatus === 'all' ? true
      : activeStatus === 'flaky' ? t.flaky
      : t.status === activeStatus;
    return statusOk && (!q || haystack(t).includes(q));
  });
}

function drawTestsView() {
  const isList = testsView.view === 'list';
  document.getElementById('view-list').hidden = !isList;
  document.getElementById('view-grouped').hidden = isList;
  document.getElementById('group-by-wrap').hidden = isList || !testsView.options.length;
  document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === testsView.view));

  const filtered = filteredTests();
  if (isList) drawTestList(filtered);
  else drawGroups(filtered);
}

function drawTestList(filtered) {
  const body = document.getElementById('tests-body');
  body.innerHTML = '';
  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty-state">No tests match this filter.</td></tr>';
  }
  for (const t of testsView.pager.slice(filtered)) appendTestRows(body, t);
  testsView.pager.render(filtered.length);
}

function drawGroups(filtered) {
  const host = document.getElementById('groups');
  host.innerHTML = '';
  const option = testsView.options.find((o) => o.id === testsView.groupBy);
  if (!option || !filtered.length) {
    host.innerHTML = `<div class="empty-state">${option ? 'No tests match this filter.' : 'No labels to group by.'}</div>`;
    testsView.groupPager.render(0);
    return;
  }
  const nodes = buildGroups(filtered, option.path);
  const memberships = nodes.reduce((sum, n) => sum + n.tests.length, 0);
  if (memberships > filtered.length) {
    host.appendChild(el(`<div class="group-hint">${filtered.length.toLocaleString()} tests in ${nodes.length.toLocaleString()} groups — a test with several values appears under each one.</div>`));
  }
  for (const node of testsView.groupPager.slice(nodes)) host.appendChild(renderGroupNode(node));
  testsView.groupPager.render(nodes.length);
}

function resetAndDraw() {
  testsView.pager.reset();
  testsView.groupPager.reset();
  drawTestsView();
}

// Search, filter chips, view toggle and group-by are bound once; switching
// runs only swaps the data underneath them.
function setupTestsView() {
  testsView.pager = createPager(document.getElementById('tests-pager'), { sizes: [25, 50, 100, 250], size: 50, noun: 'tests', onChange: drawTestsView });
  testsView.groupPager = createPager(document.getElementById('groups-pager'), { sizes: [10, 25, 50, 100], size: 25, noun: 'groups', onChange: drawTestsView });

  document.getElementById('test-search').addEventListener('input', resetAndDraw);
  const chips = document.querySelectorAll('.filter-chip');
  chips.forEach((c) => c.addEventListener('click', () => {
    chips.forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    testsView.activeStatus = c.dataset.status;
    resetAndDraw();
  }));
  document.querySelectorAll('.view-btn').forEach((b) => b.addEventListener('click', () => {
    testsView.view = b.dataset.view;
    drawTestsView();
  }));
  document.getElementById('group-by').addEventListener('change', (e) => {
    testsView.groupBy = e.target.value;
    testsView.groupPager.reset();
    drawTestsView();
  });
}

function renderTestTable(tests) {
  if (!testsView.pager) setupTestsView();
  testsView.tests = tests;
  testsView.options = groupOptions(tests);
  if (!testsView.options.some((o) => o.id === testsView.groupBy)) {
    const preferred = testsView.options.find((o) => o.id === 'behaviors')
      || testsView.options.find((o) => PRIMARY_LABELS.includes(o.path[0]))
      || testsView.options[0];
    testsView.groupBy = preferred ? preferred.id : null;
  }
  const select = document.getElementById('group-by');
  select.innerHTML = testsView.options.map((o) => `<option value="${escapeHtml(o.id)}"${o.id === testsView.groupBy ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
  resetAndDraw();
}

function renderRun(run, prevRun) {
  document.getElementById('run-meta').textContent =
    `Run ${run.label} · ${run.total} tests · generated ${formatTime(run.timestamp)}`;
  renderKPIs(run, prevRun);
  renderSuiteBars(run.suites || []);
  renderSeverityBars(run.severities || []);
  renderCategories(run.categories || []);
  renderFlaky(run.flakyTests || []);
  renderSlowest(run.tests || [], run.slowest || []);
  renderTestTable(run.tests || []);
}

function setupRunPicker(history, latest) {
  const picker = document.getElementById('run-picker');
  if (!history.length) {
    picker.style.display = 'none';
    return;
  }
  picker.innerHTML = history.map((r, i) => `
    <option value="${r.runId}">${i === 0 ? '● ' : ''}${r.label} — ${new Date(r.timestamp).toLocaleDateString()} (${r.passRate}%)</option>
  `).join('');

  picker.addEventListener('change', async () => {
    const runId = picker.value;
    const idx = history.findIndex((r) => r.runId === runId);
    const prevRun = history[idx + 1];
    if (idx === 0) {
      renderRun(latest, prevRun);
      return;
    }
    const snapshot = await loadJSON(`./data/runs/${encodeURIComponent(runId)}.json`, null);
    if (snapshot) {
      renderRun(snapshot, prevRun);
    } else {
      // No full snapshot persisted for this older run — fall back to its rollup numbers only.
      const rollup = history[idx];
      renderRun({ ...rollup, suites: [], severities: [], categories: [], flakyTests: [], slowest: [], tests: [] }, prevRun);
      document.getElementById('run-meta').textContent += ' · full detail not available for this run';
    }
  });
}

async function main() {
  applyStoredTheme();
  setupThemeToggle();
  setupAttachmentLightbox();

  const [latest, history, meta] = await Promise.all([
    loadJSON('./data/latest.json', null),
    loadJSON('./data/history.json', []),
    loadJSON('./data/meta.json', {}),
  ]);

  document.getElementById('dash-title').textContent = meta.title || 'Allure Dashboard';
  document.title = meta.title || 'Allure Dashboard';

  const traceabilityLink = document.getElementById('traceability-link');
  const traceabilityHref = meta.traceabilityUrl ? safeHref(meta.traceabilityUrl) : null;
  if (traceabilityHref) {
    traceabilityLink.href = traceabilityHref;
    traceabilityLink.hidden = false;
  }

  if (!latest) {
    document.getElementById('app').innerHTML = '<div class="empty-state">No dashboard data found yet — run the action to generate data/latest.json.</div>';
    return;
  }

  const prevRun = history[1];
  renderRun(latest, prevRun);
  renderTrends(history);
  setupRunPicker(history, latest);

  handleDeepLink();
  window.addEventListener('hashchange', handleDeepLink);
}

// Consumes `#test=<historyId>` — the link shape the Allure Traceability
// Matrix action (a separate, optional companion) builds when its
// dashboard-url input is set. Switches to the List view, clears the status
// filter, and searches for the historyId (haystack() includes it), which
// narrows to that one test since historyId is a stable per-test id; then
// expands and scrolls to it. A stale link (test not in the current/selected
// run) just leaves the search box on that historyId with no match — no error.
function handleDeepLink() {
  const testId = new URLSearchParams(location.hash.slice(1)).get('test');
  if (!testId) return;
  testsView.view = 'list';
  document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === 'list'));
  testsView.activeStatus = 'all';
  document.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c.dataset.status === 'all'));
  document.getElementById('test-search').value = testId;
  resetAndDraw();
  requestAnimationFrame(() => {
    const row = document.querySelector('#tests-body tr.test-row');
    if (row) {
      row.scrollIntoView({ block: 'center' });
      if (!row.classList.contains('expanded')) row.click();
    }
  });
}

main();
