// MotoristaPro — interações, modais, lançamentos e calculadoras


// Load from local storage
if (localStorage.getItem('mp_html_state_v8')) {
  try {
    const saved = JSON.parse(localStorage.getItem('mp_html_state_v8'));
    if (saved && saved.vehicle) {
      state = migrateState(saved);
      syncVehicleOdometer();
    }
  } catch(e){}
}

const CENTS_MASK_IDS = ['appGrossInput', 'appTipsInput', 'shiftKmTotal', 'shiftFuelCost',
  'expAmount', 'expLitersInput', 'simOffer', 'simPickup', 'simTrip',
  'fuelGasPrice', 'fuelGasKml', 'fuelEthPrice', 'fuelEthKml',
  'cfgReserve', 'cfgTargetKm', 'cfgTargetHour', 'maintCostInput'];

const CALC_AFTER_MASK = {
  shiftKmTotal: () => recalcShiftLive(),
  shiftFuelCost: () => recalcShiftLive(),
  expAmount: () => autoCalcPricePerLiter(),
  expLitersInput: () => autoCalcPricePerLiter(),
  simOffer: () => calculateTripSim(),
  simPickup: () => calculateTripSim(),
  simTrip: () => calculateTripSim(),
  fuelGasPrice: () => calcFuel(),
  fuelGasKml: () => calcFuel(),
  fuelEthPrice: () => calcFuel(),
  fuelEthKml: () => calcFuel()
};

function wireCentsMasks() {
  CENTS_MASK_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('focus', () => setTimeout(() => el.select(), 0));
    if (id === 'shiftFuelCost') {
      el.addEventListener('input', () => {
        el.dataset.shiftFuelMode = 'manual';
      });
      el.addEventListener('blur', () => {
        const autoFuelC = parseInt(el.dataset.autoFuelC || '0', 10) || 0;
        const currentFuelC = toC(el.value);
        el.dataset.shiftFuelMode = (!el.value || currentFuelC === autoFuelC) ? 'auto' : 'manual';
        recalcShiftLive();
      });
    }
    el.addEventListener('input', () => {
      maskCents(el);
      const fn = CALC_AFTER_MASK[id];
      if (fn) fn();
    });
  });
}


function promptInstallPWA() {
  if (deferredPWAEvent) {
    deferredPWAEvent.prompt();
    deferredPWAEvent.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        document.getElementById('pwaInstallBanner').style.display = 'none';
      }
      deferredPWAEvent = null;
    });
  } else {
    alert('Para instalar este app no seu celular:\n\n📱 No Android (Chrome): Toque nos 3 pontinhos no canto superior e selecione "Adicionar à tela inicial" ou "Instalar aplicativo".\n\n🍎 No iPhone (Safari): Toque no botão de Compartilhar (quadrado com seta) e escolha "Adicionar à Tela de Início".');
  }
}


// Register Service Worker for 100% offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      console.log('✅ ServiceWorker registrado com sucesso:', reg.scope);
    }).catch((err) => {
      console.log('ServiceWorker falhou:', err);
    });
  });
}


// Switch tab
function switchTab(tabId) {
  const views = ['dashboard', 'shifts', 'expenses', 'health', 'calc', 'reports'];
  views.forEach(v => {
    const el = document.getElementById('view' + v.charAt(0).toUpperCase() + v.slice(1));
    if(el) el.style.display = (v === tabId) ? 'block' : 'none';
  });

  document.querySelectorAll('.desktop-nav .nav-tab').forEach((el, idx) => {
    el.classList.toggle('active', views[idx] === tabId);
  });
  document.querySelectorAll('.mobile-nav .mob-tab').forEach((el, idx) => {
    el.classList.toggle('active', views[idx] === tabId);
  });

  if (tabId === 'calc') {
    calculateTripSim();
    calcFuel();
  }
}


function openModal(id) {
  const modal = document.getElementById(id);
  if(modal) modal.classList.add('open');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if(modal) modal.classList.remove('open');
}


