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

function renderSlowest(slowest) {
  const container = document.getElementById('slowest-body');
  container.innerHTML = '';
  if (!slowest.length) { container.innerHTML = '<tr><td colspan="3" class="empty-state">No test durations recorded.</td></tr>'; return; }
  for (const t of slowest) {
    container.appendChild(el(`
      <tr>
        <td><strong>${t.name}</strong><div style="color:var(--text-muted); font-size:11px;">${t.suite}</div></td>
        <td>${chip(t.status)}</td>
        <td class="num">${formatDuration(t.durationMs)}</td>
      </tr>`));
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderTestTable(tests) {
  const body = document.getElementById('tests-body');
  const search = document.getElementById('test-search');
  const chips = document.querySelectorAll('.filter-chip');
  let activeStatus = 'all';

  function draw() {
    const q = search.value.trim().toLowerCase();
    const filtered = tests.filter((t) => {
      const statusOk = activeStatus === 'all' ? true
        : activeStatus === 'flaky' ? t.flaky
        : t.status === activeStatus;
      const searchOk = !q || t.name.toLowerCase().includes(q) || t.suite.toLowerCase().includes(q);
      return statusOk && searchOk;
    });

    body.innerHTML = '';
    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">No tests match this filter.</td></tr>';
      return;
    }
    for (const t of filtered.slice(0, 300)) {
      const row = el(`
        <tr class="test-row">
          <td><strong>${escapeHtml(t.name)}</strong>${t.flaky ? ' ' + chip('flaky', 'Flaky') : ''}<div style="color:var(--text-muted); font-size:11px;">${escapeHtml(t.suite)}</div></td>
          <td>${chip(t.status)}</td>
          <td>${t.severity}</td>
          <td class="num">${formatDuration(t.durationMs)}</td>
          <td class="num">${t.message ? '▸' : ''}</td>
        </tr>`);
      body.appendChild(row);
      if (t.message || t.trace) {
        const detail = el(`
          <tr class="test-detail">
            <td colspan="5"><pre>${escapeHtml(t.message || '')}${t.trace ? '\n\n' + escapeHtml(t.trace) : ''}</pre></td>
          </tr>`);
        body.appendChild(detail);
        row.addEventListener('click', () => detail.classList.toggle('open'));
      }
    }
  }

  search.addEventListener('input', draw);
  chips.forEach((c) => c.addEventListener('click', () => {
    chips.forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    activeStatus = c.dataset.status;
    draw();
  }));

  draw();
}

function renderRun(run, prevRun) {
  document.getElementById('run-meta').textContent =
    `Run ${run.label} · ${run.total} tests · generated ${formatTime(run.timestamp)}`;
  renderKPIs(run, prevRun);
  renderSuiteBars(run.suites || []);
  renderSeverityBars(run.severities || []);
  renderCategories(run.categories || []);
  renderFlaky(run.flakyTests || []);
  renderSlowest(run.slowest || []);
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

  const [latest, history, meta] = await Promise.all([
    loadJSON('./data/latest.json', null),
    loadJSON('./data/history.json', []),
    loadJSON('./data/meta.json', {}),
  ]);

  document.getElementById('dash-title').textContent = meta.title || 'Allure Dashboard';
  document.title = meta.title || 'Allure Dashboard';

  if (!latest) {
    document.getElementById('app').innerHTML = '<div class="empty-state">No dashboard data found yet — run the action to generate data/latest.json.</div>';
    return;
  }

  const prevRun = history[1];
  renderRun(latest, prevRun);
  renderTrends(history);
  setupRunPicker(history, latest);
}

main();
