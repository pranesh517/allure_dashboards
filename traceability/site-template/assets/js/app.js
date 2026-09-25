import { escapeHtml, safeHref } from './escape.js';

const REQ_STATUS_META = {
  passing: { label: 'Passing' },
  failing: { label: 'Failing' },
  partial: { label: 'Partial' },
  skipped: { label: 'Skipped' },
  'not-covered': { label: 'Not covered' },
};
const TEST_STATUS_META = {
  passed: { label: 'Passed' },
  failed: { label: 'Failed' },
  broken: { label: 'Broken' },
  skipped: { label: 'Skipped' },
  unknown: { label: 'Unknown' },
};

function chip(status, meta) {
  const m = meta[status] || { label: status };
  return `<span class="chip ${status}"><span class="dot"></span>${escapeHtml(m.label)}</span>`;
}

function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
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
  try {
    const saved = localStorage.getItem('allure-traceability-theme');
    if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
  } catch {
    // private-mode / blocked storage — fall back to the OS preference, which the CSS already handles
  }
}

function setupThemeToggle() {
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('allure-traceability-theme', next);
    } catch {
      // best-effort only
    }
  });
}

// ---- generic pager (same shape as the dashboard's) -------------------------
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

function dashboardLink(url, label) {
  const href = url ? safeHref(url) : null;
  return href ? ` <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="Open in dashboard">${escapeHtml(label || '↗')}</a>` : '';
}

// ---- KPI cards ---------------------------------------------------------
function renderKPIs(summary) {
  const r = summary.requirements;
  const tiles = [
    { value: r.total.toLocaleString(), label: 'Requirements', cls: '' },
    { value: r.covered.toLocaleString(), label: 'Covered (has tests)', cls: '' },
    { value: r.notCovered.toLocaleString(), label: 'Not covered', cls: r.notCovered ? 'bad' : 'good' },
    { value: r.failing.toLocaleString(), label: 'Failing', cls: r.failing ? 'bad' : 'good' },
    { value: `${r.coveragePercent}%`, label: 'Coverage (all-passing)', cls: r.coveragePercent >= 80 ? 'good' : r.coveragePercent >= 50 ? 'warn' : 'bad' },
    { value: `${summary.orphanTests.count.toLocaleString()}`, label: `Orphan tests (${summary.orphanTests.rate}% of all tests)`, cls: summary.orphanTests.count ? 'warn' : 'good' },
  ];
  document.getElementById('kpi-grid').innerHTML = tiles.map((t) => `
    <div class="card kpi ${t.cls}">
      <div class="value">${t.value}</div>
      <div class="label">${escapeHtml(t.label)}</div>
    </div>`).join('');
}

function renderMeta(summary) {
  document.getElementById('page-title').textContent = summary.title || 'Traceability Matrix';
  document.title = summary.title || 'Traceability Matrix';
  const denomNote = summary.denominatorSource === 'file'
    ? 'coverage is measured against your requirements-file'
    : 'no requirements-file given — coverage is measured against the requirement ids found in test results';
  const generated = (() => { try { return new Date(summary.generatedAt).toLocaleString(); } catch { return summary.generatedAt; } })();
  const retryNote = summary.retriedTests ? ` · ${summary.retriedTests} test(s) had retries (last result used)` : '';
  document.getElementById('run-meta').textContent = `${summary.totalTests.toLocaleString()} tests · ${denomNote} · generated ${generated}${retryNote}`;
  const link = document.getElementById('dashboard-link');
  const href = summary.dashboardUrl ? safeHref(summary.dashboardUrl) : null;
  if (href) {
    link.href = href;
    link.hidden = false;
  }
}

// ---- coverage by epic/feature ------------------------------------------
// ---- test annotation coverage (epic/feature/story labels vs the configured
// requirement annotation) — a flat comparison, not a drill-down, so these
// rows aren't clickable like the "Coverage by" ones below.
function renderAnnotationCoverage(rows, totalTests) {
  const host = document.getElementById('annotation-bars');
  if (!rows || !rows.length) {
    host.innerHTML = '<div class="empty-state">No annotations to compare.</div>';
    return;
  }
  host.innerHTML = rows.map((r) => `
    <div class="group-bar-row static${r.isRequirement ? ' requirement-row' : ''}">
      <span class="name">${escapeHtml(r.name)}</span>
      <span class="track"><span class="fill" style="width:${r.rate}%"></span></span>
      <span class="stat">${r.count.toLocaleString()} of ${totalTests.toLocaleString()} tests · ${r.rate}%</span>
    </div>`).join('');
}