function toggleFuelFields() {
  const cat = document.getElementById('expCat').value;
  const isFuel = (cat === 'combustivel');
  document.getElementById('fuelFieldsBox').style.display = isFuel ? 'grid' : 'none';
  document.getElementById('fuelTypeRow').style.display = isFuel ? 'block' : 'none';
}


function autoCalcPricePerLiter() {
  const amt = parseVal(document.getElementById('expAmount').value);
  const liters = parseVal(document.getElementById('expLitersInput').value);
  if (amt > 0 && liters > 0) {
    const pL = amt / liters;
    const isGas = document.getElementById('expRadioGasoline').checked;
    if (isGas) {
      state.fuelSettings.gasolinePrice = pL;
      document.getElementById('fuelGasPrice').value = pL.toFixed(2).replace('.', ',');
    } else {
      state.fuelSettings.ethanolPrice = pL;
      document.getElementById('fuelEthPrice').value = pL.toFixed(2).replace('.', ',');
    }
  }
}


// ==============================================================
// AÇÕES DE TURNOS: CRIAR, EDITAR, DELETAR
// ==============================================================
function openCreateShiftModal() {
  editingShiftId = null;
  document.getElementById('modalShiftTitle').innerText = 'Lançar Turno do Dia';
  document.getElementById('btnSaveShiftSubmit').innerText = 'Salvar Turno Completo';
  document.getElementById('shiftDate').value = getTodayString();
  document.getElementById('shiftPeriod').value = 'Integral';
  document.getElementById('shiftTimeStart').value = '07:00';
  document.getElementById('shiftTimeEnd').value = '16:00';
  document.getElementById('shiftKmTotal').value = '';
  document.getElementById('shiftFuelCost').value = '';
  document.getElementById('shiftFuelCost').dataset.autoFuelC = '0';
  document.getElementById('shiftFuelCost').dataset.shiftFuelMode = 'auto';
  document.getElementById('shiftNotes').value = '';
  document.getElementById('shiftFuelOverrideSelect').value = 'auto';
  document.getElementById('shiftOdoStart').value = '';

  stagedShiftApps = [];
  renderStagedApps();
  calculateShiftHoursAuto();
  updateOdoStartVisibility();
  updateShiftFuelRateSelection();
  openModal('modalShift');
}


// Odômetro no início do turno: visível apenas no 1º lançamento do dia
function updateOdoStartVisibility() {
  const date = document.getElementById('shiftDate').value || getTodayString();
  const currentShift = editingShiftId ? state.shifts.find(s => s.id === editingShiftId) : null;
  const editingOwnFirstLaunch = !!(currentShift && currentShift.date === date && currentShift.odoStart);
  const firstOfDay = editingOwnFirstLaunch || !state.shifts.some(s => s.date === date && s.id !== editingShiftId);
  document.getElementById('odoStartGroup').style.display = firstOfDay ? 'block' : 'none';
  recalcShiftLive();
}


function openEditShiftModal(id) {
  const shift = state.shifts.find(s => s.id === id);
  if (!shift) return;

  editingShiftId = id;
  document.getElementById('modalShiftTitle').innerText = 'Editar Turno';
  document.getElementById('btnSaveShiftSubmit').innerText = 'Salvar Alterações';

  document.getElementById('shiftDate').value = shift.date || getTodayString();
  document.getElementById('shiftPeriod').value = shift.period || 'Integral';
  document.getElementById('shiftTimeStart').value = shift.timeStart || '07:00';
  document.getElementById('shiftTimeEnd').value = shift.timeEnd || '16:00';
  document.getElementById('shiftKmTotal').value = shift.km || '';
  document.getElementById('shiftFuelCost').value = fmt2(shift.fuelCost);
  const savedFuelMode = shift.fuelCostMode || (shift.fuelCost > 0 ? 'manual' : 'auto');
  document.getElementById('shiftFuelCost').dataset.autoFuelC = savedFuelMode === 'auto' ? String(toC(shift.fuelCost)) : '0';
  document.getElementById('shiftFuelCost').dataset.shiftFuelMode = savedFuelMode;
  document.getElementById('shiftNotes').value = shift.notes || '';
  document.getElementById('shiftOdoStart').value = shift.odoStart || '';

  if (shift.fuelTypeUsed) {
    document.getElementById('shiftFuelOverrideSelect').value = shift.fuelTypeUsed.toLowerCase();
  } else {
    document.getElementById('shiftFuelOverrideSelect').value = 'auto';
  }

  stagedShiftApps = Array.isArray(shift.apps) ? JSON.parse(JSON.stringify(shift.apps)) : [];
  renderStagedApps();
  calculateShiftHoursAuto();
  updateOdoStartVisibility();
  updateShiftFuelRateSelection();
  openModal('modalShift');
}


