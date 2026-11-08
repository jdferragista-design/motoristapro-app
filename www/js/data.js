// MotoristaPro — estado, persistência e migração de schema

// Initial State with Parity Calculator Fuel Settings
const defaultData = {
  vehicle: {
    model: 'Chevrolet Onix Plus 1.0 Flex',
    plate: 'BRA-2E19',
    odometer: 64850,
    maintenanceReservePerKm: 0.18,
    monthlyGoal: 7000,
    targetKmRate: 2.20,
    targetHourlyRate: 35.00
  },
  fuelSettings: {
    gasolinePrice: 5.89,
    gasolineKmPerL: 11.5,
    ethanolPrice: 3.89,
    ethanolKmPerL: 8.2
  },
  shifts: [
    {
      id: 1,
      date: '2026-08-19',
      period: 'Integral',
      apps: [
        { id: 'uber_1', appKey: 'uber', name: '🚗 Uber', gross: 285.50, trips: 14, tips: 15.00, badgeClass: 'badge-uber' },
        { id: 'pop_1', appKey: 'pop', name: '🚕 99Pop', gross: 110.00, trips: 6, tips: 5.00, badgeClass: 'badge-99' }
      ],
      km: 168.4,
      hours: 9.0,
      timeStart: '07:00',
      timeEnd: '16:00',
      fuelCost: 79.88,
      fuelTypeUsed: 'Etanol',
      notes: 'Manhã no centro e tarde com dinâmico 99'
    },
    {
      id: 2,
      date: '2026-08-18',
      period: 'Integral',
      apps: [
        { id: 'uber_2', appKey: 'uber', name: '🚗 Uber', gross: 340.00, trips: 16, tips: 20.00, badgeClass: 'badge-uber' },
        { id: 'part_2', appKey: 'part', name: '⭐ Particulares', gross: 90.00, trips: 1, tips: 0, badgeClass: 'badge-part' }
      ],
      km: 180.0,
      hours: 9.2,
      timeStart: '07:30',
      timeEnd: '16:45',
      fuelCost: 85.39,
      fuelTypeUsed: 'Etanol',
      notes: 'Chuva fim de tarde + corrida particular'
    },
    {
      id: 3,
      date: '2026-08-17',
      period: 'Integral',
      apps: [
        { id: 'uber_3', appKey: 'uber', name: '🚗 Uber', gross: 295.00, trips: 13, tips: 10.00, badgeClass: 'badge-uber' },
        { id: 'pop_3', appKey: 'pop', name: '🚕 99Pop / 99', gross: 75.00, trips: 4, tips: 0, badgeClass: 'badge-99' }
      ],
      km: 165.0,
      hours: 9.0,
      timeStart: '08:00',
      timeEnd: '17:00',
      fuelCost: 78.27,
      fuelTypeUsed: 'Etanol',
      notes: 'Corridas de bairro'
    },
    {
      id: 4,
      date: '2026-08-16',
      period: 'Tarde/Noite',
      apps: [
        { id: 'indrive_4', appKey: 'indrive', name: '🚙 InDrive', gross: 165.00, trips: 6, tips: 10.00, badgeClass: 'badge-indrive' }
      ],
      km: 68.0,
      hours: 3.5,
      timeStart: '16:00',
      timeEnd: '19:30',
      fuelCost: 32.26,
      fuelTypeUsed: 'Etanol',
      notes: 'Focado em InDrive com ótima margem'
    },
    {
      id: 5,
      date: '2026-08-15',
      period: 'Integral',
      apps: [
        { id: 'uber_5', appKey: 'uber', name: '🚗 Uber', gross: 410.00, trips: 18, tips: 30.00, badgeClass: 'badge-uber' }
      ],
      km: 175.0,
      hours: 9.5,
      timeStart: '08:00',
      timeEnd: '17:30',
      fuelCost: 83.02,
      fuelTypeUsed: 'Etanol',
      notes: 'Sexta-feira movimentada'
    }
  ],
  expenses: [
    { id: 1, date: '2026-08-19', category: 'combustivel', fuelType: 'Gasolina', title: 'Abastecimento Gasolina Comum', amount: 175.50, liters: 30.0, pricePerLiter: 5.85, odo: 64800 },
    { id: 2, date: '2026-08-19', category: 'alimentacao', title: 'Almoço e café na rua', amount: 28.50 },
    { id: 3, date: '2026-08-17', category: 'lavagem', title: 'Lavagem completa + cera', amount: 45.00 },
    { id: 4, date: '2026-08-16', category: 'combustivel', fuelType: 'Etanol', title: 'Abastecimento Etanol', amount: 145.00, liters: 38.0, pricePerLiter: 3.82, odo: 64450 },
    { id: 5, date: '2026-08-10', category: 'manutencao', title: 'Alinhamento 3D + Balanceamento', amount: 110.00, odo: 63900 },
    { id: 6, date: '2026-08-05', category: 'fixo', title: 'Seguro Auto Especial App', amount: 210.00 }
  ],
  maintenance: [
    { id: 1, name: 'Troca de Óleo e Filtro (5W30)', lastKm: 60000, interval: 10000, cost: 220 },
    { id: 2, name: 'Pastilhas de Freio Dianteiras', lastKm: 45000, interval: 20000, cost: 180 },
    { id: 3, name: 'Rodízio de Pneus e Alinhamento', lastKm: 55000, interval: 10000, cost: 110 },
    { id: 4, name: 'Filtro de Ar e Cabine (A/C)', lastKm: 50000, interval: 15000, cost: 95 }
  ]
};