const groupState = { data: { epic: [], feature: [], story: [] }, active: 'epic', filter: null };

function renderGroupBars() {
  const rows = groupState.data[groupState.active] || [];
  const host = document.getElementById('group-bars');
  if (!rows.length) {
    host.innerHTML = '<div class="empty-state">No labels to group by.</div>';
    return;
  }
  host.innerHTML = '';
  for (const g of rows) {
    const isActive = groupState.filter && groupState.filter.label === groupState.active && groupState.filter.value === g.name;
    const row = el(`
      <button class="group-bar-row ${isActive ? 'active' : ''}" title="Click to filter the matrix">
        <span class="name">${escapeHtml(g.name)}</span>
        <span class="track"><span class="fill" style="width:${g.total ? (g.coveragePercent) : 0}%"></span></span>
        <span class="stat">${g.covered}/${g.total} covered · ${g.coveragePercent}%${g.failing ? ` · ${g.failing} failing` : ''}</span>
      </button>`);
    row.addEventListener('click', () => {
      groupState.filter = isActive ? null : { label: groupState.active, value: g.name };
      renderGroupBars();
      renderGroupFilterBadge();
      matrixView.pager.reset();
      drawMatrix();
    });
    host.appendChild(row);
  }
}

function renderGroupFilterBadge() {
  const host = document.getElementById('group-filter-badge');
  if (!groupState.filter) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  host.hidden = false;
  host.innerHTML = `<span class="tag">Filtered to ${escapeHtml(groupState.filter.label)}: ${escapeHtml(groupState.filter.value)} <button id="clear-group-filter" style="border:none;background:none;cursor:pointer;color:inherit;font:inherit;">✕</button></span>`;
  document.getElementById('clear-group-filter').addEventListener('click', () => {
    groupState.filter = null;
    renderGroupBars();
    renderGroupFilterBadge();
    matrixView.pager.reset();
    drawMatrix();
  });
}

function setupGroupTabs() {
  document.querySelectorAll('#group-by-tabs .tab-btn').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#group-by-tabs .tab-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    groupState.active = b.dataset.group;
    renderGroupBars();
  }));
}

// ---- view tabs ------------------------------------------------------------
const TABS = ['matrix', 'tests', 'orphans', 'gaps'];