function updateShiftFuelRateSelection() {
  const override = document.getElementById('shiftFuelOverrideSelect').value;
  const lastFuel = getLastFuelInfo();

  let activeFuelType = lastFuel.fuelType;
  let activeKml = lastFuel.avgKml;
  let activePrice = lastFuel.priceL;
  let activeCostKm = lastFuel.costPerKm;

  if (override === 'gasolina') {
    activeFuelType = 'Gasolina';
    activeKml = state.fuelSettings.gasolineKmPerL || 11.5;
    activePrice = state.fuelSettings.gasolinePrice || 5.89;
    activeCostKm = activePrice / activeKml;
  } else if (override === 'etanol') {
    activeFuelType = 'Etanol';
    activeKml = state.fuelSettings.ethanolKmPerL || 8.2;
    activePrice = state.fuelSettings.ethanolPrice || 3.89;
    activeCostKm = activePrice / activeKml;
  }

  document.getElementById('shiftFuelDetailsDisplay').innerHTML = `
    <div>
      <span>Combustível do Carro: <strong>${activeFuelType}</strong></span>
      <span style="color: var(--text-muted); font-size: 11px;"> (${activeKml.toFixed(1)} km/L @ ${formatBRL(activePrice)}/L)</span>
    </div>
    <span class="badge" style="background: rgba(16,185,129,0.15); color: #34d399; font-weight: 800;">
      Custo: ${formatBRL(activeCostKm)}/km
    </span>
  `;

  recalcShiftLive();
}


function addCurrentAppToStaging() {
  const appSelect = document.getElementById('currentAppSelect');
  const selectedVal = appSelect.value;
  let appName = appSelect.options[appSelect.selectedIndex].text;
  let badgeClass = 'badge-uber';

  if (selectedVal === 'custom') {
    const customName = document.getElementById('customAppNameInput').value.trim();
    if (!customName) {
      alert('Por favor, informe o nome do aplicativo.');
      return;
    }
    appName = '📱 ' + customName;
    badgeClass = 'badge-other';
  } else if (selectedVal === 'pop') {
    badgeClass = 'badge-99';
  } else if (selectedVal === 'indrive') {
    badgeClass = 'badge-indrive';
  } else if (selectedVal === 'part') {
    badgeClass = 'badge-part';
  } else if (selectedVal === 'ifood' || selectedVal === 'lalamove') {
    badgeClass = 'badge-other';
  }

  const gross = parseVal(document.getElementById('appGrossInput').value);
  const trips = parseInt(document.getElementById('appTripsInput').value) || 0;
  const tips = parseVal(document.getElementById('appTipsInput').value);

  if (gross <= 0 && trips <= 0) {
    alert('Por favor, informe o valor dos ganhos ou as corridas deste app antes de salvar.');
    return;
  }

  stagedShiftApps.push({
    id: selectedVal + '_' + Date.now(),
    appKey: selectedVal,
    name: appName,
    badgeClass,
    gross,
    trips,
    tips
  });

  document.getElementById('appGrossInput').value = '';
  document.getElementById('appTripsInput').value = '';
  document.getElementById('appTipsInput').value = '';
  document.getElementById('customAppNameInput').value = '';

  if (selectedVal === 'uber') appSelect.value = 'pop';
  else if (selectedVal === 'pop') appSelect.value = 'indrive';
  else if (selectedVal === 'indrive') appSelect.value = 'part';
  else appSelect.value = 'uber';
  document.getElementById('customAppNameBox').style.display = 'none';

  renderStagedApps();
  recalcShiftLive();
}


