// MotoristaPro — renderização, relatórios, exportações e backup


function renderStagedApps() {
  const container = document.getElementById('stagedAppsList');
  container.innerHTML = '';

  if (stagedShiftApps.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-dim); font-size: 11px; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px;">
        Nenhum app salvo ainda. Escolha o app acima, preencha os ganhos e clique em "Salvar Este App".
      </div>
    `;
    document.getElementById('stagedAppsCount').innerText = '0 apps salvos';
    document.getElementById('stagedGrossTotal').innerText = 'R$ 0,00';
    return;
  }

  let sumGrossC = 0;
  stagedShiftApps.forEach((item, idx) => {
    const itemSumC = toC(item.gross) + toC(item.tips);
    sumGrossC += itemSumC;

    const row = document.createElement('div');
    row.className = 'added-app-row';
    row.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="badge ${item.badgeClass}">${esc(item.name)}</span>
        <span style="font-size: 11px; color: var(--text-muted);">${item.trips} viagens ${item.tips > 0 ? `(+${formatBRL(item.tips)} gorjeta)` : ''}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <strong style="color: #fff; font-size: 13px;">${brlC(itemSumC)}</strong>
        <button type="button" onclick="removeStagedApp(${idx})" style="background: none; border: none; color: var(--danger); cursor: pointer; padding: 2px;" title="Remover">✕</button>
      </div>
    `;
    container.appendChild(row);
  });

  document.getElementById('stagedAppsCount').innerText = `${stagedShiftApps.length} apps salvos`;
  document.getElementById('stagedGrossTotal').innerText = brlC(sumGrossC);
}