let state = JSON.parse(JSON.stringify(defaultData));


// Staging and Edit Tracking State
let stagedShiftApps = [];

let editingShiftId = null;

let editingExpenseId = null;

let editingMaintId = null;

let deferredPWAEvent = null;

// Item de despesa fixa em edição (null = criando)
let editingRecurringId = null;

logEvent('info', 'Estado inicial do app carregado', { version: APP_VERSION });

function saveState() {
  // localStorage pode falhar por quota (≈5 MB) ou modo privado. Sem este
  // try/catch a exceção sobe, o render() não acontece e a alteração é perdida
  // em silêncio — o pior desfecho possível para um app financeiro.
  let persistError = null;
  try {
    localStorage.setItem('mp_html_state_v8', JSON.stringify(state));
  } catch (e) {
    persistError = e;
    logEvent('error', 'Falha ao gravar no armazenamento local', {
      message: e && e.message, bytes: (() => { try { return JSON.stringify(state).length; } catch (_) { return null; } })()
    });
  }
  render();
  if (persistError) {
    mpNotify('⚠️ Não foi possível salvar no aparelho (armazenamento cheio). Exporte um backup agora.', 'error');
  }
  if (typeof scheduleCloudSync === 'function') scheduleCloudSync();
}


// Validação/migração de schema: garante que restauros e loads antigos
// nunca quebrem o app por campos faltando
function migrateState(s) {
  const base = JSON.parse(JSON.stringify(defaultData));
  const vehicle = Object.assign({}, base.vehicle, (s && s.vehicle) || {});
  if (!(s && s.vehicle && Object.prototype.hasOwnProperty.call(s.vehicle, 'manualOdometerBase'))) {
    vehicle.manualOdometerBase = vehicle.odometer || 0;
  }
  const expenses = Array.isArray(s && s.expenses) ? s.expenses : [];
  // Default retroativo das despesas antigas (não muda números históricos):
  // sem `recorrenteId` são avulsas; a competência é a própria data.
  expenses.forEach(e => {
    if (!e) return;
    if (e.recorrenteId === undefined) e.recorrenteId = null;
    if (!e.competencia) e.competencia = String(e.date || '').slice(0, 7);
  });
  return {
    vehicle,
    fuelSettings: Object.assign({}, base.fuelSettings, (s && s.fuelSettings) || {}),
    shifts: Array.isArray(s && s.shifts) ? s.shifts : [],
    expenses,
    maintenance: Array.isArray(s && s.maintenance) ? s.maintenance : [],
    recurring: normalizeRecurring(s && s.recurring)
  };
}


// ---------- Despesas recorrentes (custo fixo mensal) ----------
// O utilizador real esquece de lançar o que se repete: nos dados de referência
// (3,3 meses, 199 turnos) "gol proteção" apareceu 1×, internet 1× e MEI 2× —
// R$ 609,14/mês fora do histórico. Recorrentes resolvem isso na origem.
const PERIODICIDADE_LABELS = {
  mensal: 'Mensal',
  bimestral: 'Bimestral',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual'
};