function removeStagedApp(index) {
  stagedShiftApps.splice(index, 1);
  renderStagedApps();
  recalcShiftLive();
}


function calculateShiftHoursAuto() {
  const start = document.getElementById('shiftTimeStart').value;
  const end = document.getElementById('shiftTimeEnd').value;

  if (!start || !end) {
    document.getElementById('calculatedHoursDisplay').innerText = '0h 00min (0.0 horas)';
    document.getElementById('finalHoursValue').value = '0';
    return;
  }

  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);

  let startMin = startH * 60 + startM;
  let endMin = endH * 60 + endM;

  if (endMin < startMin) {
    endMin += 24 * 60;
  }

  const diffMin = endMin - startMin;
  const hours = Math.floor(diffMin / 60);
  const minutes = diffMin % 60;
  const decimalHours = (diffMin / 60);

  document.getElementById('calculatedHoursDisplay').innerText = `⏱️ ${hours}h ${String(minutes).padStart(2, '0')}min (${decimalHours.toFixed(1)} horas)`;
  document.getElementById('finalHoursValue').value = decimalHours.toFixed(2);

  recalcShiftLive();
}


function recalcShiftLive() {
  let totalShiftGrossC = 0;
  stagedShiftApps.forEach(a => {
    totalShiftGrossC += toC(a.gross) + toC(a.tips);
  });

  const km = parseVal(document.getElementById('shiftKmTotal').value);
  const hours = parseVal(document.getElementById('finalHoursValue').value);

  // Dynamic fuel calculation based on parity and last fillup
  const override = document.getElementById('shiftFuelOverrideSelect')?.value || 'auto';
  const lastFuel = getLastFuelInfo();

  let activeCostKm = lastFuel.costPerKm;
  if (override === 'gasolina') {
    activeCostKm = (state.fuelSettings.gasolinePrice || 5.89) / (state.fuelSettings.gasolineKmPerL || 11.5);
  } else if (override === 'etanol') {
    activeCostKm = (state.fuelSettings.ethanolPrice || 3.89) / (state.fuelSettings.ethanolKmPerL || 8.2);
  }

  const autoFuelC = Math.round(km * activeCostKm * 100);
  const fuelInput = document.getElementById('shiftFuelCost');
  const currentFuelC = toC(fuelInput.value);
  const lastAutoFuelC = parseInt(fuelInput.dataset.autoFuelC || '0', 10) || 0;
  const autoManaged = (fuelInput.dataset.shiftFuelMode || 'auto') === 'auto' || !fuelInput.value || currentFuelC === lastAutoFuelC;

  let fuelCostC = currentFuelC;
  if (document.activeElement !== fuelInput && autoManaged) {
    fuelCostC = autoFuelC;
    fuelInput.dataset.autoFuelC = String(autoFuelC);
    fuelInput.dataset.shiftFuelMode = 'auto';
    fuelInput.value = km > 0 ? (autoFuelC / 100).toFixed(2).replace('.', ',') : '';
  }

  const rKm = km > 0 ? (totalShiftGrossC / 100) / km : 0;
  const rHour = hours > 0 ? (totalShiftGrossC / 100) / hours : 0;
  const reserveC = Math.round(km * (state.vehicle.maintenanceReservePerKm || 0.18) * 100);
  const netC = totalShiftGrossC - (fuelCostC || autoFuelC) - reserveC;

  document.getElementById('liveShiftGross').innerText = brlC(totalShiftGrossC);
  document.getElementById('liveShiftRateKm').innerText = `${formatBRL(rKm)}/km`;
  document.getElementById('liveShiftRateHour').innerText = `${formatBRL(rHour)}/h`;
  document.getElementById('liveShiftNet').innerText = brlC(netC);
  setSignedValueClass('liveShiftNet', netC);

  // O odômetro inicial fica registrado para cálculo posterior nos relatórios.
  const odoGroup = document.getElementById('odoStartGroup');
  if (odoGroup && odoGroup.style.display !== 'none') {
    const hint = document.getElementById('odoStartHint');
    if (hint) hint.innerText = 'Usado apenas nos relatórios para calcular km fora de serviço até a próxima jornada.';
  }
}