function render() {
  document.getElementById('topCarInfo').innerText = `${state.vehicle.model} • ${state.vehicle.plate} (100% Local + Google Drive)`;

  // Aggregates — escopadas pelo período selecionado no painel
  const pShifts = state.shifts.filter(s => inPeriod(s.date));
  const pExpenses = state.expenses.filter(e => inPeriod(e.date));
  const periodLabels = { day: 'hoje', '7': 'últimos 7 dias', '30': 'últimos 30 dias', month: 'este mês', all: 'todo o histórico' };
  const periodLabelEl = document.getElementById('dashPeriodLabel');
  if (periodLabelEl) periodLabelEl.innerText = `Faturamento Bruto vs Lucro Líquido Real • Período: ${periodLabels[dashPeriod]}`;

  let totalGrossC = 0;
  let totalTrips = 0;
  const appTotals = {};

  pShifts.forEach(s => {
    totalGrossC += getShiftTotalGrossC(s);
    totalTrips += getShiftTotalTrips(s);

    if (Array.isArray(s.apps)) {
      s.apps.forEach(a => {
        const k = a.name;
        if (!appTotals[k]) {
          appTotals[k] = { name: a.name, badgeClass: a.badgeClass || 'badge-uber', total: 0 };
        }
        appTotals[k].total += toC(a.gross) + toC(a.tips);
      });
    }
  });

  const totalKm = pShifts.reduce((a, s) => a + (s.km || 0), 0);
  const totalHours = pShifts.reduce((a, s) => a + (s.hours || 0), 0);

  const totalExpensesC = pExpenses.reduce((a, e) => a + toC(e.amount), 0);
  const reserveAccruedC = Math.round(totalKm * (state.vehicle.maintenanceReservePerKm || 0.18) * 100);
  const netProfitC = totalGrossC - totalExpensesC - reserveAccruedC;
  const netMargin = totalGrossC > 0 ? (netProfitC / totalGrossC) * 100 : 0;

  const rateKm = totalKm > 0 ? (totalGrossC / 100) / totalKm : 0;
  const rateHour = totalHours > 0 ? (totalGrossC / 100) / totalHours : 0;
  const cpk = totalKm > 0 ? ((totalExpensesC + reserveAccruedC) / 100) / totalKm : 0;

  // Fundo de reserva da Saúde: sempre TODO o histórico (não o período do painel)
  const allKm = state.shifts.reduce((a, s) => a + (s.km || 0), 0);
  const reserveAllC = Math.round(allKm * (state.vehicle.maintenanceReservePerKm || 0.18) * 100);

  // Dashboard Fill
  document.getElementById('dashGross').innerText = brlC(totalGrossC);
  document.getElementById('dashGrossSub').innerText = `${totalTrips} corridas • ${totalKm.toFixed(1)} km`;
  document.getElementById('dashExpenses').innerText = brlC(totalExpensesC + reserveAccruedC);
  document.getElementById('dashNet').innerText = brlC(netProfitC);
  document.getElementById('dashMargin').innerText = `${netMargin.toFixed(0)}% Margem`;
  setSignedValueClass('dashNet', netProfitC);
  setSignedBadgeState('dashMargin', netMargin);

  document.getElementById('dashRateKm').innerText = formatBRL(rateKm) + '/km';
  document.getElementById('dashRateKmSub').innerText = `Meta: ${formatBRL(state.vehicle.targetKmRate)}/km ${rateKm >= state.vehicle.targetKmRate ? '✅' : '⚠️'}`;

  document.getElementById('dashRateHour').innerText = formatBRL(rateHour) + '/h';
  document.getElementById('dashRateHourSub').innerText = `Meta: ${formatBRL(state.vehicle.targetHourlyRate)}/h ${rateHour >= state.vehicle.targetHourlyRate ? '✅' : '⚠️'}`;

  document.getElementById('dashCpk').innerText = formatBRL(cpk) + '/km';
  document.getElementById('dashAvgTrip').innerText = brlC(totalTrips > 0 ? Math.round(totalGrossC / totalTrips) : 0);
  document.getElementById('dashAvgTripSub').innerText = `${totalTrips > 0 ? (totalKm / totalTrips).toFixed(1) : '0.0'} km por viagem`;

  // Km fora de serviço não fica visível no painel; só relatórios/exportações.
  const outsidePill = document.getElementById('outsideKmPill');
  if (outsidePill) outsidePill.style.display = 'none';

  // ---------- Resumo do Dia ----------
  const rr = state.vehicle.maintenanceReservePerKm || 0.18;
  const todayKey = getTodayString();
  const tShifts = state.shifts.filter(s => s.date === todayKey);
  const tGrossC = tShifts.reduce((a, s) => a + getShiftTotalGrossC(s), 0);
  const tTrips = tShifts.reduce((a, s) => a + getShiftTotalTrips(s), 0);
  const tKm = tShifts.reduce((a, s) => a + (s.km || 0), 0);
  const tHours = tShifts.reduce((a, s) => a + (s.hours || 0), 0);
  const tFuelC = tShifts.reduce((a, s) => a + toC(s.fuelCost), 0);
  const tOtherExpDayC = state.expenses
    .filter(e => e.date === todayKey && e.category !== 'combustivel')
    .reduce((a, e) => a + toC(e.amount), 0);
  const tNetC = tGrossC - tFuelC - Math.round(tKm * rr * 100) - tOtherExpDayC;

  document.getElementById('todayDateLabel').innerText =
    new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });

  const todayGrid = document.getElementById('todayGrid');
  const todayAppsRow = document.getElementById('todayAppsRow');
  if (tShifts.length === 0) {
    todayGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 14px; background: rgba(0,0,0,0.25); border-radius: 10px;">Nenhum turno lançado hoje ainda. Toque em “Lançar Turno” para começar. 🚀</div>';
    todayAppsRow.innerHTML = '';
  } else {
    const todayNetNegative = tNetC < 0;
    todayGrid.innerHTML = `
      <div class="metric-box">
        <div class="metric-label">Bruto Hoje</div>
        <div class="metric-val val-violet">${brlC(tGrossC)}</div>
        <div class="metric-sub">${tTrips} corridas</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">KM Hoje</div>
        <div class="metric-val">${tKm.toFixed(1)}</div>
        <div class="metric-sub">somente turnos</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Horas Hoje</div>
        <div class="metric-val val-sky">${tHours.toFixed(1)}h</div>
        <div class="metric-sub">${tHours > 0 ? brlC(Math.round(tGrossC / tHours)) + '/h' : '—'}</div>
      </div>
      <div class="metric-box" style="border-color: ${todayNetNegative ? 'rgba(244, 63, 94, 0.4)' : 'rgba(52, 211, 153, 0.4)'};">
        <div class="metric-label" style="color: ${todayNetNegative ? '#fda4af' : '#a7f3d0'};">Líquido Hoje</div>
        <div class="metric-val ${todayNetNegative ? 'val-rose' : 'val-emerald'}">${brlC(tNetC)}</div>
        <div class="metric-sub">combustível: -${brlC(tFuelC)}${tOtherExpDayC > 0 ? ` • outras despesas: -${brlC(tOtherExpDayC)}` : ''}</div>
      </div>`;

    const tApps = {};
    tShifts.forEach(s => (Array.isArray(s.apps) ? s.apps : []).forEach(a => {
      if (!tApps[a.name]) tApps[a.name] = { name: a.name, badgeClass: a.badgeClass || 'badge-uber', total: 0, trips: 0 };
      tApps[a.name].total += toC(a.gross) + toC(a.tips);
      tApps[a.name].trips += (a.trips || 0);
    }));
    todayAppsRow.innerHTML = Object.values(tApps).map(a =>
      `<span class="badge ${a.badgeClass}">${esc(a.name)}: ${brlC(a.total)} (${a.trips} v.)</span>`
    ).join(' ');
  }

  // Platform Breakdown — donut + legenda (visual novo)
  const pbGrid = document.getElementById('platformBreakdownGrid');
  const appKeys = Object.keys(appTotals);
  if (appKeys.length === 0) {
    pbGrid.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 10px;">Nenhum ganho registrado por app.</div>';
  } else {
    const items = appKeys.map(k => appTotals[k]).sort((a, b) => b.total - a.total);
    const legend = items.map((item, i) => {
      const pct = totalGrossC > 0 ? ((item.total / totalGrossC) * 100).toFixed(0) : 0;
      return `<div class="legend-row">
        <span class="legend-dot" style="background: ${DONUT_COLORS[i % DONUT_COLORS.length]};"></span>
        <span class="legend-name">${esc(item.name)}</span>
        <strong style="color: #fff;">${brlC(item.total)}</strong>
        <span style="color: var(--text-dim); font-size: 11px; min-width: 34px; text-align: right;">${pct}%</span>
      </div>`;
    }).join('');
    pbGrid.innerHTML = `<div class="donut-flex">
      ${donutSVG(items, totalGrossC, brlC(totalGrossC), 'Faturamento total')}
      <div class="donut-legend">${legend}</div>
    </div>`;
  }

  // Goal — meta MENSAL: compara apenas com o bruto do mês corrente (independe do período do painel)
  const goalC = toC(state.vehicle.monthlyGoal || 7000);
  const ym = getTodayString().slice(0, 7);
  const monthGrossC = state.shifts
    .filter(s => (s.date || '').startsWith(ym))
    .reduce((a, s) => a + getShiftTotalGrossC(s), 0);
  const goalPct = goalC > 0 ? Math.min(100, Math.round((monthGrossC / goalC) * 100)) : 0;
  document.getElementById('goalLabel').innerText = `${brlC(monthGrossC)} de ${brlC(goalC)}`;
  document.getElementById('goalPercent').innerText = `${goalPct}%`;
  document.getElementById('goalFill').style.width = `${goalPct}%`;
  document.getElementById('goalRemaining').innerText = brlC(Math.max(0, goalC - monthGrossC));

  // Últimos 7 dias (dados reais) — área chart + sparklines + tendência semanal
  const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const reserveRate = state.vehicle.maintenanceReservePerKm || 0.18;
  const dayKeyOf = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dayStats = (offset) => {
    const key = dayKeyOf(offset);
    const ds = state.shifts.filter(s => s.date === key);
    const grossC = ds.reduce((a, s) => a + getShiftTotalGrossC(s), 0);
    const fuelC = ds.reduce((a, s) => a + toC(s.fuelCost), 0);
    const km = ds.reduce((a, s) => a + (s.km || 0), 0);
    const expC = state.expenses.filter(e => e.date === key).reduce((a, e) => a + toC(e.amount), 0);
    return { grossC, netC: grossC - fuelC - Math.round(km * reserveRate * 100), expC };
  };
  const perDay = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const st = dayStats(i);
    perDay.push({ label: i === 0 ? 'Hoje' : dayNames[d.getDay()], gross: st.grossC, net: st.netC, exp: st.expC });
  }
  let curGrossC = 0, curNetC = 0, prevGrossC = 0, prevNetC = 0;
  for (let i = 0; i <= 6; i++) { const st = dayStats(i); curGrossC += st.grossC; curNetC += st.netC; }
  for (let i = 7; i <= 13; i++) { const st = dayStats(i); prevGrossC += st.grossC; prevNetC += st.netC; }

  document.getElementById('trendGross').innerHTML = trendPillHTML(curGrossC, prevGrossC);
  document.getElementById('trendNet').innerHTML = trendPillHTML(curNetC, prevNetC);
  document.getElementById('sparkGross').innerHTML = sparkSVG(perDay.map(x => x.gross), '#8b5cf6', 'sgGross');
  document.getElementById('sparkExp').innerHTML = sparkSVG(perDay.map(x => x.exp), '#f43f5e', 'sgExp');
  document.getElementById('sparkNet').innerHTML = sparkSVG(perDay.map(x => x.net), '#22d3ee', 'sgNet');

  document.getElementById('dashChart').innerHTML = areaChartSVG(perDay);
  document.getElementById('dashChartLabels').innerHTML = perDay.map(d => `<span>${d.label}</span>`).join('');

  // Shifts list
  renderShiftsList();

  // Expenses list
  renderExpensesList();

  // Health
  document.getElementById('healthOdo').innerText = `${Math.round(state.vehicle.odometer).toLocaleString('pt-BR')} km`;
  document.getElementById('healthReserve').innerText = brlC(reserveAllC);
  const maintSpentC = state.expenses.filter(e => e.category === 'manutencao').reduce((a, b) => a + toC(b.amount), 0);
  document.getElementById('healthSpent').innerText = brlC(maintSpentC);
  renderMaintenance();

  // Parity inputs fill
  document.getElementById('fuelGasPrice').value = (state.fuelSettings.gasolinePrice || 5.89).toFixed(2).replace('.', ',');
  document.getElementById('fuelGasKml').value = (state.fuelSettings.gasolineKmPerL || 11.5).toFixed(2).replace('.', ',');
  document.getElementById('fuelEthPrice').value = (state.fuelSettings.ethanolPrice || 3.89).toFixed(2).replace('.', ',');
  document.getElementById('fuelEthKml').value = (state.fuelSettings.ethanolKmPerL || 8.2).toFixed(2).replace('.', ',');
  calcFuel();

  // WhatsApp text
  renderWhatsApp();
}


