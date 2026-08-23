// MotoristaPro — regras de domínio (totais de turno, combustível, odômetro, períodos)


// ---------- Período do painel ----------
let dashPeriod = 'month';

function inPeriod(dateStr) {
  if (dashPeriod === 'all') return true;
  if (!dateStr) return false;
  if (dashPeriod === 'day') return dateStr === getTodayString();
  const now = new Date();
  if (dashPeriod === 'month') return dateStr.startsWith(getTodayString().slice(0, 7));
  const days = dashPeriod === '7' ? 7 : 30;
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return dateStr >= iso(from) && dateStr <= iso(now);
}

function setDashPeriod(p, btn) {
  dashPeriod = p;
  document.querySelectorAll('.period-btn').forEach(b => b.classList.toggle('active', b === btn));
  render();
}


// ---------- Odômetro & km fora do trabalho ----------
// Última leitura conhecida ANTES de uma data: abastecimentos com odômetro
// e fins de turno derivados (odoStart + km) de dias anteriores.
function getOdoBeforeDate(dateStr) {
  let odo = 0;
  state.expenses.forEach(e => { if (e.odo && e.date && e.date < dateStr) odo = Math.max(odo, e.odo); });
  state.shifts.forEach(s => { if (s.odoStart && s.date && s.date < dateStr) odo = Math.max(odo, s.odoStart + (s.km || 0)); });
  return odo;
}

function getKmFora(s) {
  if (!s.odoStart) return null;
  return Math.max(0, s.odoStart - getOdoBeforeDate(s.date));
}


function getShiftTotalGrossC(s) {
  if (s.totalGross !== undefined) return toC(s.totalGross);
  let total = 0;
  if (Array.isArray(s.apps)) {
    s.apps.forEach(app => { total += toC(app.gross) + toC(app.tips); });
  } else if (s.apps && typeof s.apps === 'object') {
    Object.values(s.apps).forEach(app => { total += toC(app.gross) + toC(app.tips); });
  } else if (s.gross !== undefined) {
    total = toC(s.gross) + toC(s.tips);
  }
  return total;
}

function getShiftTotalGross(s) { return getShiftTotalGrossC(s) / 100; }


function getShiftTotalTrips(s) {
  if (s.totalTrips !== undefined) return s.totalTrips;
  let total = 0;
  if (Array.isArray(s.apps)) {
    s.apps.forEach(app => {
      total += (app.trips || 0);
    });
  } else if (s.apps && typeof s.apps === 'object') {
    Object.values(s.apps).forEach(app => {
      total += (app.trips || 0);
    });
  } else if (s.trips !== undefined) {
    total = (s.trips || 0);
  }
  return total;
}


// ==============================================================
// FUNÇÃO QUE PUXA A MÉDIA DA PARIDADE + ÚLTIMO ABASTECIMENTO
// ==============================================================
function getLastFuelInfo() {
  // Ordena por data (mais recente primeiro) para não depender da ordem do array
  const fuelExpenses = state.expenses
    .filter(e => e.category === 'combustivel')
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  let lastFuelType = 'Etanol';
  let lastPricePerLiter = state.fuelSettings.ethanolPrice || 3.89;
  let lastDate = 'N/A';

  if (fuelExpenses.length > 0) {
    const lastExp = fuelExpenses[0];
    lastDate = formatDate(lastExp.date);

    if (lastExp.fuelType) {
      lastFuelType = lastExp.fuelType;
    } else if (lastExp.title && lastExp.title.toLowerCase().includes('gasolina')) {
      lastFuelType = 'Gasolina';
    } else if (lastExp.title && lastExp.title.toLowerCase().includes('etanol')) {
      lastFuelType = 'Etanol';
    }

    if (lastExp.pricePerLiter && lastExp.pricePerLiter > 0) {
      lastPricePerLiter = lastExp.pricePerLiter;
    } else if (lastExp.amount && lastExp.liters && lastExp.liters > 0) {
      lastPricePerLiter = lastExp.amount / lastExp.liters;
    } else {
      lastPricePerLiter = (lastFuelType === 'Gasolina') ? state.fuelSettings.gasolinePrice : state.fuelSettings.ethanolPrice;
    }
  }

  const isGas = lastFuelType.toLowerCase().includes('gasolina');
  const avgKml = isGas ? (state.fuelSettings.gasolineKmPerL || 11.5) : (state.fuelSettings.ethanolKmPerL || 8.2);
  const priceL = isGas ? (state.fuelSettings.gasolinePrice || 5.89) : (state.fuelSettings.ethanolPrice || 3.89);
  const costPerKm = avgKml > 0 ? (priceL / avgKml) : 0.48;

  return {
    fuelType: isGas ? 'Gasolina' : 'Etanol',
    avgKml,
    priceL,
    costPerKm,
    lastDate
  };
}