function saveFinalShift() {
  const date = document.getElementById('shiftDate').value || getTodayString();
  const period = document.getElementById('shiftPeriod').value;
  const km = parseVal(document.getElementById('shiftKmTotal').value);
  const hours = parseVal(document.getElementById('finalHoursValue').value);
  const timeStart = document.getElementById('shiftTimeStart').value;
  const timeEnd = document.getElementById('shiftTimeEnd').value;
  const fuelCost = parseVal(document.getElementById('shiftFuelCost').value);
  const fuelCostMode = document.getElementById('shiftFuelCost').dataset.shiftFuelMode || 'manual';
  const notes = document.getElementById('shiftNotes').value;
  const override = document.getElementById('shiftFuelOverrideSelect').value;
  const fuelTypeUsed = (override === 'auto') ? getLastFuelInfo().fuelType : (override === 'gasolina' ? 'Gasolina' : 'Etanol');

  // Odômetro no início (apenas 1º lançamento do dia)
  let odoStart;
  if (document.getElementById('odoStartGroup').style.display !== 'none') {
    const v = parseVal(document.getElementById('shiftOdoStart').value);
    odoStart = v > 0 ? v : undefined;
  } else if (editingShiftId) {
    odoStart = (state.shifts.find(s => s.id === editingShiftId) || {}).odoStart;
  }

  if (stagedShiftApps.length === 0 && km === 0) {
    alert('Por favor, adicione ao menos os ganhos de um aplicativo na caixa de seleção.');
    return;
  }
  if (km <= 0) {
    alert('Por favor, informe a quilometragem total rodada no turno.');
    return;
  }

  if (editingShiftId) {
    const idx = state.shifts.findIndex(s => s.id === editingShiftId);
    if (idx !== -1) {
      state.shifts[idx] = {
        ...state.shifts[idx],
        date,
        period,
        apps: [...stagedShiftApps],
        km,
        hours: hours > 0 ? hours : 8.0,
        timeStart,
        timeEnd,
        fuelCost,
        fuelCostMode,
        fuelTypeUsed,
        notes,
        odoStart
      };
    }
  } else {
    const newShift = {
      id: uid(),
      date,
      period,
      apps: [...stagedShiftApps],
      km,
      hours: hours > 0 ? hours : 8.0,
      timeStart,
      timeEnd,
      fuelCost,
      fuelCostMode,
      fuelTypeUsed,
      notes,
      odoStart
    };
    state.shifts.unshift(newShift);
    // REGRA DE NEGÓCIO: o km do turno pertence à jornada de trabalho e NÃO
    // soma no odômetro como leitura. O odômetro avança por leituras reais:
    // abastecimentos, manutenções e o fim de turno derivado do 1º lançamento
    // do dia (odoStart + km) — base p/ calcular km fora de serviço entre jornadas.
  }

  syncVehicleOdometer();

  saveState();
  closeModal('modalShift');
  editingShiftId = null;
}


function deleteShift(id) {
  if(confirm('Deseja realmente excluir este registro de turno?')) {
    state.shifts = state.shifts.filter(s => s.id !== id);
    syncVehicleOdometer();
    saveState();
  }
}


