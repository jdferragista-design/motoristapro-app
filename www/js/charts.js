// MotoristaPro — visualização (donut, área-chart, sparklines, pills de tendência)


// ---------- Helpers de visualização (donut / área / sparkline) ----------
const DONUT_COLORS = ['#38bdf8', '#8b5cf6', '#6366f1', '#a855f7', '#22d3ee', '#f472b6', '#f59e0b', '#34d399'];


function smoothPath(pts) {
  if (!pts.length) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const mx = ((pts[i - 1].x + pts[i].x) / 2).toFixed(1);
    d += ` C ${mx} ${pts[i - 1].y.toFixed(1)}, ${mx} ${pts[i].y.toFixed(1)}, ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
  }
  return d;
}


function sparkSVG(values, color, gradId) {
  const W = 140, H = 36, P = 2;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const xs = i => P + i * ((W - 2 * P) / (values.length - 1 || 1));
  const ys = v => H - 4 - ((v - min) / ((max - min) || 1)) * (H - 10);
  const line = smoothPath(values.map((v, i) => ({ x: xs(i), y: ys(v) })));
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${line} L ${W - P} ${H} L ${P} ${H} Z" fill="url(#${gradId})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
  </svg>`;
}


function areaChartSVG(perDay) {
  const W = 640, H = 170, P = 12;
  const maxV = Math.max(...perDay.map(d => Math.max(d.gross, d.net)), 1);
  const xs = i => P + i * ((W - 2 * P) / (perDay.length - 1 || 1));
  const ys = v => H - 12 - (v / maxV) * (H - 34);
  const mk = key => perDay.map((d, i) => ({ x: xs(i), y: ys(d[key]) }));
  const gPts = mk('gross'), nPts = mk('net');
  const gLine = smoothPath(gPts), nLine = smoothPath(nPts);
  const base = H - 12;
  const dots = perDay.map((d, i) => `
    <circle cx="${gPts[i].x.toFixed(1)}" cy="${gPts[i].y.toFixed(1)}" r="3.5" fill="#8b5cf6" stroke="#0a0a14" stroke-width="1.5"><title>${d.label} — Bruto: ${brlC(d.gross)} • Líquido: ${brlC(d.net)}</title></circle>
    <circle cx="${nPts[i].x.toFixed(1)}" cy="${nPts[i].y.toFixed(1)}" r="3" fill="#22d3ee" stroke="#0a0a14" stroke-width="1.5"><title>${d.label} — Líquido: ${brlC(d.net)}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:170px;display:block;">
    <defs>
      <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8b5cf6" stop-opacity="0.35"/>
        <stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="areaN" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#22d3ee" stop-opacity="0.25"/>
        <stop offset="1" stop-color="#22d3ee" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${gLine} L ${W - P} ${base} L ${P} ${base} Z" fill="url(#areaG)"/>
    <path d="${nLine} L ${W - P} ${base} L ${P} ${base} Z" fill="url(#areaN)"/>
    <path d="${gLine}" fill="none" stroke="#8b5cf6" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    <path d="${nLine}" fill="none" stroke="#22d3ee" stroke-width="2" vector-effect="non-scaling-stroke"/>
    ${dots}
  </svg>`;
}


function donutSVG(items, total, centerTop, centerBottom) {
  const R = 62, C = 2 * Math.PI * R;
  let cum = 0;
  let circles = '';
  items.forEach((it, i) => {
    const len = total > 0 ? (it.total / total) * C : 0;
    const seg = Math.max(len - 2.5, 0.6);
    circles += `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${DONUT_COLORS[i % DONUT_COLORS.length]}" stroke-width="22" stroke-dasharray="${seg} ${C - seg}" stroke-dashoffset="${(-cum).toFixed(2)}"/>`;
    cum += len;
  });
  return `<svg viewBox="0 0 160 160" style="width:172px;height:172px;transform:rotate(-90deg);flex-shrink:0;">
    <circle r="${R}" cx="80" cy="80" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="22"/>
    ${circles}
    <g transform="rotate(90 80 80)">
      <text x="80" y="77" text-anchor="middle" fill="#ffffff" font-size="14" font-weight="900">${centerTop}</text>
      <text x="80" y="94" text-anchor="middle" fill="#a0a0bd" font-size="8.5">${centerBottom}</text>
    </g>
  </svg>`;
}


function trendPillHTML(cur, prev) {
  if (!prev) return '<span class="trend-pill trend-flat">—</span>';
  const pct = ((cur - prev) / prev) * 100;
  const cls = pct >= 0 ? 'trend-up' : 'trend-down';
  return `<span class="trend-pill ${cls}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%</span>`;
}
