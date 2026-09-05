// Minimal, dependency-free SVG chart primitives for the Allure dashboard.
// Every chart ships its own hover layer (crosshair + tooltip on lines,
// per-mark tooltip on the donut) per the dataviz interaction rules.

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function sharedTooltip() {
  let tip = document.querySelector('.viz-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'viz-tooltip';
    document.body.appendChild(tip);
  }
  return tip;
}

function showTooltip(x, y, html) {
  const tip = sharedTooltip();
  tip.innerHTML = html;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
  tip.classList.add('show');
}

function hideTooltip() {
  sharedTooltip().classList.remove('show');
}

/** A ring showing percent complete, with the value centered inside it. */
export function donut({ percent, size = 108, strokeWidth = 12, color, trackColor }) {
  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.max(0, Math.min(100, percent)) / 100);

  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  const track = svgEl('circle', {
    cx: c, cy: c, r,
    fill: 'none', stroke: trackColor, 'stroke-width': strokeWidth,
  });
  const arc = svgEl('circle', {
    cx: c, cy: c, r,
    fill: 'none', stroke: color, 'stroke-width': strokeWidth,
    'stroke-linecap': 'round',
    'stroke-dasharray': circumference,
    'stroke-dashoffset': offset,
    transform: `rotate(-90 ${c} ${c})`,
  });
  const text = svgEl('text', {
    x: c, y: c + 6, 'text-anchor': 'middle',
    'font-size': size * 0.22, 'font-weight': 600, fill: 'var(--text-primary)',
  });
  text.textContent = `${Math.round(percent)}%`;

  svg.append(track, arc, text);
  return svg;
}

/**
 * A single-series line chart with a hover crosshair + tooltip.
 * points: [{ label, value }], oldest first.
 */
export function lineChart({ points, color, height = 160, valueFormat = (v) => String(v), unit = '' }) {
  const width = 560;
  const padL = 8, padR = 8, padT = 12, padB = 22;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const wrap = document.createElement('div');
  wrap.style.position = 'relative';

  if (!points || points.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Not enough history yet — this fills in after a couple of runs.</div>';
    return wrap;
  }

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  min -= pad; max += pad;

  const x = (i) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => padT + innerH - ((v - min) / (max - min)) * innerH;

  const svg = svgEl('svg', { width: '100%', height, viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none' });

  // recessive gridlines (3 rows)
  for (let i = 0; i <= 2; i++) {
    const gy = padT + (innerH / 2) * i;
    svg.appendChild(svgEl('line', { x1: padL, x2: width - padR, y1: gy, y2: gy, stroke: 'var(--gridline)', 'stroke-width': 1 }));
  }

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  svg.appendChild(svgEl('path', { d: pathD, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  // fill under the line, faint
  const areaD = `${pathD} L ${x(points.length - 1).toFixed(1)} ${(padT + innerH).toFixed(1)} L ${x(0).toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;
  const area = svgEl('path', { d: areaD, fill: color, opacity: 0.08, stroke: 'none' });
  svg.insertBefore(area, svg.firstChild.nextSibling);

  const dots = points.map((p, i) => {
    const dot = svgEl('circle', { cx: x(i), cy: y(p.value), r: 3, fill: color, stroke: 'var(--surface-1)', 'stroke-width': 1.5 });
    svg.appendChild(dot);
    return dot;
  });

  // crosshair (hidden until hover)
  const crosshair = svgEl('line', { x1: 0, x2: 0, y1: padT, y2: padT + innerH, stroke: 'var(--baseline)', 'stroke-width': 1, opacity: 0 });
  svg.appendChild(crosshair);

  // x-axis end labels only (selective direct labels, not one per point)
  const firstLabel = svgEl('text', { x: padL, y: height - 6, 'font-size': 10, fill: 'var(--text-muted)' });
  firstLabel.textContent = points[0].label;
  const lastLabel = svgEl('text', { x: width - padR, y: height - 6, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--text-muted)' });
  lastLabel.textContent = points[points.length - 1].label;
  svg.append(firstLabel, lastLabel);

  // hit layer
  const hit = svgEl('rect', { x: padL, y: 0, width: innerW, height, fill: 'transparent' });
  svg.appendChild(hit);

  function handleMove(clientX, clientY, rectLeft) {
    const relX = clientX - rectLeft;
    const ratio = Math.max(0, Math.min(1, (relX - padL) / innerW));
    const idx = Math.round(ratio * (points.length - 1));
    const p = points[idx];
    if (!p) return;
    crosshair.setAttribute('x1', x(idx));
    crosshair.setAttribute('x2', x(idx));
    crosshair.setAttribute('opacity', 1);
    dots.forEach((d, i) => d.setAttribute('r', i === idx ? 4.5 : 3));
    showTooltip(clientX, clientY, `<strong>${p.label}</strong><br>${valueFormat(p.value)}${unit}`);
  }

  svg.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    handleMove(e.clientX, e.clientY, rect.left);
  });
  svg.addEventListener('mouseleave', () => {
    crosshair.setAttribute('opacity', 0);
    dots.forEach((d) => d.setAttribute('r', 3));
    hideTooltip();
  });

  wrap.appendChild(svg);
  return wrap;
}

/** A small strip of colored squares, one per historical observation (oldest→newest). */
export function heatStrip(observations, statusColor) {
  const wrap = document.createElement('div');
  wrap.className = 'hstrip';
  for (const obs of observations) {
    const sq = document.createElement('div');
    sq.className = 'sq';
    sq.style.background = statusColor(obs.status);
    sq.title = `${obs.runId}: ${obs.status}`;
    wrap.appendChild(sq);
  }
  return wrap;
}
