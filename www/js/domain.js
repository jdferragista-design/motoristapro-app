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


// ---------- Odômetro & km fora de serviço ----------
// Regra: calcular somente ENTRE jornadas. Para cada dia com odoStart,
// usamos: (odoStart da próxima jornada) - (odoStart do dia atual + km total do dia atual).
// O valor fica disponível apenas para relatórios/exportações.
function getWorkdayOdoSummaries() {
  const byDate = {};

  state.shifts.forEach(s => {
    if (!s.date) return;
    if (!byDate[s.date]) {
      byDate[s.date] = {
        date: s.date,
        km: 0,
        odoStart: null,
        firstTime: null,
        firstShiftId: null
      };
    }

    const day = byDate[s.date];
    day.km += (s.km || 0);

    if (s.odoStart > 0) {
      const time = s.timeStart || '23:59';
      if (
        day.odoStart === null ||
        day.firstTime === null ||
        time < day.firstTime
      ) {
        day.odoStart = s.odoStart;
        day.firstTime = time;
        day.firstShiftId = s.id;
      }
    }
  });

  return Object.values(byDate).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

function getKmFora(s) {
  if (!s || !s.odoStart) return null;

  const days = getWorkdayOdoSummaries().filter(d => d.odoStart > 0);
  const idx = days.findIndex(d => d.date === s.date && d.firstShiftId === s.id);
  if (idx === -1 || idx >= days.length - 1) return null;

  const current = days[idx];
  const next = days[idx + 1];
  return Math.max(0, (next.odoStart || 0) - ((current.odoStart || 0) + (current.km || 0)));
}

function getTotalKmFora() {
  return state.shifts.reduce((acc, s) => acc + (getKmFora(s) || 0), 0);
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
  const priceL = lastPricePerLiter;
  const costPerKm = avgKml > 0 ? (priceL / avgKml) : 0.48;

  return {
    fuelType: isGas ? 'Gasolina' : 'Etanol',
    avgKml,
    priceL,
    costPerKm,
    lastDate
  };
}