// ==============================================================
// AÇÕES DE DESPESAS COM VÍNCULO AO ÚLTIMO ABASTECIMENTO
// ==============================================================
function openCreateExpenseModal() {
  editingExpenseId = null;
  document.getElementById('modalExpenseTitle').innerText = 'Lançar Despesa / Abastecimento';
  document.getElementById('btnSaveExpenseSubmit').innerText = 'Salvar Gasto';
  document.getElementById('expDate').value = getTodayString();
  document.getElementById('expAmount').value = '';
  document.getElementById('expTitle').value = '';
  document.getElementById('expLitersInput').value = '';
  document.getElementById('expOdoInput').value = '';
  document.getElementById('expCat').value = 'combustivel';
  document.getElementById('expRadioEthanol').checked = true;
  toggleFuelFields();
  openModal('modalExpense');
}


function openEditExpenseModal(id) {
  const exp = state.expenses.find(e => e.id === id);
  if (!exp) return;

  editingExpenseId = id;
  document.getElementById('modalExpenseTitle').innerText = 'Editar Despesa';
  document.getElementById('btnSaveExpenseSubmit').innerText = 'Salvar Alterações';

  document.getElementById('expCat').value = exp.category || 'combustivel';
  document.getElementById('expDate').value = exp.date || getTodayString();
  document.getElementById('expAmount').value = fmt2(exp.amount);
  document.getElementById('expTitle').value = exp.title || '';
  document.getElementById('expLitersInput').value = exp.liters ? parseVal(exp.liters).toFixed(2).replace('.', ',') : '';
  document.getElementById('expOdoInput').value = exp.odo || '';

  if (exp.fuelType === 'Gasolina' || (exp.title && exp.title.toLowerCase().includes('gasolina'))) {
    document.getElementById('expRadioGasoline').checked = true;
  } else {
    document.getElementById('expRadioEthanol').checked = true;
  }

  toggleFuelFields();
  openModal('modalExpense');
}


function saveExpense(e) {
  e.preventDefault();
  const cat = document.getElementById('expCat').value;
  const date = document.getElementById('expDate').value || getTodayString();
  const amount = parseVal(document.getElementById('expAmount').value);
  const title = document.getElementById('expTitle').value;
  const liters = parseVal(document.getElementById('expLitersInput').value) || undefined;
  const odo = parseVal(document.getElementById('expOdoInput').value) || undefined;

  const isFuel = (cat === 'combustivel');
  const fuelType = isFuel ? (document.getElementById('expRadioGasoline').checked ? 'Gasolina' : 'Etanol') : undefined;
  const pricePerLiter = (isFuel && amount > 0 && liters > 0) ? (amount / liters) : undefined;

  if (isFuel && pricePerLiter) {
    if (fuelType === 'Gasolina') {
      state.fuelSettings.gasolinePrice = pricePerLiter;
    } else {
      state.fuelSettings.ethanolPrice = pricePerLiter;
    }
  }

  if (editingExpenseId) {
    const idx = state.expenses.findIndex(exp => exp.id === editingExpenseId);
    if (idx !== -1) {
      state.expenses[idx] = {
        ...state.expenses[idx],
        date, category: cat, title, amount, liters, odo, fuelType, pricePerLiter
      };
    }
  } else {
    state.expenses.unshift({
      id: uid(),
      date, category: cat, title, amount, liters, odo, fuelType, pricePerLiter
    });
  }

  // REGRA DE NEGÓCIO: odômetro é alimentado por leituras reais com odômetro
  // (abastecimentos, manutenções e início+fim do 1º turno do dia).
  syncVehicleOdometer();

  saveState();
  closeModal('modalExpense');
  editingExpenseId = null;
}


function deleteExpense(id) {
  if(confirm('Deseja realmente excluir esta despesa?')) {
    state.expenses = state.expenses.filter(e => e.id !== id);
    syncVehicleOdometer();
    saveState();
  }
}