function renderShiftsList() {
  const container = document.getElementById('shiftsListContainer');
  container.innerHTML = '';

  const query = (document.getElementById('shiftSearchInput')?.value || '').toLowerCase().trim();

  let list = state.shifts;
  if (query) {
    list = list.filter(s => 
      (s.notes && s.notes.toLowerCase().includes(query)) ||
      (s.date && s.date.includes(query))
    );
  }

  if(list.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px;">Nenhum turno registrado.</div>';
    return;
  }

  list.forEach(s => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const sGrossC = getShiftTotalGrossC(s);
    const sTrips = getShiftTotalTrips(s);
    const rKm = s.km > 0 ? (sGrossC / 100) / s.km : 0;
    const rH = s.hours > 0 ? (sGrossC / 100) / s.hours : 0;
    const reserveC = Math.round(s.km * (state.vehicle.maintenanceReservePerKm || 0.18) * 100);
    const netC = sGrossC - toC(s.fuelCost) - reserveC;

    let appBadgesHtml = '';
    if (Array.isArray(s.apps)) {
      s.apps.forEach(a => {
        const sumC = toC(a.gross) + toC(a.tips);
        if (sumC > 0 || a.trips > 0) {
          appBadgesHtml += `<span class="badge ${a.badgeClass || 'badge-uber'}">${esc(a.name)}: ${brlC(sumC)} (${a.trips || 0} viagens)</span> `;
        }
      });
    }

    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="badge" style="background: rgba(16,185,129,0.2); color:#34d399; font-weight:800;">Turno ${esc(s.period || 'Integral')}</span>
          <span style="font-size: 12px; color: var(--text-muted);">${formatDate(s.date)} ${s.timeStart ? `• ${esc(s.timeStart)} às ${esc(s.timeEnd)}` : ''}</span>
          ${s.fuelTypeUsed ? `<span class="badge" style="background: rgba(245,158,11,0.15); color: #fbbf24; font-size: 10px;">⛽ ${esc(s.fuelTypeUsed)}</span>` : ''}
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <strong style="font-size: 16px; color: #fff;">${brlC(sGrossC)}</strong>
          <button onclick="openEditShiftModal(${s.id})" class="action-btn action-btn-edit" title="Editar Turno">
            ✏️ Editar
          </button>
          <button onclick="deleteShift(${s.id})" class="action-btn action-btn-danger" title="Excluir Turno">
            🗑️
          </button>
        </div>
      </div>

      <!-- Apps list in shift -->
      <div style="display: flex; flex-wrap: wrap; gap: 6px; background: #0b0b16; padding: 8px; border-radius: 10px; border: 1px solid var(--border-sub);">
        ${appBadgesHtml || '<span style="font-size:11px; color:var(--text-dim);">Nenhum app específico listado</span>'}
      </div>

      <!-- Unified Shift KPIs -->
      <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
        <span>${parseVal(s.km).toFixed(1)} km rodados • <strong>${parseVal(s.hours).toFixed(1)} horas de trabalho</strong> (${sTrips} corridas)</span>
        <span class="${netC < 0 ? 'val-rose' : 'val-emerald'}" style="font-weight: 700;">${formatBRL(rKm)}/km • ${formatBRL(rH)}/h • Líquido: ${brlC(netC)}</span>
      </div>
      ${s.notes ? `<div style="font-size: 11px; color: var(--text-dim); font-style: italic;">"${esc(s.notes)}"</div>` : ''}
    `;
    container.appendChild(item);
  });
}


function renderExpensesList() {
  const container = document.getElementById('expensesListContainer');
  container.innerHTML = '';

  const query = (document.getElementById('expenseSearchInput')?.value || '').toLowerCase().trim();

  let list = state.expenses;
  if (query) {
    list = list.filter(e => 
      (e.title && e.title.toLowerCase().includes(query)) ||
      (e.category && e.category.toLowerCase().includes(query)) ||
      (e.date && e.date.includes(query))
    );
  }

  if (list.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px;">Nenhuma despesa encontrada.</div>';
  }

  list.forEach((e, idx) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const isFuel = e.category === 'combustivel';
    // "Último abastecimento" = o de data mais recente (independe da posição no array)
    const latestFuel = state.expenses
      .filter(x => x.category === 'combustivel')
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
    const isLatestFuel = isFuel && latestFuel && e.id === latestFuel.id;

    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 13px; font-weight: 700; color: #fff;">${esc(e.title)}</span>
            ${isLatestFuel ? '<span class="badge" style="background: rgba(16,185,129,0.2); color:#34d399; font-size:10px;">⭐ Último Abastecimento</span>' : ''}
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
            ${formatDate(e.date)} • ${esc(e.category)} 
            ${e.fuelType ? `[<strong>${esc(e.fuelType)}</strong>]` : ''} 
            ${e.liters ? `• ${e.liters} Litros` : ''} 
            ${e.pricePerLiter ? `(${formatBRL(e.pricePerLiter)}/L)` : ''} 
            ${e.odo ? `• ${e.odo.toLocaleString('pt-BR')} km` : ''}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <strong class="val-rose" style="font-size: 14px;">-${formatBRL(e.amount)}</strong>
          <button onclick="openEditExpenseModal(${e.id})" class="action-btn action-btn-edit" title="Editar Despesa">
            ✏️ Editar
          </button>
          <button onclick="deleteExpense(${e.id})" class="action-btn action-btn-danger" title="Excluir Despesa">
            🗑️
          </button>
        </div>
      </div>
    `;
    container.appendChild(item);
  });

  const totalExpC = state.expenses.reduce((a, b) => a + toC(b.amount), 0);
  const fuelExpC = state.expenses.filter(e => e.category === 'combustivel').reduce((a, b) => a + toC(b.amount), 0);
  const liters = state.expenses.filter(e => e.category === 'combustivel').reduce((a, b) => a + (b.liters || 0), 0);

  document.getElementById('expTotal').innerText = brlC(totalExpC);
  document.getElementById('expFuel').innerText = brlC(fuelExpC);
  document.getElementById('expLiters').innerText = `${liters.toFixed(1)} L`;
  document.getElementById('expAvgPrice').innerText = liters > 0 ? `${brlC(Math.round(fuelExpC / liters))}/L` : 'R$ 0,00/L';

  // Média REAL do carro: Δodômetro ÷ litros entre os 2 últimos abastecimentos com odômetro
  const kmlBox = document.getElementById('realKmlBox');
  if (kmlBox) {
    const fuelWithOdo = state.expenses
      .filter(e => e.category === 'combustivel' && e.odo > 0)
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    if (fuelWithOdo.length >= 2) {
      const a = fuelWithOdo[fuelWithOdo.length - 2];
      const b = fuelWithOdo[fuelWithOdo.length - 1];
      const dKm = (b.odo || 0) - (a.odo || 0);
      if (dKm > 0 && (b.liters || 0) > 0) {
        kmlBox.style.display = 'flex';
        kmlBox.innerHTML = `<span style="font-size: 12px; color: var(--text-muted);">🛞 Média real do carro (últimos abastecimentos com odômetro):</span><strong class="val-sky" style="font-size: 14px;">${(dKm / b.liters).toFixed(1)} km/L</strong>`;
        return;
      }
    }
    kmlBox.style.display = 'none';
  }
}