const PERIODICIDADE_MESES = {
  mensal: 1,
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
  anual: 12
};

function normalizeRecurring(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(r => r && r.id != null).map(r => ({
    id: r.id,
    nome: String(r.nome || 'Despesa fixa'),
    valor: parseVal(r.valor),
    categoria: r.categoria || 'fixo',
    periodicidade: PERIODICIDADE_MESES[r.periodicidade] ? r.periodicidade : 'mensal',
    diaVencimento: Math.min(31, Math.max(1, parseInt(r.diaVencimento, 10) || 5)),
    competenciaInicio: r.competenciaInicio || getTodayString().slice(0, 7),
    ativo: r.ativo !== false
  }));
}

function getRecurring(id) {
  return (state.recurring || []).find(r => r.id === id) || null;
}

// Meses de competência esperados para uma recorrente, de competenciaInicio
// até o mês limite (`ateYM`, inclusive). Não gera o que ainda não venceu
// em relação a hoje: se o vencimento do mês corrente ainda não passou, esse
// mês não entra (evita deduzir despesa futura do resultado).
function recurringDueMonths(r, ateYM) {
  const step = PERIODICIDADE_MESES[r.periodicidade] || 1;
  const start = String(r.competenciaInicio || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start)) return [];
  const limit = ateYM || getTodayString().slice(0, 7);
  const [sy, sm] = start.split('-').map(Number);
  const [ly, lm] = limit.split('-').map(Number);
  const startAbs = sy * 12 + (sm - 1);
  const limitAbs = ly * 12 + (lm - 1);
  const today = getTodayString();
  const todayDay = Number(today.slice(8, 10));
  const out = [];
  for (let abs = startAbs; abs <= limitAbs; abs += step) {
    const y = Math.floor(abs / 12);
    const m = (abs % 12) + 1;
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    // o mês de início conta como já lançado/assumido
    if (abs === startAbs) { out.push(ym); continue; }
    // mês corrente: só conta se o vencimento já passou
    if (ym === today.slice(0, 7) && todayDay < r.diaVencimento) continue;
    out.push(ym);
  }
  return out;
}