function setupViewTabs() {
  document.querySelectorAll('#view-tabs .tab-btn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
}

function switchTab(tab) {
  if (!TABS.includes(tab)) tab = 'matrix';
  document.querySelectorAll('#view-tabs .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  for (const t of TABS) document.getElementById(`panel-${t}`).hidden = t !== tab;
  const url = new URL(location.href);
  url.hash = `tab=${tab}`;
  history.replaceState(null, '', url);
}

// ---- Matrix tab -------------------------------------------------------
const matrixView = { requirements: [], activeStatus: 'all', pager: null };

function requirementMatches(r, q) {
  if (!q) return true;
  const hay = [r.id, r.title, r.epic, r.feature, r.priority, ...Object.values(r.groups || {}).flat()]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return hay.includes(q);
}

function filteredRequirements() {
  const q = document.getElementById('matrix-search').value.trim().toLowerCase();
  return matrixView.requirements.filter((r) => {
    const statusOk = matrixView.activeStatus === 'all' || r.status === matrixView.activeStatus;
    const groupOk = !groupState.filter || (r.groups?.[groupState.filter.label] || []).includes(groupState.filter.value);
    return statusOk && groupOk && requirementMatches(r, q);
  });
}

// requirements-file column if given, else whatever `groups` (see render.mjs)
// resolved from the requirement's covering tests — the same fallback the
// "Coverage by" filter already uses, so the table doesn't show "—" for an
// answer the report actually has (common with no requirements-file at all).
function groupDisplay(r, label) {
  if (r[label]) return r[label];
  const values = r.groups?.[label];
  return values && values.length ? values.join(', ') : null;
}

function requirementRow(r) {
  const epic = groupDisplay(r, 'epic');
  const feature = groupDisplay(r, 'feature');
  const row = el(`
    <tr class="row-clickable" id="req-row-${escapeHtml(r.key || r.id)}">
      <td><div class="req-id">${escapeHtml(r.id)}</div>${r.title ? `<div class="req-title">${escapeHtml(r.title)}</div>` : ''}</td>
      <td>${epic ? `<span class="tag">${escapeHtml(epic)}</span>` : '—'}</td>
      <td>${feature ? `<span class="tag">${escapeHtml(feature)}</span>` : '—'}</td>
      <td>${r.priority ? escapeHtml(r.priority) : '—'}</td>
      <td class="num">${r.testCount}</td>
      <td>${chip(r.status, REQ_STATUS_META)}</td>
      <td class="num">${r.testCount ? '▸' : ''}</td>
    </tr>`);
  if (r.testCount) {
    const detail = el('<tr class="detail-row"><td colspan="7"><div class="inner"></div></td></tr>');
    row.addEventListener('click', () => {
      if (!detail.dataset.ready) {
        detail.querySelector('.inner').innerHTML = `
          <table><thead><tr><th>Test case</th><th>Name</th><th>Status</th><th>Duration</th></tr></thead>
          <tbody>${r.tests.map((t) => `
            <tr>
              <td><code>${escapeHtml(t.testCaseId)}</code>${!t.hasExplicitTestCaseId ? ' <span class="tag">fullName</span>' : ''}</td>
              <td>${escapeHtml(t.name)}${dashboardLink(t.dashboardUrl)}</td>
              <td>${chip(t.status, TEST_STATUS_META)}</td>
              <td class="num">${formatDuration(t.durationMs)}</td>
            </tr>`).join('')}</tbody></table>`;
        detail.dataset.ready = '1';
      }
      detail.classList.toggle('open');
      row.classList.toggle('expanded');
    });
    return [row, detail];
  }
  return [row];
}

function drawMatrix() {
  const body = document.getElementById('matrix-body');
  body.innerHTML = '';
  const filtered = filteredRequirements();
  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty-state">No requirements match this filter.</td></tr>';
  }
  for (const r of matrixView.pager.slice(filtered)) {
    for (const el2 of requirementRow(r)) body.appendChild(el2);
  }
  matrixView.pager.render(filtered.length);
}

function setupMatrix() {
  matrixView.pager = createPager(document.getElementById('matrix-pager'), { sizes: [25, 50, 100, 250], size: 50, noun: 'requirements', onChange: drawMatrix });
  const redraw = () => { matrixView.pager.reset(); drawMatrix(); };
  document.getElementById('matrix-search').addEventListener('input', redraw);
  const chips = document.querySelectorAll('#panel-matrix .filter-chip');
  chips.forEach((c) => c.addEventListener('click', () => {
    chips.forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    matrixView.activeStatus = c.dataset.status;
    redraw();
  }));
}

// ---- Tests tab (reverse view) + Orphan Tests tab ---------------------------
function testRow(t) {
  const reqChips = (t.requirementIds || []).length
    ? t.requirementIds.map((id) => `<span class="tag">${escapeHtml(id)}</span>`).join(' ')
    : '<span class="tag" style="border-style:dashed;color:var(--text-muted);">none</span>';
  return `
    <tr id="test-row-${escapeHtml(t.historyId)}">
      <td><strong>${escapeHtml(t.name)}</strong>${dashboardLink(t.dashboardUrl)}<div class="test-name-sub"><code>${escapeHtml(t.testCaseId)}</code>${!t.hasExplicitTestCaseId ? ' <span class="tag">fullName</span>' : ''}</div></td>
      <td>${escapeHtml(t.suite)}</td>
      <td>${reqChips}</td>
      <td>${chip(t.status, TEST_STATUS_META)}</td>
      <td class="num">${formatDuration(t.durationMs)}</td>
    </tr>`;
}

const testsView = { tests: [], activeStatus: 'all', pager: null };

function drawTests() {
  const q = document.getElementById('tests-search').value.trim().toLowerCase();
  const filtered = testsView.tests.filter((t) => {
    const statusOk = testsView.activeStatus === 'all' || t.status === testsView.activeStatus;
    const hay = [t.name, t.fullName, t.testCaseId, t.suite].join('\n').toLowerCase();
    return statusOk && (!q || hay.includes(q));
  });
  const body = document.getElementById('tests-body');
  body.innerHTML = filtered.length ? testsView.pager.slice(filtered).map(testRow).join('') : '<tr><td colspan="5" class="empty-state">No tests match this filter.</td></tr>';
  testsView.pager.render(filtered.length);
}

function setupTests() {
  testsView.pager = createPager(document.getElementById('tests-pager'), { sizes: [25, 50, 100, 250], size: 50, noun: 'tests', onChange: drawTests });
  const redraw = () => { testsView.pager.reset(); drawTests(); };
  document.getElementById('tests-search').addEventListener('input', redraw);
  const chips = document.querySelectorAll('#panel-tests .filter-chip');
  chips.forEach((c) => c.addEventListener('click', () => {
    chips.forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    testsView.activeStatus = c.dataset.status;
    redraw();
  }));
}

const orphansView = { tests: [], pager: null };

function drawOrphans() {
  const q = document.getElementById('orphans-search').value.trim().toLowerCase();
  const filtered = orphansView.tests.filter((t) => {
    const hay = [t.name, t.fullName, t.testCaseId, t.suite].join('\n').toLowerCase();
    return !q || hay.includes(q);
  });
  const body = document.getElementById('orphans-body');
  body.innerHTML = filtered.length ? orphansView.pager.slice(filtered).map((t) => `
    <tr id="test-row-${escapeHtml(t.historyId)}">
      <td><strong>${escapeHtml(t.name)}</strong>${dashboardLink(t.dashboardUrl)}<div class="test-name-sub"><code>${escapeHtml(t.testCaseId)}</code></div></td>
      <td>${escapeHtml(t.suite)}</td>
      <td>${escapeHtml(t.severity)}</td>
      <td>${chip(t.status, TEST_STATUS_META)}</td>
      <td class="num">${formatDuration(t.durationMs)}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty-state">No orphan tests match this filter.</td></tr>';
  orphansView.pager.render(filtered.length);
}

function setupOrphans() {
  orphansView.pager = createPager(document.getElementById('orphans-pager'), { sizes: [25, 50, 100, 250], size: 50, noun: 'tests', onChange: drawOrphans });
  document.getElementById('orphans-search').addEventListener('input', () => { orphansView.pager.reset(); drawOrphans(); });
}

// ---- Gaps tab -----------------------------------------------------------
function renderGaps(summary, requirementsData, ignoredValues) {
  const notCovered = requirementsData.requirements.filter((r) => r.status === 'not-covered');
  document.getElementById('gaps-not-covered-count').textContent = `(${notCovered.length})`;
  const ncHost = document.getElementById('gaps-not-covered');
  if (summary.denominatorSource !== 'file') {
    ncHost.innerHTML = '<div class="empty-state">No requirements-file was given, so nothing can be "not covered" — every id in this mode came from a test.</div>';
  } else if (!notCovered.length) {
    ncHost.innerHTML = '<div class="empty-state">Every requirement in the file has at least one test.</div>';
  } else {
    ncHost.innerHTML = `<div class="table-scroll"><table><thead><tr><th>Requirement</th><th>Epic</th><th>Feature</th><th>Priority</th></tr></thead><tbody>${notCovered.map((r) => `
      <tr class="row-clickable" data-jump="${escapeHtml(r.key || r.id)}">
        <td><div class="req-id">${escapeHtml(r.id)}</div>${r.title ? `<div class="req-title">${escapeHtml(r.title)}</div>` : ''}</td>
        <td>${groupDisplay(r, 'epic') ? escapeHtml(groupDisplay(r, 'epic')) : '—'}</td>
        <td>${groupDisplay(r, 'feature') ? escapeHtml(groupDisplay(r, 'feature')) : '—'}</td>
        <td>${r.priority ? escapeHtml(r.priority) : '—'}</td>
      </tr>`).join('')}</tbody></table></div>`;
    ncHost.querySelectorAll('[data-jump]').forEach((row) => row.addEventListener('click', () => jumpToRequirement(row.dataset.jump)));
  }

  const unknown = requirementsData.unknown;
  document.getElementById('gaps-unknown-count').textContent = `(${unknown.length})`;
  const unkHost = document.getElementById('gaps-unknown');
  unkHost.innerHTML = unknown.length
    ? `<div class="table-scroll"><table><thead><tr><th>Id used in results</th><th>Tests</th></tr></thead><tbody>${unknown.map((r) => `
        <tr><td>${escapeHtml(r.id)}</td><td>${r.tests.map((t) => escapeHtml(t.name)).join(', ')}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state">No requirement ids were found that are missing from the requirements-file.</div>';

  document.getElementById('gaps-ignored-count').textContent = `(${ignoredValues.length})`;
  const igHost = document.getElementById('gaps-ignored');
  igHost.innerHTML = ignoredValues.length
    ? `<div class="table-scroll"><table><thead><tr><th>Value</th><th>Source</th><th>Test</th></tr></thead><tbody>${ignoredValues.map((v) => `
        <tr><td><code>${escapeHtml(v.value)}</code></td><td>${escapeHtml(v.source)}</td><td>${escapeHtml(v.test)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state">No annotation values were ignored by the id-pattern.</div>';
}

// ---- deep link: #req=<id> or #tab=<name> ------------------------------
function jumpToRequirement(key) {
  switchTab('matrix');
  matrixView.activeStatus = 'all';
  document.querySelectorAll('#panel-matrix .filter-chip').forEach((c) => c.classList.toggle('active', c.dataset.status === 'all'));
  const req = matrixView.requirements.find((r) => (r.key || r.id) === key);
  document.getElementById('matrix-search').value = req ? req.id : key;
  matrixView.pager.reset();
  drawMatrix();
  requestAnimationFrame(() => {
    const row = document.getElementById(`req-row-${CSS.escape(key)}`);
    if (row) {
      row.scrollIntoView({ block: 'center' });
      row.classList.add('highlight-row', 'flash');
      if (row.querySelector('td:last-child')?.textContent.trim() === '▸') row.click();
    }
  });
}

function handleInitialHash() {
  const hash = location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const req = params.get('req');
  if (req) {
    jumpToRequirement(req);
    return;
  }
  const tab = params.get('tab');
  if (tab) switchTab(tab);
}

async function main() {
  applyStoredTheme();
  setupThemeToggle();
  setupGroupTabs();
  setupViewTabs();
  setupMatrix();
  setupTests();
  setupOrphans();

  const [summary, requirementsData, testsData] = await Promise.all([
    loadJSON('./data/summary.json', null),
    loadJSON('./data/requirements.json', { requirements: [], unknown: [] }),
    loadJSON('./data/tests.json', { tests: [], orphanTests: [], ignoredValues: [] }),
  ]);

  if (!summary) {
    document.getElementById('run-meta').textContent = 'No data found — run the action before opening this page.';
    return;
  }

  renderMeta(summary);
  renderKPIs(summary);
  renderAnnotationCoverage(summary.annotationCoverage, summary.totalTests);
  groupState.data = { epic: summary.byEpic || [], feature: summary.byFeature || [], story: summary.byStory || [] };
  renderGroupBars();

  matrixView.requirements = requirementsData.requirements;
  drawMatrix();

  testsView.tests = testsData.tests;
  drawTests();

  orphansView.tests = testsData.orphanTests;
  document.getElementById('orphans-note').textContent =
    `${testsData.orphanTests.length.toLocaleString()} test(s) carry no requirement/test-case id at all — nothing in this matrix traces to them. Sorted by severity, worst first.`;
  drawOrphans();

  renderGaps(summary, requirementsData, testsData.ignoredValues);

  for (let i = 0; i < document.querySelectorAll('#view-tabs .tab-btn').length; i++) {
    const b = document.querySelectorAll('#view-tabs .tab-btn')[i];
    b.querySelector('.count')?.remove();
  }
  document.querySelector('#view-tabs [data-tab="orphans"]').innerHTML =
    `Orphan Tests${summary.orphanTests.count ? ` <span class="count">${summary.orphanTests.count}</span>` : ''}`;

  handleInitialHash();
  window.addEventListener('hashchange', handleInitialHash);
}

main();
