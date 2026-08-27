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


function donutSVG(items, total, centerTop, centerBottom) {
  const R = 62, C = 2 * Math.PI * R;
  let cum = 0;
  let circles = '';
  items.forEach((it, i) => {
    const len = total > 0 ? (it.total / total) * C : 0;
    const seg = Math.max(len - 2.5, 0.6);
    circles += `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${it.color || DONUT_COLORS[i % DONUT_COLORS.length]}" stroke-width="22" stroke-dasharray="${seg} ${C - seg}" stroke-dashoffset="${(-cum).toFixed(2)}"/>`;
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
  const deltaC = cur - prev;
  const rawPct = (deltaC / Math.abs(prev)) * 100;
  // Clamp legível: variações absurdas (>±300%) mostram Δ absoluto em R$,
  // evitando pills como "▼ 901%" quando um custo fixo pontual distorce a semana.
  if (Math.abs(rawPct) > 300) {
    const cls = deltaC >= 0 ? 'trend-up' : 'trend-down';
    return `<span class="trend-pill ${cls}" title="Variação de ${brlC(Math.abs(deltaC))} vs semana anterior">${deltaC >= 0 ? '▲' : '▼'} ${brlC(Math.abs(deltaC))}</span>`;
  }
  const cls = rawPct >= 0 ? 'trend-up' : 'trend-down';
  return `<span class="trend-pill ${cls}">${rawPct >= 0 ? '▲' : '▼'} ${Math.abs(rawPct).toFixed(0)}%</span>`;
}


// ---------- Linha de evolução (Bruto × Custos × Líquido) — pontos dia ou mês ----------
function fmtShortBRL(cents) {
  return 'R$ ' + Math.round(cents / 100).toLocaleString('pt-BR');
}


// ----- R$/hora por semana com linha da meta -----
function weeklyBarsSVG(items, targetRate) {
  const W = 620, H = 210, P = 30, BASE = H - 26;
  const top = BASE - 46;
  const maxV = Math.max(...items.map(i => i.rsH), targetRate * 1.05);
  const bw = (W - P - 20) / Math.max(items.length, 1);
  const y = v => top - (v / maxV) * top;
  const tgtY = y(targetRate);
  let bars = '', labs = '';
  items.forEach((it, i) => {
    const x = P + i * bw;
    const yTop = y(it.rsH);
    const bh = Math.max(BASE - yTop, 1);
    const color = it.rsH >= targetRate ? 'rgba(52,211,153,0.85)' : 'rgba(251,146,60,0.85)';
    bars += `<rect x="${x.toFixed(0)}" y="${yTop.toFixed(0)}" width="${(bw - 6).toFixed(0)}" height="${bh.toFixed(0)}" rx="5" fill="${color}"/>` +
            `<text x="${(x + (bw - 6) / 2).toFixed(0)}" y="${(yTop - 6).toFixed(0)}" text-anchor="middle" font-size="10" font-weight="800" fill="#e6e6f0">${it.rsH.toFixed(1)}</text>`;
    labs += `<text x="${(x + (bw - 6) / 2).toFixed(0)}" y="${(BASE + 8).toFixed(0)}" text-anchor="middle" font-size="10" fill="#a0a0bd">${it.label}</text>`;
  });
  const leg = `<div style="font-size:11px;color:var(--text-muted);margin-top:6px;display:flex;gap:10px;flex-wrap:wrap;">` +
    `<span><span style="display:inline-block;width:10px;height:10px;background:rgba(52,211,153,0.85);border-radius:2px;"></span> acima da meta</span>` +
    `<span><span style="display:inline-block;width:10px;height:10px;background:rgba(251,146,60,0.85);border-radius:2px;"></span> abaixo da meta</span></div>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">` +
    `<line x1="${P}" y1="${tgtY.toFixed(1)}" x2="${(W - 14).toFixed(1)}" y2="${tgtY.toFixed(1)}" stroke="#f59e0b" stroke-dasharray="5 4" stroke-width="1.4"/>` +
    `<text x="${(W - 16).toFixed(1)}" y="${(tgtY - 5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#fbbf24">Meta: R$ ${targetRate}/h</text>` +
    `${bars}${labs}</svg>${leg}`;
}

// ----- Acumulado do mês vs meta diária prorrateada + projeção -----
function cumulativeGoalSVG(shifts, goalC, dayElapsed, daysInMonth, projC) {
  const ym = getTodayString().slice(0, 7);
  const dayMap = {};
  shifts.forEach(s => { if ((s.date || '').startsWith(ym)) dayMap[s.date] = (dayMap[s.date] || 0) + getShiftTotalGrossC(s); });
  const days = Object.keys(dayMap).sort();
  const W = 520, H = 200, P = 34, BASE = H - 30;
  const xs = i => P + i * ((W - P - 16) / (daysInMonth - 1 || 1));
  const ys = v => BASE - (Math.min(v, goalC) / Math.max(goalC, 1)) * (BASE - 52);
  const metaYs = ys(goalC);
  let running = 0, line = '', area = '', dots = '';
  days.forEach((dt, i) => {
    running += dayMap[dt];
    const x = xs(i), y = ys(running);
    if (i === 0) { line += `M ${x.toFixed(1)} ${y.toFixed(1)}`; area += `M ${x.toFixed(1)} ${y.toFixed(1)}`; }
    else { line += ` L ${x.toFixed(1)} ${y.toFixed(1)}`; area += ` L ${x.toFixed(1)} ${y.toFixed(1)}`; }
    dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="#8b5cf6"/>`;
  });
  const firstX = days.length ? xs(0) : P;
  if (area) area += ` L ${xs(daysInMonth - 1).toFixed(1)} ${BASE.toFixed(1)} L ${firstX.toFixed(1)} ${BASE.toFixed(1)} Z`;
  const meta = `<line x1="${xs(0).toFixed(1)}" y1="${metaYs.toFixed(1)}" x2="${xs(daysInMonth - 1).toFixed(1)}" y2="${metaYs.toFixed(1)}" stroke="#f59e0b" stroke-dasharray="5 4" stroke-width="1.4"/>` +
    `<text x="${(P + (W - P - 10)) - 4}" y="${(metaYs - 5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#fbbf24">Meta ${fmtShortBRL(goalC)}</text>`;
  const projY = ys(projC);
  const proj = running > 0
    ? `<line x1="${xs(dayElapsed - 1).toFixed(1)}" y1="${ys(running).toFixed(1)}" x2="${xs(daysInMonth - 1).toFixed(1)}" y2="${projY.toFixed(1)}" stroke="#22d3ee" stroke-dasharray="3 3" stroke-width="1.4"/>` +
      `<text x="${(xs(daysInMonth - 1) - 6).toFixed(1)}" y="${(projY - 6).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#67e8f9">Proj. ${fmtShortBRL(projC)}</text>`
    : '';
  let dl = '';
  [1, 8, 15, 22, daysInMonth].forEach(d => { dl += `<text x="${xs(d - 1).toFixed(1)}" y="${(BASE + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="#a0a0bd">${d}</text>`; });
  const onTrack = projC >= goalC;
  const note = `<div style="font-size:12px;color:${onTrack ? '#34d399' : '#fb7185'};font-weight:800;margin-top:6px;">Projeção ${onTrack ? 'no ritmo' : 'abaixo'} da meta (${Math.round(projC / goalC * 100)}%)</div>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">${meta}${proj}${area ? `<path d="${area}" fill="rgba(139,92,246,0.15)"/>` : ''}${line ? `<path d="${line}" fill="none" stroke="#8b5cf6" stroke-width="2"/>` : ''}${dots}${dl}</svg>${note}`;
}

function seriesLineSVG(points) {
  const W = 640, H = 200, P = 14, BASE = H - 16;
  const maxV = Math.max(...points.map(m => Math.max(m.grossC, m.netC, m.expC)), 1);
  const xs = i => P + i * ((W - 2 * P) / (points.length - 1 || 1));
  const ys = v => BASE - (v / maxV) * (H - 46);
  const pt = key => points.map((m, i) => ({ x: xs(i), y: ys(m[key]) }));
  const gPts = pt('grossC'), ePts = pt('expC'), nPts = pt('netC');
  const gLine = smoothPath(gPts), eLine = smoothPath(ePts), nLine = smoothPath(nPts);
  const grid = [1, 0.66, 0.33].map(f =>
    `<line x1="${P}" y1="${ys(maxV * f).toFixed(1)}" x2="${W - P}" y2="${ys(maxV * f).toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`).join('');
  const dots = points.map((m, i) => `
    <circle cx="${gPts[i].x.toFixed(1)}" cy="${gPts[i].y.toFixed(1)}" r="3.5" fill="#8b5cf6" stroke="#0a0a14" stroke-width="1.5"><title>${m.tip || m.label} — Bruto: ${brlC(m.grossC)}</title></circle>
    <circle cx="${ePts[i].x.toFixed(1)}" cy="${ePts[i].y.toFixed(1)}" r="3" fill="#fb7185" stroke="#0a0a14" stroke-width="1.5"><title>${m.tip || m.label} — Custos: ${brlC(m.expC)} (combustível + provisão + despesas)</title></circle>
    <circle cx="${nPts[i].x.toFixed(1)}" cy="${nPts[i].y.toFixed(1)}" r="3.5" fill="#22d3ee" stroke="#0a0a14" stroke-width="1.5"><title>${m.tip || m.label} — Líquido: ${brlC(m.netC)}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:200px;display:block;">
    <defs>
      <linearGradient id="monG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8b5cf6" stop-opacity="0.30"/>
        <stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${grid}
    <path d="${gLine} L ${W - P} ${BASE} L ${P} ${BASE} Z" fill="url(#monG)"/>
    <path d="${eLine}" fill="none" stroke="#fb7185" stroke-width="1.8" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>
    <path d="${gLine}" fill="none" stroke="#8b5cf6" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    <path d="${nLine}" fill="none" stroke="#22d3ee" stroke-width="2" vector-effect="non-scaling-stroke"/>
    ${dots}
  </svg>`;
}


// ---------- Média por dia da semana (barras verticais) ----------
function weekdayBarsSVG(items) {
  const W = 640, H = 180, P = 14, BASE = H - 18;
  const maxV = Math.max(...items.map(d => d.avgC), 1);
  const slot = (W - 2 * P) / items.length;
  const bw = Math.min(slot * 0.52, 64);
  let bestIdx = -1, bestVal = 0;
  items.forEach((d, i) => { if (d.avgC > bestVal) { bestVal = d.avgC; bestIdx = i; } });
  const bars = items.map((d, i) => {
    const cx = P + slot * i + slot / 2;
    const h = d.avgC > 0 ? Math.max((d.avgC / maxV) * (H - 50), 4) : 2;
    const y = BASE - h;
    const isBest = i === bestIdx && d.avgC > 0;
    const fill = isBest ? '#8b5cf6' : (d.avgC > 0 ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.07)');
    const valFill = isBest ? '#c4b5fd' : (d.avgC > 0 ? '#a0a0bd' : 'rgba(160,160,189,0.45)');
    const tip = `${d.label} — média ${brlC(d.avgC)} em ${d.count} dia(s) com turno`;
    return `
    <rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="5" fill="${fill}"><title>${tip}</title></rect>
    <text x="${cx.toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="800" fill="${valFill}">${d.avgC > 0 ? fmtShortBRL(d.avgC) : '—'}<title>${tip}</title></text>
    <text x="${cx.toFixed(1)}" y="${(BASE + 13).toFixed(1)}" text-anchor="middle" font-size="10"${isBest ? ' font-weight="800" fill="#e9d5ff"' : ' fill="#a0a0bd"'}>${d.label}<title>${tip}</title></text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:180px;display:block;">
    <line x1="${P}" y1="${BASE}" x2="${W - P}" y2="${BASE}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
    ${bars}
  </svg>`;
}