// ==============================================================
// AÇÕES DE MANUTENÇÃO PREVENTIVA
// ==============================================================
function openCreateMaintenanceModal() {
  editingMaintId = null;
  document.getElementById('modalMaintTitle').innerText = 'Novo Item de Revisão Preventiva';
  document.getElementById('btnSaveMaintSubmit').innerText = 'Adicionar Item';
  document.getElementById('maintNameInput').value = '';
  document.getElementById('maintIntervalInput').value = '10000';
  document.getElementById('maintCostInput').value = '150,00';
  document.getElementById('maintLastKmInput').value = state.vehicle.odometer || 60000;
  openModal('modalMaintItem');
}


function openEditMaintenanceModal(id) {
  const item = state.maintenance.find(m => m.id === id);
  if (!item) return;

  editingMaintId = id;
  document.getElementById('modalMaintTitle').innerText = 'Editar Item de Revisão';
  document.getElementById('btnSaveMaintSubmit').innerText = 'Salvar Alterações';
  document.getElementById('maintNameInput').value = item.name;
  document.getElementById('maintIntervalInput').value = item.interval;
  document.getElementById('maintCostInput').value = fmt2(item.cost);
  document.getElementById('maintLastKmInput').value = item.lastKm;
  openModal('modalMaintItem');
}


function saveMaintenanceItem(e) {
  e.preventDefault();
  const name = document.getElementById('maintNameInput').value.trim();
  const interval = parseInt(document.getElementById('maintIntervalInput').value) || 10000;
  const cost = parseVal(document.getElementById('maintCostInput').value);
  const lastKm = parseVal(document.getElementById('maintLastKmInput').value);

  if (editingMaintId) {
    const idx = state.maintenance.findIndex(m => m.id === editingMaintId);
    if (idx !== -1) {
      state.maintenance[idx] = {
        ...state.maintenance[idx],
        name, interval, cost, lastKm
      };
    }
  } else {
    state.maintenance.push({
      id: uid(),
      name, interval, cost, lastKm
    });
  }

  saveState();
  closeModal('modalMaintItem');
  editingMaintId = null;
}


function deleteMaintenanceItem(id) {
  if(confirm('Deseja realmente remover este item de monitoramento de revisão?')) {
    state.maintenance = state.maintenance.filter(m => m.id !== id);
    saveState();
  }
}


function executeMaintenance(mId) {
  const item = state.maintenance.find(m => m.id === mId);
  if(!item) return;

  const costInput = prompt(`Confirmar troca de "${item.name}"?\nDigite o valor pago (R$):`, item.cost);
  if(costInput === null) return;
  const cost = parseVal(costInput);

  item.lastKm = state.vehicle.odometer;

  state.expenses.unshift({
    id: uid(),
    date: getTodayString(),
    category: 'manutencao',
    title: item.name,
    amount: cost,
    odo: state.vehicle.odometer
  });

  syncVehicleOdometer();
  saveState();
  alert(`✅ Manutenção registrada com sucesso! Despesa de ${formatBRL(cost)} lançada no seu fluxo de caixa.`);
}


function saveSettings(e) {
  e.preventDefault();
  state.vehicle.model = document.getElementById('cfgModel').value;
  state.vehicle.plate = document.getElementById('cfgPlate').value;
  state.vehicle.odometer = parseVal(document.getElementById('cfgOdo').value) || 64850;
  state.vehicle.manualOdometerBase = state.vehicle.odometer;
  state.vehicle.maintenanceReservePerKm = parseVal(document.getElementById('cfgReserve').value) || 0.18;
  state.vehicle.monthlyGoal = parseVal(document.getElementById('cfgMonthlyGoal').value) || 7000;
  state.vehicle.targetKmRate = parseVal(document.getElementById('cfgTargetKm').value) || 2.20;
  state.vehicle.targetHourlyRate = parseVal(document.getElementById('cfgTargetHour').value) || 35.00;

  saveState();
  closeModal('modalSettings');
}