function renderMaintenance() {
  const container = document.getElementById('maintenanceItemsContainer');
  container.innerHTML = '';

  state.maintenance.forEach(m => {
    const kmSince = Math.max(0, state.vehicle.odometer - m.lastKm);
    const remaining = m.interval - kmSince;
    const pct = m.interval > 0 ? Math.min(100, Math.max(0, (kmSince / m.interval) * 100)) : 100;
    const isUrgent = remaining <= 1000;

    const el = document.createElement('div');
    el.className = 'metric-box';
    el.style.borderColor = isUrgent ? 'rgba(244, 63, 94, 0.4)' : 'var(--border)';
    el.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
        <div>
          <strong style="font-size: 13px; color: #fff;">${esc(m.name)}</strong>
          <div style="font-size: 11px; color: var(--text-muted);">A cada ${m.interval.toLocaleString('pt-BR')} km</div>
        </div>
        <div style="display: flex; align-items: center; gap: 4px;">
          <span class="badge" style="background: ${isUrgent ? 'rgba(244, 63, 94, 0.2)' : 'rgba(16, 185, 129, 0.2)'}; color: ${isUrgent ? '#fb7185' : '#34d399'};">
            ${remaining <= 0 ? 'VENCIDO' : `Restam ${remaining.toLocaleString('pt-BR')} km`}
          </span>
          <button onclick="executeMaintenance(${m.id})" class="btn btn-secondary btn-sm" style="font-size: 10px; padding: 3px 6px;">Trocar</button>
          <button onclick="openEditMaintenanceModal(${m.id})" class="action-btn action-btn-edit" style="padding: 2px 5px;" title="Editar">✏️</button>
          <button onclick="deleteMaintenanceItem(${m.id})" class="action-btn action-btn-danger" style="padding: 2px 5px;" title="Excluir">🗑️</button>
        </div>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${pct}%; background: ${isUrgent ? '#f43f5e' : '#10b981'};"></div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-top: 6px;">
        <span>Última: ${m.lastKm.toLocaleString('pt-BR')} km</span>
        <span>Custo Est.: <strong>${formatBRL(m.cost)}</strong></span>
      </div>
    `;
    container.appendChild(el);
  });
}


// ==============================================================
// GOOGLE DRIVE SYNC & BACKUP LOGIC
// ==============================================================
async function saveToGoogleDrive() {
  const fileName = `motoristapro_backup_${getTodayString()}.json`;
  const jsonStr = JSON.stringify(state, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const file = new File([blob], fileName, { type: 'application/json' });

  // If smartphone supports native Web Share (Android/iOS)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: 'Backup MotoristaPro',
        text: `Backup completo do MotoristaPro gerado em ${formatDate(getTodayString())}`,
        files: [file]
      });
      alert('✅ Selecione o "Google Drive" na tela para salvar na sua pasta!');
      return;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.log('Share error, falling back to download:', err);
      }
    }
  }

  // Fallback: Download file directly
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  alert(`📁 Arquivo de Backup "${fileName}" baixado com sucesso!\n\nPara guardar no Google Drive:\n1. Abra o app do Google Drive no seu celular ou computador;\n2. Toque em "+" e envie o arquivo baixado para sua pasta de backups.`);
}


function triggerRestoreFromGoogleDrive() {
  document.getElementById('gdriveFileInput').click();
}


function handleRestoreFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (imported && (imported.shifts || imported.vehicle)) {
        if (confirm(`Restaurar backup com ${imported.shifts?.length || 0} turnos e ${imported.expenses?.length || 0} despesas? Isso substituirá os dados atuais.`)) {
          state = migrateState(imported);
          saveState();
          alert('🎉 Backup restaurado com 100% de sucesso! Todos os seus turnos e médias foram carregados.');
        }
      } else {
        alert('❌ Arquivo de backup inválido.');
      }
    } catch (err) {
      alert('❌ Erro ao ler o arquivo JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}


function renderWhatsApp() {
  let totalGrossC = 0;
  let totalTrips = 0;
  const appTotals = {};

  state.shifts.forEach(s => {
    totalGrossC += getShiftTotalGrossC(s);
    totalTrips += getShiftTotalTrips(s);

    if (Array.isArray(s.apps)) {
      s.apps.forEach(a => {
        const k = a.name;
        if (!appTotals[k]) {
          appTotals[k] = { name: a.name, total: 0 };
        }
        appTotals[k].total += toC(a.gross) + toC(a.tips);
      });
    }
  });

  const totalKm = state.shifts.reduce((a, s) => a + (s.km || 0), 0);
  const totalHours = state.shifts.reduce((a, s) => a + (s.hours || 0), 0);
  const totalExpC = state.expenses.reduce((a, e) => a + toC(e.amount), 0);
  const reserveC = Math.round(totalKm * (state.vehicle.maintenanceReservePerKm || 0.18) * 100);
  const netC = totalGrossC - totalExpC - reserveC;
  const totalKmFora = getTotalKmFora();

  let appLines = '';
  Object.keys(appTotals).forEach(k => {
    const item = appTotals[k];
    appLines += `• ${item.name}: *${brlC(item.total)}*\n`;
  });

  const lastFuel = getLastFuelInfo();

  const text = `📊 *FECHAMENTO CONSOLIDADO - MOTORISTAPRO*
🚗 Veículo: ${state.vehicle.model} (${state.vehicle.plate})
⛽ Combustível Ativo: *${lastFuel.fuelType}* (${lastFuel.avgKml.toFixed(1)} km/L @ ${formatBRL(lastFuel.priceL)}/L)

💰 *GANHOS POR APLICATIVO:*
${appLines || '• Nenhum app registrado\n'}👉 *Faturamento Bruto Total:* *${brlC(totalGrossC)}*

📉 *DESPESAS & DESGASTE:*
• Despesas do Período: *-${brlC(totalExpC)}*
• Provisão de Manutenção (${formatBRL(state.vehicle.maintenanceReservePerKm)}/km): *-${brlC(reserveC)}*
🟢 *LUCRO LÍQUIDO REAL: ${brlC(netC)}*

📈 *EFICIÊNCIA OPERACIONAL:*
• Total de Corridas: *${totalTrips}*
• KM Rodados na Rua: *${totalKm.toFixed(1)} km*
• KM Fora de Serviço (entre jornadas): *${totalKmFora.toFixed(0)} km*
• Horas Trabalhadas: *${totalHours.toFixed(1)}h*
• Média por KM Geral: *${formatBRL(totalKm > 0 ? (totalGrossC/100)/totalKm : 0)}/km*
• Média por Hora Geral: *${formatBRL(totalHours > 0 ? (totalGrossC/100)/totalHours : 0)}/h*

📱 Fechamento Multi-App pelo *MotoristaPro*`;

  document.getElementById('whatsappBox').innerText = text;
}


function copyWhatsAppSummary() {
  const text = document.getElementById('whatsappBox').innerText;
  navigator.clipboard.writeText(text);
  alert('Resumo do fechamento copiado com sucesso! Agora é só colar no WhatsApp.');
}


// CSV compatível com Excel BR: BOM UTF-8, separador ";", decimal com vírgula,
// datas dd/mm/aaaa e seções separadas p/ turnos e despesas
function exportCSV() {
  const S = ';';
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const num = v => (Number(v) || 0).toFixed(2).replace('.', ',');
  const lines = [];

  lines.push('TURNOS');
  lines.push(['Data', 'Período', 'Aplicativos', 'Bruto (R$)', 'Viagens', 'KM', 'Horas', 'Combustível (R$)', 'Odômetro início (km)', 'Km fora de serviço (até próxima jornada)', 'Observações'].join(S));
  state.shifts.forEach(s => {
    const apps = Array.isArray(s.apps) ? s.apps.map(a => `${a.name} ${num((a.gross || 0) + (a.tips || 0))}`).join(' | ') : '';
    const fora = getKmFora(s);
    lines.push([
      formatDate(s.date), q(s.period || 'Integral'), q(apps), num(getShiftTotalGross(s)),
      getShiftTotalTrips(s), num(s.km), num(s.hours), num(s.fuelCost),
      s.odoStart || '', fora !== null ? fora.toFixed(0) : '', q(s.notes || '')
    ].join(S));
  });

  lines.push('');
  lines.push('DESPESAS');
  lines.push(['Data', 'Categoria', 'Descrição', 'Valor (R$)', 'Combustível', 'Litros', 'R$/L', 'Odômetro (km)'].join(S));
  state.expenses.forEach(e => {
    lines.push([
      formatDate(e.date), q(e.category), q(e.title), num(e.amount),
      q(e.fuelType || ''), e.liters ? num(e.liters) : '', e.pricePerLiter ? num(e.pricePerLiter) : '', e.odo || ''
    ].join(S));
  });

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `motoristapro_${getTodayString()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}


function exportJSONBackup() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
  const link = document.createElement('a');
  link.setAttribute('href', dataStr);
  link.setAttribute('download', `motoristapro_backup_${getTodayString()}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}


function clearAllData() {
  if (confirm('⚠️ Tem certeza que deseja limpar TODOS os dados para começar do zero?')) {
    state = migrateState({
      vehicle: JSON.parse(JSON.stringify(defaultData.vehicle)),
      fuelSettings: JSON.parse(JSON.stringify(defaultData.fuelSettings)),
      shifts: [],
      expenses: [],
      maintenance: []
    });
    saveState();
    alert('Todos os dados foram limpos com sucesso. O app foi resetado para começar do zero.');
  }
}
