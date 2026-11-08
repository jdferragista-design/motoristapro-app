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
        { id: 'pop_3', appKey: 'pop', name: '🚕 99Pop', gross: 75.00, trips: 4, tips: 0, badgeClass: 'badge-99' }
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
// Compra parcelada em edição (null = criando)
let editingInstallmentId = null;

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
    if (e.parcelaId === undefined) e.parcelaId = null;
    if (!e.competencia) e.competencia = String(e.date || '').slice(0, 7);
  });
  // Nomes de app: unifica variações que partiram o histórico.
  // Dados reais: '99Pop' 96x e '99Pop / 99' 1x → o relatório mostrava dois
  // apps e o ticket médio da 99 ficava errado. A chave de agrupamento em
  // appBreakdown() é o nome, então normalizar aqui conserta todo o passado.
  // A chave é comparada sem emoji/símbolos: o nome real é "🚕 99Pop / 99"
  // e comparar a string inteira nunca casava (o emoji entrava na chave).
  const APP_NAME_ALIASES = { '99pop / 99': '🚕 99Pop', '99pop': '🚕 99Pop', '99': '🚕 99Pop' };
  const appKey = raw => String(raw || '')
    .replace(/[^\p{L}\p{N}\s/]/gu, '')   // remove emoji e símbolos, mantém letras/números/barra
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const canonApp = raw => {
    if (!raw) return raw;
    return APP_NAME_ALIASES[appKey(raw)] || raw;
  };
  const shifts = Array.isArray(s && s.shifts) ? s.shifts : [];
  shifts.forEach(sh => {
    if (!sh) return;
    const apps = Array.isArray(sh.apps) ? sh.apps
      : (sh.apps && typeof sh.apps === 'object' ? Object.values(sh.apps) : []);
    apps.forEach(a => { if (a && a.name) a.name = canonApp(a.name); });
  });

  return {
    vehicle,
    fuelSettings: Object.assign({}, base.fuelSettings, (s && s.fuelSettings) || {}),
    shifts,
    expenses,
    maintenance: Array.isArray(s && s.maintenance) ? s.maintenance : [],
    recurring: normalizeRecurring(s && s.recurring),
    installments: normalizeInstallments(s && s.installments)
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
  updateRecurringPreview();
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

// ============================================================
// DESPESAS PARCELADAS (compra no carnê / cartão)
// ============================================================
// O usuário lança o valor TOTAL e o número de parcelas; o app cria uma
// despesa por mês de competência. É o mesmo dinheiro da parcela do carro
// e dos pneus, mas agora sem digitar 10 vezes.

function normalizeInstallments(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(p => p && p.id != null).map(p => ({
    id: p.id,
    nome: String(p.nome || 'Compra parcelada'),
    valorTotal: parseVal(p.valorTotal),
    numParcelas: Math.max(1, parseInt(p.numParcelas, 10) || 1),
    categoria: p.categoria || 'manutencao',
    competenciaInicio: p.competenciaInicio || getTodayString().slice(0, 7),
    diaVencimento: Math.min(31, Math.max(1, parseInt(p.diaVencimento, 10) || 10)),
    ativo: p.ativo !== false
  }));
}

function getInstallment(id) {
  return (state.installments || []).find(p => p.id === id) || null;
}

// Valor de UMA parcela. O total é dividido e a sobra de centavos vai para a
// primeira parcela, para que a soma bata exatamente com o valor pago.
function parcelaCents(valorTotal, numParcelas) {
  const totalC = toC(valorTotal);
  const n = Math.max(1, numParcelas);
  return Math.floor(totalC / n);
}

function installmentAmountC(p, numeroParcela) {
  const n = Math.max(1, p.numParcelas);
  const base = parcelaCents(p.valorTotal, n);
  if (numeroParcela === 1) {
    return base + (toC(p.valorTotal) - base * n); // absorve a diferença de centavos
  }
  return base;
}

// A compra já terminou de ser paga?
function installmentFinished(p) {
  if (!p || p.ativo === false) return true;
  const today = getTodayString().slice(0, 7);
  const [sy, sm] = String(p.competenciaInicio).split('-').map(Number);
  const lastAbs = sy * 12 + (sm - 1) + (Math.max(1, p.numParcelas) - 1);
  const lastYM = `${Math.floor(lastAbs / 12)}-${String((lastAbs % 12) + 1).padStart(2, '0')}`;
  return today > lastYM;
}

// Materializa as parcelas que já venceram e ainda não existem.
// Idempotente: cada parcela é marcada com parcelaId + parcelaNumero.
// Uma despesa já digitada à mão corresponde a esta parcela?
// Casa por mês de competência + valor aproximado + palavra em comum no título,
// para que lançar "Pneus 2.828,17 em 10x" NÃO duplique as parcelas de 282,82
// que o usuário já tinha lançado uma a uma.
function expenseMatchesInstallment(expense, p, numero) {
  if (!expense || !p) return false;
  if (expense.parcelaId != null) return false;
  if ((expense.category || '') !== (p.categoria || '')) return false;
  const alvoC = installmentAmountC(p, numero);
  const valorC = toC(expense.amount);
  // tolerância de 2% — cobre arredondamento e pequena variação de parcela
  if (Math.abs(valorC - alvoC) > Math.max(100, alvoC * 0.02)) return false;
  const a = normalizeTitleForMatch(expense.title);
  const b = normalizeTitleForMatch(p.nome);
  if (!a.length || !b.length) return false;
  const setB = new Set(b);
  return a.some(t => setB.has(t));
}

function syncInstallmentExpenses() {
  if (!Array.isArray(state.installments) || state.installments.length === 0) return 0;
  let created = 0;
  let linked = 0;
  const today = getTodayString();
  const todayYM = today.slice(0, 7);
  const todayDay = Number(today.slice(8, 10));

  state.installments.forEach(p => {
    if (!p || p.ativo === false || !(p.valorTotal > 0)) return;
    const [sy, sm] = String(p.competenciaInicio || '').split('-').map(Number);
    if (!sy || !sm) return;

    for (let i = 0; i < p.numParcelas; i++) {
      const abs = sy * 12 + (sm - 1) + i;
      const ym = `${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, '0')}`;
      if (ym > todayYM) break; // ainda não chegou o mês
      if (state.expenses.some(e => e && e.parcelaId === p.id && e.parcelaNumero === i + 1)) continue;
      // reconciliação: vincula o que já foi lançado à mão em vez de duplicar
      const jaLancado = state.expenses.find(e =>
        e && e.competencia === ym && expenseMatchesInstallment(e, p, i + 1));
      if (jaLancado) {
        jaLancado.parcelaId = p.id;
        jaLancado.parcelaNumero = i + 1;
        linked++;
        continue;
      }
      // mês corrente: só lança depois do vencimento
      if (ym === todayYM && todayDay < p.diaVencimento) continue;

      const lastDay = new Date(Math.floor(abs / 12), (abs % 12) + 1, 0).getDate();
      const day = Math.min(p.diaVencimento, lastDay);
      const valorC = installmentAmountC(p, i + 1);
      state.expenses.push({
        id: uid(),
        date: `${ym}-${String(day).padStart(2, '0')}`,
        competencia: ym,
        category: p.categoria,
        title: `${p.nome} ${i + 1}/${p.numParcelas}`,
        amount: valorC / 100,
        parcelaId: p.id,
        parcelaNumero: i + 1
      });
      created++;
    }
  });
  if (created || linked) {
    logEvent('info', 'Parcelas conciliadas', { criadas: created, vinculadas: linked });
  }
  return created;
}

// Quanto ainda falta pagar desta compra (parcelas futuras).
function installmentRemainingC(p) {
  const pagas = (state.expenses || []).filter(e => e && e.parcelaId === p.id).length;
  const restantes = Math.max(0, p.numParcelas - pagas);
  return installmentAmountC(p, p.numParcelas) * restantes;
}

function saveInstallment(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  const payload = {
    nome: document.getElementById('parNameInput').value.trim(),
    valorTotal: parseVal(document.getElementById('parTotalInput').value),
    numParcelas: parseInt(document.getElementById('parCountInput').value, 10) || 1,
    categoria: document.getElementById('parCatSelect').value,
    competenciaInicio: document.getElementById('parStartInput').value || getTodayString().slice(0, 7),
    diaVencimento: parseInt(document.getElementById('parDayInput').value, 10) || 10
  };
  if (!saveInstallmentFromValues(payload)) return;
  editingInstallmentId = null;
  saveState();
  closeModal('modalInstallment');
}

// Lógica pura (sem DOM) — validável em teste. Devolve true se gravou.
function saveInstallmentFromValues(payload) {
  if (!payload.nome || !(payload.valorTotal > 0)) {
    alert('Informe o nome e o valor total da compra.');
    return false;
  }
  if (payload.numParcelas < 1 || payload.numParcelas > 60) {
    alert('O número de parcelas deve ficar entre 1 e 60.');
    return false;
  }
  const id = editingInstallmentId;
  const colisao = findNameCollision(payload.nome, id != null ? { tipo: 'installment', id } : null);
  if (colisao) {
    alert(`"${payload.nome}" já está cadastrada como ${colisao.tipo === 'recurring' ? 'despesa fixa' : 'outra compra parcelada'}.\n\n` +
      'A mesma despesa nos dois lugares seria contada duas vezes. ' +
      'Se for uma prestação que termina, cadastre só como compra parcelada.');
    return false;
  }

  if (id != null) {
    const cur = getInstallment(id);
    Object.assign(cur, payload);
    // parcelas futuras que já existiam precisam refletir o novo valor
    (state.expenses || []).forEach(exp => {
      if (exp.parcelaId === id) {
        exp.amount = installmentAmountC(cur, exp.parcelaNumero) / 100;
        exp.title = `${cur.nome} ${exp.parcelaNumero}/${cur.numParcelas}`;
        exp.category = cur.categoria;
      }
    });
  } else {
    state.installments = state.installments || [];
    state.installments.push(Object.assign({ id: uid(), ativo: true }, payload));
  }

  editingInstallmentId = null;
  syncInstallmentExpenses();
  return true;
}

function deleteInstallment(id) {
  if (!confirm('Excluir esta compra parcelada e os lançamentos que ela criou?')) return;
  state.installments = (state.installments || []).filter(p => p.id !== id);
  state.expenses = (state.expenses || []).filter(e => e.parcelaId !== id);
  saveState();
}

function toggleInstallment(id) {
  const p = getInstallment(id);
  if (!p) return;
  p.ativo = p.ativo === false;
  if (p.ativo) syncInstallmentExpenses();
  saveState();
}

function openCreateInstallmentModal() {
  editingInstallmentId = null;
  document.getElementById('modalInstallmentTitle').innerText = 'Nova Compra Parcelada';
  document.getElementById('parNameInput').value = '';
  document.getElementById('parTotalInput').value = '';
  document.getElementById('parCountInput').value = '10';
  document.getElementById('parCatSelect').value = 'manutencao';
  document.getElementById('parStartInput').value = getTodayString().slice(0, 7);
  document.getElementById('parDayInput').value = '10';
  updateInstallmentPreview();
  openModal('modalInstallment');
}

function openEditInstallmentModal(id) {
  const p = getInstallment(id);
  if (!p) return;
  editingInstallmentId = id;
  document.getElementById('modalInstallmentTitle').innerText = 'Editar Compra Parcelada';
  document.getElementById('parNameInput').value = p.nome;
  document.getElementById('parTotalInput').value = String(p.valorTotal).replace('.', ',');
  document.getElementById('parCountInput').value = String(p.numParcelas);
  document.getElementById('parCatSelect').value = p.categoria;
  document.getElementById('parStartInput').value = p.competenciaInicio;
  document.getElementById('parDayInput').value = String(p.diaVencimento);
  updateInstallmentPreview();
  openModal('modalInstallment');
}

// Mostra "10x de R$ 282,82" antes de salvar — evita o usuário descobrir
// o valor da parcela só depois de lançar.
function updateInstallmentPreview() {
  const box = document.getElementById('parPreviewBox');
  if (!box) return;
  const total = parseVal(document.getElementById('parTotalInput').value);
  const n = Math.max(1, parseInt(document.getElementById('parCountInput').value, 10) || 1);
  if (!(total > 0)) {
    box.innerHTML = '<span style="color:var(--text-muted);">Digite o valor total para ver a parcela.</span>';
    return;
  }
  const baseC = parcelaCents(total, n);
  const restoC = toC(total) - baseC * n;
  box.innerHTML =
    `<strong style="color:#fff;font-size:14px;">${n}x de ${brlC(baseC)}</strong>` +
    (restoC > 0 ? ` <span style="color:var(--text-muted);">(1ª de ${brlC(baseC + restoC)})</span>` : '') +
    ` <span style="color:var(--text-muted);">• total ${brlC(toC(total))}</span>`;
}

// ============================================================
// MODELOS PRÉ-CADASTRADOS DE DESPESA FIXA
// ============================================================
// Os 4 primeiros são exatamente as despesas fixas reais do usuário
// (aferidas no backup de 08/11/2026): prestação, gol proteção, internet
// bimestral e MEI. Os demais são os que faltam no histórico e costumam
// ser esquecidos. Um toque cadastra; o valor fica editável.
//
// NÃO há modelo de "reserva de manutenção": o fundo de reserva por R$/km
// já provisiona o desgaste. Somar os dois contaria o mesmo desgaste 2x —
// exatamente o erro corrigido no P0 (provisão R$ 1.712 + manutenção real
// R$ 1.924 para o mesmo desgaste).
const RECURRING_PRESETS = [
  { key: 'prestacao', nome: 'Prestação do carro', valor: 3147.57, categoria: 'fixo',           periodicidade: 'mensal',   diaVencimento: 5,  nota: 'parcela do financiamento' },
  { key: 'gol',       nome: 'Gol Proteção',        valor: 459.23,  categoria: 'fixo',           periodicidade: 'mensal',   diaVencimento: 10, nota: 'seguro do veículo' },
  { key: 'internet',  nome: 'Internet',            valor: 123.71,  categoria: 'fixo',           periodicidade: 'bimestral',diaVencimento: 21, nota: 'vem a cada 2 meses' },
  { key: 'mei',       nome: 'MEI / DAS',           valor: 88.06,   categoria: 'fixo',           periodicidade: 'mensal',   diaVencimento: 20, nota: 'guia mensal' },
  { key: 'celular',   nome: 'Celular / Dados',     valor: 79.90,   categoria: 'fixo',           periodicidade: 'mensal',   diaVencimento: 15, nota: '' },
  { key: 'ipva',      nome: 'IPVA + Licenciamento',valor: 1480.00, categoria: 'fixo',           periodicidade: 'anual',    diaVencimento: 10, nota: 'pago 1x por ano' }
];

function getRecurringPreset(key) {
  return RECURRING_PRESETS.find(p => p.key === key) || null;
}

function isPresetAdded(key) {
  const p = getRecurringPreset(key);
  if (!p) return false;
  return (state.recurring || []).some(r =>
    normalizeTitleForMatch(r.nome).join(' ') === normalizeTitleForMatch(p.nome).join(' '));
}

// Cadastra o modelo já com os valores reais. A competência inicial é o mês
// corrente: o histórico anterior continua sendo o que o usuário digitou.

// A mesma despesa não pode existir como FIXA e como PARCELADA ao mesmo tempo —
// era exatamente a dupla contagem que o diagnóstico apontou como erro caro.
// Retorna o que já existe com nome equivalente ('recurring' | 'installment' | null).
function findNameCollision(nome, ignorar) {
  const alvo = normalizeTitleForMatch(nome).join(' ');
  if (!alvo) return null;
  const match = (outro, tipo, id) => {
    if (ignorar && ignorar.tipo === tipo && ignorar.id === id) return false;
    const n = normalizeTitleForMatch(outro.nome).join(' ');
    if (!n) return false;
    // igual, ou um contém o outro ("Prestação" x "Prestação do carro")
    return n === alvo || n.includes(alvo) || alvo.includes(n);
  };
  const rec = (state.recurring || []).find(r => match(r, 'recurring', r.id));
  if (rec) return { tipo: 'recurring', item: rec };
  const par = (state.installments || []).find(p => match(p, 'installment', p.id));
  if (par) return { tipo: 'installment', item: par };
  return null;
}

function addRecurringPreset(key) {
  const p = getRecurringPreset(key);
  if (!p || isPresetAdded(key)) return false;
  const col = findNameCollision(p.nome);
  if (col) {
    alert(`"${p.nome}" já está cadastrada como ${col.tipo === 'recurring' ? 'despesa fixa' : 'compra parcelada'}.\n\n` +
      'Cadastrar nos dois lugares contaria o mesmo gasto duas vezes. ' +
      'Exclua de um dos lados antes de adicionar aqui.');
    return false;
  }
  state.recurring = state.recurring || [];
  state.recurring.push({
    id: uid(),
    nome: p.nome,
    valor: p.valor,
    categoria: p.categoria,
    periodicidade: p.periodicidade,
    diaVencimento: p.diaVencimento,
    competenciaInicio: getTodayString().slice(0, 7),
    ativo: true
  });
  syncRecurringExpenses();
  saveState();
  return true;
}

// Remove os lançamentos que a recorrência/parcelamento criou e cuja origem
// foi apagada — sem isso eles viram fantasmas no histórico.
function pruneOrphanGeneratedExpenses() {
  const antes = (state.expenses || []).length;
  const recIds = new Set((state.recurring || []).map(r => r.id));
  const parIds = new Set((state.installments || []).map(p => p.id));
  state.expenses = (state.expenses || []).filter(e => {
    if (!e) return false;
    if (e.recorrenteId != null && !recIds.has(e.recorrenteId)) return false;
    if (e.parcelaId != null && !parIds.has(e.parcelaId)) return false;
    return true;
  });
  return antes - state.expenses.length;
}

// Prévia do custo mensal no modal de despesa fixa — mostra "R$ 123,71 bimestral
// = R$ 61,86/mês" antes de salvar, porque é o número que entra na sobra real.
function updateRecurringPreview() {
  const box = document.getElementById('recPreviewBox');
  if (!box) return;
  const valor = parseVal(document.getElementById('recValueInput').value);
  const per = document.getElementById('recPeriodSelect').value;
  const meses = PERIODICIDADE_MESES[per] || 1;
  if (!(valor > 0)) {
    box.innerHTML = '<span style="color:var(--text-muted);">Digite o valor para ver o custo mensal.</span>';
    return;
  }
  const mensalC = Math.round(toC(valor) / meses);
  box.innerHTML = meses > 1
    ? `<strong style="color:#fff;">${brlC(toC(valor))} ${PERIODICIDADE_LABELS[per].toLowerCase()}</strong> = <strong style="color:#fbbf24;">${brlC(mensalC)}/mês</strong> no custo fixo`
    : `<strong style="color:#fff;">${brlC(toC(valor))}/mês</strong> no custo fixo`;
}