// Normaliza um título para comparação: sem acento, sem caixa, sem pontuação.
function normalizeTitleForMatch(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Um lançamento já existente corresponde a esta despesa fixa naquele mês?
// Comparação por sobreposição de palavras, para casar o histórico que o
// usuário digitou à mão ("Prestação do carro parcela 12/60 desconto 24.59",
// "MEi") com a recorrência cadastrada ("Prestação do carro", "MEI / DAS").
function expenseMatchesRecurring(expense, rec) {
  if (!expense || !rec) return false;
  if (expense.recorrenteId != null) return expense.recorrenteId === rec.id;
  if ((expense.category || '') !== (rec.categoria || '')) return false;
  const a = normalizeTitleForMatch(expense.title);
  const b = normalizeTitleForMatch(rec.nome);
  if (!a.length || !b.length) return false;
  const setB = new Set(b);
  const common = a.filter(t => setB.has(t)).length;
  const ratio = common / Math.min(a.length, b.length);
  return ratio >= 0.5;
}

// Concilia recorrentes × despesas já lançadas.
//  1. Casa o histórico existente com a recorrência (vincula, não duplica);
//  2. Só cria lançamento para meses que realmente não têm nada.
// Assim cadastrar "Prestação do carro" não duplica as 3 parcelas que o
// usuário já tinha digitado à mão.
function syncRecurringExpenses() {
  if (!Array.isArray(state.recurring) || state.recurring.length === 0) return 0;
  let created = 0;
  let linked = 0;
  state.recurring.forEach(r => {
    if (!r || r.ativo === false || !(r.valor > 0)) return;
    recurringDueMonths(r).forEach(ym => {
      const inMonth = state.expenses.filter(e =>
        e && e.competencia === ym && (e.category || '') === (r.categoria || ''));
      const alreadyLinked = inMonth.some(e => e.recorrenteId === r.id);
      if (alreadyLinked) return;

      const match = inMonth.find(e => expenseMatchesRecurring(e, r));
      if (match) {
        match.recorrenteId = r.id;
        linked++;
        return;
      }

      const [y, m] = ym.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const day = Math.min(r.diaVencimento, lastDay);
      state.expenses.push({
        id: uid(),
        date: `${ym}-${String(day).padStart(2, '0')}`,
        competencia: ym,
        category: r.categoria,
        title: r.nome,
        amount: r.valor,
        recorrenteId: r.id
      });
      created++;
    });
  });
  if (created || linked) {
    logEvent('info', 'Recorrentes conciliadas', { criadas: created, vinculadas: linked });
  }
  return created;
}

function saveRecurring(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  const id = editingRecurringId;
  const payload = {
    nome: document.getElementById('recNameInput').value.trim(),
    valor: parseVal(document.getElementById('recValueInput').value),
    categoria: document.getElementById('recCatSelect').value,
    periodicidade: document.getElementById('recPeriodSelect').value,
    diaVencimento: parseInt(document.getElementById('recDayInput').value, 10) || 5,
    competenciaInicio: document.getElementById('recStartInput').value || getTodayString().slice(0, 7)
  };
  if (!payload.nome) { mpNotify('Informe o nome da despesa fixa.', 'error'); return; }
  if (!(payload.valor > 0)) { mpNotify('Informe o valor da despesa fixa.', 'error'); return; }

  if (id) {
    const cur = getRecurring(id);
    if (cur) Object.assign(cur, payload);
  } else {
    state.recurring = state.recurring || [];
    state.recurring.push(Object.assign({ id: uid(), ativo: true }, payload));
  }
  editingRecurringId = null;
  syncRecurringExpenses();
  saveState();
  closeModal('modalRecurring');
}

function deleteRecurring(id) {
  if (!confirm('Remover esta despesa fixa? As despesas já lançadas por ela serão mantidas.')) return;
  state.recurring = (state.recurring || []).filter(r => r.id !== id);
  saveState();
}

function toggleRecurring(id) {
  const r = getRecurring(id);
  if (!r) return;
  r.ativo = !r.ativo;
  if (r.ativo) syncRecurringExpenses();
  saveState();
}

function openCreateRecurringModal() {
  editingRecurringId = null;
  document.getElementById('modalRecurringTitle').innerText = 'Nova Despesa Fixa';
  document.getElementById('recNameInput').value = '';
  document.getElementById('recValueInput').value = '';
  document.getElementById('recCatSelect').value = 'fixo';
  document.getElementById('recPeriodSelect').value = 'mensal';
  document.getElementById('recDayInput').value = '5';
  document.getElementById('recStartInput').value = getTodayString().slice(0, 7);
  openModal('modalRecurring');
}

function openEditRecurringModal(id) {
  const r = getRecurring(id);
  if (!r) return;
  editingRecurringId = id;
  document.getElementById('modalRecurringTitle').innerText = 'Editar Despesa Fixa';
  document.getElementById('recNameInput').value = r.nome;
  document.getElementById('recValueInput').value = fmt2(r.valor);
  document.getElementById('recCatSelect').value = r.categoria;
  document.getElementById('recPeriodSelect').value = r.periodicidade;
  document.getElementById('recDayInput').value = r.diaVencimento;
  document.getElementById('recStartInput').value = r.competenciaInicio;
  openModal('modalRecurring');
}


// ---------- Custo fixo mensal & rateio pessoal × atividade ----------
// `custoFixoMensal` = soma das recorrentes ativas normalizadas para mês
// (bimestral /2, anual /12). É o número que faltava para existir ponto de
// equilíbrio: sem ele o app só sabe faturamento.
function getCustoFixoMensal() {
  const list = state.recurring || [];
  return list.filter(r => r && r.ativo !== false).reduce((acc, r) => {
    const meses = PERIODICIDADE_MESES[r.periodicidade] || 1;
    return acc + (parseVal(r.valor) / meses);
  }, 0);
}

// Percentual do veículo atribuído à atividade (85% a 95% no caso real).
// Sem este rateio, todo o financiamento recai sobre a renda e o resultado
// aparece 43% menor do que é.
function getRateioAtividade() {
  const v = state.vehicle || {};
  const pct = Number(v.rateioAtividade);
  if (!(pct > 0)) return 1;
  return Math.min(1, Math.max(0.1, pct));
}
