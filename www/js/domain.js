// MotoristaPro — regras de domínio (totais de turno, combustível, odômetro, períodos)


// ---------- Período do painel ----------
let dashPeriod = 'month';

// ---------- Dia selecionado no Resumo do Dia ('' = hoje) ----------
let dashboardDay = '';

function setDashboardDay(d) {
  dashboardDay = d || '';
  render();
}

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
  document.querySelectorAll('.period-btn').forEach(b => {
    const on = b === btn;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
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

function getMaxRecordedOdometer() {
  let maxOdo = 0;

  state.expenses.forEach(e => {
    if (e && e.odo > 0) maxOdo = Math.max(maxOdo, e.odo);
  });

  state.shifts.forEach(s => {
    if (s && s.odoStart > 0) maxOdo = Math.max(maxOdo, s.odoStart + (s.km || 0));
  });

  return maxOdo;
}

function syncVehicleOdometer() {
  const manualBase = state.vehicle.manualOdometerBase || 0;
  state.vehicle.odometer = Math.max(manualBase, getMaxRecordedOdometer(), 0);
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


// ---------- Aba Gráficos (filtros e agregações da central de gráficos) ----------
let chartType = 'trend';
let chartPeriod = '90';

const CHART_PERIODS = { '7': 7, '30': 30, '90': 90, '180': 180, '365': 365, all: null };
const CHART_MONTHS_FOR = { '90': 3, '180': 6, '365': 12 };
const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MONTH_LONG = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const EXPENSE_CAT_LABELS = { combustivel: 'Combustível', alimentacao: 'Alimentação', lavagem: 'Lavagem', manutencao: 'Manutenção', fixo: 'Custo Fixo', pedagio: 'Pedágio/Estacionamento', outros: 'Outros' };
const EXPENSE_CAT_COLORS = { combustivel: '#f43f5e', alimentacao: '#fbbf24', lavagem: '#38bdf8', manutencao: '#a855f7', fixo: '#64748b', pedagio: '#f97316', outros: '#34d399' };

function isoAddDays(iso, delta) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function chartFromISO() {
  const n = CHART_PERIODS[chartPeriod];
  if (n === null || n === undefined) return null;
  return isoAddDays(getTodayString(), -(n - 1));
}

function setChartType(t, btn) {
  chartType = t;
  document.querySelectorAll('#chartTypeRow .period-btn').forEach(b => b.classList.toggle('active', b === btn));
  renderChartsView();
}

function setChartPeriodG(p, btn) {
  chartPeriod = p;
  document.querySelectorAll('#chartPeriodRow .period-btn').forEach(b => b.classList.toggle('active', b === btn));
  renderChartsView();
}

// Buckets por dia ISO dentro de [fromISO..] (fromISO null = tudo)
function dayBuckets(shifts, expenses, fromISO) {
  const b = {};
  const ensure = dt => (b[dt] = b[dt] || { grossC: 0, fuelC: 0, km: 0, expOtherC: 0 });
  const hit = dt => dt && dt.length === 10 && (!fromISO || dt >= fromISO);
  shifts.forEach(s => {
    if (!hit(s.date)) return;
    const d = ensure(s.date);
    d.grossC += getShiftTotalGrossC(s);
    d.fuelC += toC(s.fuelCost);
    d.km += (s.km || 0);
  });
  expenses.forEach(e => {
    if (!hit(e.date) || e.category === 'combustivel') return; // combustível já entra via turno
    ensure(e.date).expOtherC += toC(e.amount);
  });
  return b;
}

function costOfBucket(bkt, reserveRate) {
  return bkt.fuelC + Math.round((bkt.km || 0) * reserveRate * 100) + bkt.expOtherC;
}

// Totais consolidados num intervalo inclusivo [aISO..bISO] (null = aberto)
function rangeTotals(shifts, expenses, aISO, bISO, reserveRate) {
  const within = dt => dt && (!aISO || dt >= aISO) && (!bISO || dt <= bISO);
  const parts = costPartsForRange(shifts, expenses, aISO, bISO);
  const days = new Set();
  shifts.forEach(s => { if (within(s.date)) days.add(s.date); });
  return { grossC: parts.grossC, costC: parts.totalCostC, netC: parts.netC,
           km: parts.km, trips: parts.trips, workedDays: days.size };
}

// Série diária dos últimos N dias calendário
function buildDailySeries(shifts, expenses, opts) {
  const { days, reserveRate, today } = opts;
  const buckets = dayBuckets(shifts, expenses, isoAddDays(today, -(days - 1)));
  const out = [];
  for (let off = days - 1; off >= 0; off--) {
    const iso = isoAddDays(today, -off);
    const bkt = buckets[iso] || { grossC: 0, fuelC: 0, km: 0, expOtherC: 0 };
    const costC = costOfBucket(bkt, reserveRate);
    const parts = iso.split('-');
    out.push({
      key: iso,
      label: `${Number(parts[2])}/${Number(parts[1])}`,
      tip: `${Number(parts[2])}/${Number(parts[1])}/${parts[0]}`,
      grossC: bkt.grossC,
      expC: costC,
      netC: bkt.grossC - costC,
      hasData: !!buckets[iso]
    });
  }
  return out;
}

// Série mensal: months=n (terminando no mês atual) ou null = todo o histórico
function buildMonthlySeries(shifts, expenses, opts) {
  const { months, reserveRate, today } = opts;
  const perMonth = {};
  Object.entries(dayBuckets(shifts, expenses, null)).forEach(([iso, b]) => {
    const ym = iso.slice(0, 7);
    const acc = (perMonth[ym] = perMonth[ym] || { grossC: 0, fuelC: 0, km: 0, expOtherC: 0 });
    acc.grossC += b.grossC; acc.fuelC += b.fuelC; acc.km += b.km; acc.expOtherC += b.expOtherC;
  });
  const ty = Number(today.slice(0, 4)), tm = Number(today.slice(5, 7)) - 1;
  let count, startY, startM;
  if (months == null) {
    const keys = Object.keys(perMonth).sort();
    startY = keys.length ? Number(keys[0].slice(0, 4)) : ty;
    startM = keys.length ? Number(keys[0].slice(5, 7)) - 1 : tm;
    count = (ty - startY) * 12 + (tm - startM) + 1;
  } else {
    const absStart = ty * 12 + tm - (months - 1);
    startY = Math.floor(absStart / 12); startM = ((absStart % 12) + 12) % 12;
    count = months;
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    const abs = startY * 12 + startM + i;
    const y = Math.floor(abs / 12), m = ((abs % 12) + 12) % 12;
    const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
    const bkt = perMonth[ym] || { grossC: 0, fuelC: 0, km: 0, expOtherC: 0 };
    const costC = costOfBucket(bkt, reserveRate);
    out.push({
      key: ym,
      label: MONTH_SHORT[m] + (y !== ty ? `/${String(y).slice(-2)}` : ''),
      tip: `${MONTH_LONG[m]} de ${y}`,
      grossC: bkt.grossC,
      expC: costC,
      netC: bkt.grossC - costC,
      hasData: !!perMonth[ym],
      future: y * 12 + m > ty * 12 + tm
    });
  }
  while (out.length > 1 && !out[0].hasData && !out[1].hasData) out.shift();
  return out.filter(p => !p.future);
}

// Média de bruto por dia da semana (somente dias trabalhados no intervalo)
function buildWeekdayItems(shifts, aISO, bISO) {
  const agg = Array.from({ length: 7 }, () => ({ dates: new Set(), grossC: 0 }));
  shifts.forEach(s => {
    if (!s.date || s.date.length !== 10) return;
    if (aISO && s.date < aISO) return;
    if (bISO && s.date > bISO) return;
    const dow = new Date(`${s.date}T12:00:00`).getDay();
    agg[dow].dates.add(s.date);
    agg[dow].grossC += getShiftTotalGrossC(s);
  });
  return WEEKDAY_SHORT.map((label, i) => ({
    label,
    avgC: agg[i].dates.size > 0 ? Math.round(agg[i].grossC / agg[i].dates.size) : 0,
    count: agg[i].dates.size
  }));
}

// Despesas por categoria no intervalo (combustível conta via turno)
function expenseBreakdown(shifts, expenses, aISO, bISO) {
  const within = dt => dt && dt.length === 10 && (!aISO || dt >= aISO) && (!bISO || dt <= bISO);
  const byCat = {};
  shifts.forEach(s => { if (within(s.date)) byCat.combustivel = (byCat.combustivel || 0) + toC(s.fuelCost); });
  expenses.forEach(e => {
    if (!within(e.date) || e.category === 'combustivel') return; // combustível já entra via turno
    const cat = e.category || 'outros';
    byCat[cat] = (byCat[cat] || 0) + toC(e.amount);
  });
  return Object.entries(byCat)
    .map(([cat, total]) => ({ name: EXPENSE_CAT_LABELS[cat] || cat, color: EXPENSE_CAT_COLORS[cat] || '#34d399', total }))
    .sort((a, b) => b.total - a.total);
}

// Faturamento por aplicativo no intervalo (com ticket médio por corrida)
function appBreakdown(shifts, aISO, bISO) {
  const byApp = {};
  shifts.forEach(s => {
    if (!s.date || s.date.length !== 10) return;
    if (aISO && s.date < aISO) return;
    if (bISO && s.date > bISO) return;
    const apps = Array.isArray(s.apps) ? s.apps : (s.apps && typeof s.apps === 'object' ? Object.values(s.apps) : []);
    apps.forEach(a => {
      const k = (a && a.name) || 'Outro';
      byApp[k] = byApp[k] || { name: k, total: 0, trips: 0 };
      byApp[k].total += toC(a.gross) + toC(a.tips);
      byApp[k].trips += (a.trips || 0);
    });
  });
  return Object.values(byApp).map(z => ({
    name: z.name, total: z.total, trips: z.trips,
    ticket: z.trips > 0 ? Math.round(z.total / z.trips) : null
  })).sort((a, b) => b.total - a.total);
}
function costPartsForRange(shifts, expenses, aISO, bISO) {
  // Período filtrado por COMPETÊNCIA (não por data de pagamento): quem paga a
  // parcela do carro adiantado não pode ver o custo cair no mês vizinho.
  const withinShifts = dt => dt && dt.length === 10 && (!aISO || dt >= aISO) && (!bISO || dt <= bISO);
  const withinExp = e => {
    if (!e) return false;
    const c = competenceOf(e);
    // janelas móveis usam o mês de competência; intervalos fechados idem
    if (aISO && c < aISO.slice(0, 7)) return false;
    if (bISO && c > bISO.slice(0, 7)) return false;
    return true;
  };
  let grossC = 0, km = 0, trips = 0, hours = 0, shiftFuelC = 0;
  shifts.forEach(s => {
    if (!withinShifts(s.date)) return;
    grossC += getShiftTotalGrossC(s);
    km += (s.km || 0);
    trips += getShiftTotalTrips(s);
    hours += parseFloat(s.hours) || 0;
    shiftFuelC += toC(s.fuelCost);
  });
  const reserveRate = state.vehicle.maintenanceReservePerKm || 0.18;
  const reserveC = Math.round(km * reserveRate * 100);
  let otherOpC = 0, fixedC = 0, maintRealC = 0;
  expenses.forEach(e => {
    if (!withinExp(e) || e.category === 'combustivel') return;
    if ((e.category || '') === 'fixo') {
      fixedC += toC(e.amount);
      return;
    }
    if ((e.category || '') === 'manutencao') {
      const v = toC(e.amount);
      maintRealC += v;
      // PROVISÃO × MANUTENÇÃO REAL são o MESMO dinheiro.
      // O fundo de reserva (R$/km) é uma previsão de desgaste; quando a
      // manutenção efetivamente acontece, ela já está paga ali. Cobrar as
      // duas coisas desconta o mesmo custo duas vezes — foi exatamente o que
      // aconteceu com o histórico de referência (provisão R$ 1.712 + pneus e
      // óleo R$ 1.924 = R$ 3.636 para o mesmo desgaste).
      return;
    }
    otherOpC += toC(e.amount);
  });
  // consome a provisão primeiro; o excedente é desgaste ainda não pago
  const reserveConsumedC = Math.min(reserveC, maintRealC);
  const reserveOpenC = reserveC - reserveConsumedC;
  const excessMaintC = maintRealC - reserveConsumedC;
  const opCostC = shiftFuelC + reserveOpenC + otherOpC + excessMaintC;
  return {
    grossC, km, trips, hours, shiftFuelC, reserveC, reserveConsumedC, reserveOpenC,
    maintRealC, excessMaintC, otherOpC, fixedC,
    opCostC, totalCostC: opCostC + fixedC,
    netC: grossC - (opCostC + fixedC),
    rsKm: km > 0 ? grossC / km : 0,
    rsH: hours > 0 ? grossC / hours : 0
  };
}


// ==============================================================
// TEMPO OCIOSO ENTRE TURNOS  (R$/h honesto)
// ==============================================================
// O motorista de app raramente faz um turno contínuo: sai de casa, roda,
// volta, sai de novo. Somar só as horas dentro de cada turno infla o R$/h.
// Nos dados de referência (199 turnos) isso dava R$ 34,22/h contra
// R$ 18,48/h contando o intervalo — 46% de diferença, em 97% dos dias.
function timeToMinutes(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Minutos ociosos num dia (soma dos intervalos entre turnos consecutivos)
function getIdleMinutesForDay(dayShifts) {
  const list = (dayShifts || [])
    .map(s => ({ s: s, start: timeToMinutes(s.timeStart), end: timeToMinutes(s.timeEnd) }))
    .filter(x => x.start !== null && x.end !== null)
    .sort((a, b) => a.start - b.start);
  let idle = 0;
  for (let i = 1; i < list.length; i++) {
    const prevEnd = list[i - 1].end;
    const curStart = list[i].start;
    if (curStart > prevEnd) idle += curStart - prevEnd;
  }
  return idle;
}

// Minutos ociosos no conjunto de turnos (agrupa por data)
function getIdleMinutes(shifts) {
  const byDay = {};
  (shifts || []).forEach(s => {
    if (!s || !s.date) return;
    (byDay[s.date] = byDay[s.date] || []).push(s);
  });
  return Object.values(byDay).reduce((acc, list) => acc + getIdleMinutesForDay(list), 0);
}

// Minutos trabalhados (soma das horas declaradas)
function getWorkedMinutes(shifts) {
  return (shifts || []).reduce((acc, s) => acc + Math.round((parseFloat(s && s.hours) || 0) * 60), 0);
}


// ==============================================================
// COMPETÊNCIA (regime de competência vs. caixa)
// ==============================================================
// O utilizador real paga a parcela do carro ~10 dias antes do vencimento.
// Como o app só conhece a data de pagamento, a prestação de novembro caía
// em outubro e novembro aparecia com custo zero. `competencia` (AAAA-MM)
// separa "quando saiu o dinheiro" de "a que mês o custo pertence".
function competenceOf(expense) {
  const c = expense && expense.competencia;
  if (c && /^\d{4}-\d{2}$/.test(c)) return c;
  return String((expense && expense.date) || '').slice(0, 7);
}

function expensesInCompetence(expenses, ym) {
  return (expenses || []).filter(e => e && competenceOf(e) === ym);
}

// Despesas que pertencem ao período por competência: cobre o mês fechado e
// também as janelas móveis (últimos 7/30 dias), sempre por mês de competência.
function expensesForPeriod(expenses, period) {
  const list = expenses || [];
  if (period === 'all' || !period) return list;
  const today = getTodayString();
  const ym = today.slice(0, 7);
  if (period === 'month') return expensesInCompetence(list, ym);
  const day = period === 'day' || period === '7' || period === '30' ? Number(period) || (period === 'day' ? 1 : Number(period)) : 30;
  const start = isoAddDays(today, -(day - 1));
  const startYM = start.slice(0, 7);
  return list.filter(e => {
    if (!e) return false;
    const d = String(e.date || '');
    // competência no próprio mês continua valendo para janelas móveis
    const c = competenceOf(e);
    return (d >= start && d <= today) || (c >= startYM && c <= ym);
  });
}


// ==============================================================
// SOBRA REAL (o número que o app nunca mostrou)
// ==============================================================
// `netC` do costPartsForRange é o líquido DENTRO do turno (combustível +
// provisão + despesas variáveis). Falta o custo fixo — prestação, seguro,
// MEI, internet — que existe mesmo parado. Sem ele não há ponto de equilíbrio.
// IMPORTANTE — não somar o custo fixo duas vezes: `parts.netC` já desconta
// as despesas de categoria "fixo" que estão em `expenses` (é o `fixedC`).
// O que esta função faz é DEVOLVER a parcela do custo fixo que não pertence à
// atividade (uso pessoal do carro), conforme o rateio informado pelo usuário.
//   rateio = 100%  → sobra = netC (todo o carro recai sobre a renda)
//   rateio =  90%  → sobra = netC + 10% do fixo (essa parte é pessoal)
function buildSobraReal(parts, opts) {
  const o = opts || {};
  const rateio = o.rateio != null ? o.rateio : getRateioAtividade();
  const fixoNoPeriodoC = parts.fixedC || 0;         // já descontado em netC
  const custoAtividadeC = Math.round(fixoNoPeriodoC * rateio);
  const devolverPessoalC = fixoNoPeriodoC - custoAtividadeC;
  const sobraC = parts.netC + devolverPessoalC;
  const horasTrabalhadas = parts.hours || 0;
  const idleH = (o.idleMinutes || 0) / 60;
  const horasNaRua = horasTrabalhadas + idleH;
  return {
    liquidoTurnoC: parts.netC,          // já após custo fixo integral
    custoFixoTotalC: fixoNoPeriodoC,
    custoAtividadeC: custoAtividadeC,   // parte do fixo que é da atividade
    devolvidoPessoalC: devolverPessoalC,
    sobraC: sobraC,
    margemPct: parts.grossC > 0 ? (sobraC / parts.grossC) * 100 : 0,
    horasTrabalhadas: horasTrabalhadas,
    horasOciosas: idleH,
    horasNaRua: horasNaRua,
    // três leituras: bruto/h, líquido do turno/h, sobra real/h
    brutoPorHoraTrabalhada: horasTrabalhadas > 0 ? (parts.grossC / 100) / horasTrabalhadas : 0,
    brutoPorHoraNaRua: horasNaRua > 0 ? (parts.grossC / 100) / horasNaRua : 0,
    liquidoPorHoraNaRua: horasNaRua > 0 ? (sobraC / 100) / horasNaRua : 0,
    // quanto precisa faturar para empatar, no custo de atividade
    pontoEquilibrioC: custoAtividadeC + parts.shiftFuelC + Math.round((parts.km || 0) * (state.vehicle.maintenanceReservePerKm || 0.18) * 100) + parts.otherOpC,
    coberto: sobraC >= 0
  };
}

// Fração do mês corrente já decorrida (para ratear custo fixo em períodos
// parciais). Ex.: dia 8 → ~0,26. Períodos fechados usam 1.
function currentMonthFraction(todayISO) {
  const t = todayISO || getTodayString();
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  const d = Number(t.slice(8, 10));
  const dim = new Date(y, m, 0).getDate();
  return d / dim;
}


// Pace da meta mensal: projeção, dias restantes e necessário por dia
function buildMonthPaceInfo(grossMonthC, todayStr) {
  const goalC = toC(state.vehicle.monthlyGoal || 7000);
  const parts = todayStr.split('-').map(Number);
  const daysInMonth = new Date(parts[0], parts[1], 0).getDate();
  const dayElapsed = Number(todayStr.slice(8, 10));
  const daysLeft = Math.max(1, daysInMonth - dayElapsed);
  const projC = dayElapsed > 0 ? Math.round(grossMonthC / dayElapsed * daysInMonth) : 0;
  const dailyNeededC = Math.round(Math.max(0, goalC - grossMonthC) / daysLeft);
  const pct = goalC > 0 ? Math.min(999, Math.round(projC / goalC * 100)) : 0;
  return { goalC, daysInMonth, dayElapsed, daysLeft, projC, dailyNeededC, pct, onTrack: projC >= goalC };
}

const DOW_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Estatística por dia da semana: média bruto/dia e R$/h ponderado
function weekdayStats(shifts) {
  const agg = {};
  shifts.forEach(s => {
    if (!s.date || s.date.length !== 10) return;
    const w = new Date(s.date + 'T12:00:00').getDay();
    const a = agg[w] || (agg[w] = { g: 0, h: 0, dates: {} });
    a.g += getShiftTotalGrossC(s);
    a.h += parseFloat(s.hours) || 0;
    a.dates[s.date] = true;
  });
  return Object.entries(agg).map(([w, a]) => {
    const nd = Object.keys(a.dates).length;
    return { wd: Number(w), nDays: nd, grossAvgC: nd > 0 ? Math.round(a.g / nd) : 0,
             rsHCents: a.h > 0 ? Math.round(a.g / a.h) : 0 };
  }).filter(x => x.nDays > 0 && x.rsHCents > 0).sort((x, y) => y.rsHCents - x.rsHCents);
}


// Chips-insight automáticos do Painel (top-3, best-effort, nunca quebram o boot)
function buildAutoInsights() {
  const tips = [];
  try {
    const ws = weekdayStats(state.shifts);
    if (ws.length >= 2 && ws[0].nDays >= 2 && ws[ws.length - 1].rsHCents > 0) {
      const best = ws[0], worst = ws[ws.length - 1];
      const lift = Math.round((best.rsHCents / worst.rsHCents - 1) * 100);
      if (lift >= 10) tips.push(`🗓️ ${DOW_PT[best.wd]} é seu melhor dia (${fmtShortBRL(best.grossAvgC)}/dia, ${lift}% acima de ${DOW_PT[worst.wd]} em R$/h)`);
    }
    const perAgg = {};
    state.shifts.forEach(s => {
      const p = s.period || '?';
      const a = perAgg[p] || (perAgg[p] = { g: 0, h: 0 });
      a.g += getShiftTotalGrossC(s);
      a.h += parseFloat(s.hours) || 0;
    });
    const perArr = Object.entries(perAgg)
      .map(([p, z]) => ({ p, rsh: z.h > 0 ? z.g / z.h : 0 }))
      .filter(x => x.rsh > 0).sort((x, y) => x.rsh - y.rsh);
    const thRate = state.vehicle.targetHourlyRate || 35;
    if (perArr.length >= 2 && perArr[0].rsh < thRate * 0.95) {
      const best = perArr[perArr.length - 1];
      tips.push(`⏰ Turnos de ${String(perArr[0].p).toLowerCase()} rendem ${formatBRL(perArr[0].rsh)}/h — priorize ${String(best.p).toLowerCase()} (${formatBRL(best.rsh)}/h)`);
    }
    const f = state.fuelSettings;
    if (f && f.gasolinePrice > 0 && f.ethanolPrice > 0 && f.gasolineKmPerL > 0 && f.ethanolKmPerL > 0) {
      const gasPerKm = f.gasolinePrice / f.gasolineKmPerL;
      const ethPerKm = f.ethanolPrice / f.ethanolKmPerL;
      if (ethPerKm < gasPerKm) {
        const ds = state.shifts.map(s => s.date).filter(Boolean).sort();
        let span = 30;
        if (ds.length >= 2) span = Math.max(1, (new Date(ds[ds.length - 1]) - new Date(ds[0])) / 86400000 + 1);
        const km30 = (state.shifts.reduce((a, s) => a + (s.km || 0), 0) / span) * 30;
        const savC = Math.round((gasPerKm - ethPerKm) * km30 * 100);
        if (savC > 5000) tips.push(`⛽ Etanol está economizando ~${brlC(savC)}/mês vs gasolina nos seus números`);
      }
    }
  } catch (e) { /* best-effort */ }
  return tips.slice(0, 3);
}