// Calculators
function calculateTripSim() {
  const offer = parseVal(document.getElementById('simOffer').value);
  const pickup = parseVal(document.getElementById('simPickup').value);
  const trip = parseVal(document.getElementById('simTrip').value);
  const minutes = parseVal(document.getElementById('simMinutes').value) || 1;

  const totalKm = pickup + trip;
  const hours = minutes / 60;

  const offerC = toC(offer);
  const rKm = totalKm > 0 ? (offerC / 100) / totalKm : 0;
  const rHour = hours > 0 ? (offerC / 100) / hours : 0;

  const fuelInfo = getLastFuelInfo();
  const fuelCostC = Math.round(totalKm * fuelInfo.costPerKm * 100);
  const reserveC = Math.round(totalKm * (state.vehicle.maintenanceReservePerKm || 0.18) * 100);
  const netC = offerC - fuelCostC - reserveC;

  document.getElementById('simRateKm').innerText = `${formatBRL(rKm)}/km`;
  document.getElementById('simRateHour').innerText = `${formatBRL(rHour)}/h`;
  document.getElementById('simNet').innerText = brlC(netC);

  const excellentKm = (state.vehicle.targetKmRate || 2.20) * (2.5 / 2.2);
  const excellentHour = (state.vehicle.targetHourlyRate || 35.00) * (45 / 35);
  const warningKm = (state.vehicle.targetKmRate || 2.20) * (1.9 / 2.2);
  const warningHour = (state.vehicle.targetHourlyRate || 35.00) * (28 / 35);

  const vBox = document.getElementById('simVerdictBox');
  if (rKm >= excellentKm && rHour >= excellentHour) {
    vBox.innerText = '🔥 CORRIDA EXCELENTE! (Super Lucro)';
    vBox.style.background = 'rgba(16, 185, 129, 0.2)';
    vBox.style.color = '#34d399';
  } else if (rKm < warningKm || rHour < warningHour) {
    vBox.innerText = '❌ CUIDADO! Prejuízo ou Margem Mínima';
    vBox.style.background = 'rgba(244, 63, 94, 0.2)';
    vBox.style.color = '#fb7185';
  } else {
    vBox.innerText = '⚠️ Corrida Aceitável / Regular';
    vBox.style.background = 'rgba(245, 158, 11, 0.2)';
    vBox.style.color = '#fbbf24';
  }
}


function calcFuel() {
  const gasP = parseVal(document.getElementById('fuelGasPrice').value) || 5.89;
  const gasKml = parseVal(document.getElementById('fuelGasKml').value) || 11.5;
  const ethP = parseVal(document.getElementById('fuelEthPrice').value) || 3.89;
  const ethKml = parseVal(document.getElementById('fuelEthKml').value) || 8.2;

  // Update state fuelSettings
  state.fuelSettings.gasolinePrice = gasP;
  state.fuelSettings.gasolineKmPerL = gasKml;
  state.fuelSettings.ethanolPrice = ethP;
  state.fuelSettings.ethanolKmPerL = ethKml;

  const costGas = gasKml > 0 ? gasP / gasKml : 0;
  const costEth = ethKml > 0 ? ethP / ethKml : 0;
  const ratio = gasP > 0 ? (ethP / gasP) * 100 : 0;

  document.getElementById('costGas').innerText = `${formatBRL(costGas)}/km`;
  document.getElementById('costEth').innerText = `${formatBRL(costEth)}/km`;
  document.getElementById('fuelParityText').innerText = `Paridade real: ${ratio.toFixed(1)}% do preço da gasolina.`;

  const v = document.getElementById('fuelVerdict');
  if(costEth < costGas) {
    v.innerText = '🏆 Abasteça com ETANOL! É mais econômico por KM.';
    v.style.color = '#34d399';
  } else {
    v.innerText = '🏆 Abasteça com GASOLINA! Mais vantajosa no seu carro.';
    v.style.color = '#fbbf24';
  }
}
