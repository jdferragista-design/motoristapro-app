// MotoristaPro — utilitários puros (parse, moeda em centavos, escape, datas, ids)


function parseVal(val) {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const clean = val.toString().replace(',', '.').trim();
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}


// ---------- Precisão monetária: TODA aritmética em centavos (inteiros) ----------
// Fronteira de entrada: float -> centavos arredondados (elimina 0.1+0.2=0.30000...4)
function toC(v) {
  const n = typeof v === 'number' ? v : parseVal(v);
  return Math.round((isNaN(n) ? 0 : n) * 100) || 0;
}

// Formata centavos (int) -> "R$ x,xx" (único ponto de formatação)
function brlC(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

const APP_VERSION = 'v1.18.1';
const LOG_STORAGE_KEY = 'mp_html_logs_v1';
const LOG_LIMIT = 400;

let appLogs = [];
try {
  appLogs = JSON.parse(localStorage.getItem(LOG_STORAGE_KEY) || '[]');
  if (!Array.isArray(appLogs)) appLogs = [];
} catch (e) {
  appLogs = [];
}

function normalizeLogData(data) {
  if (data === undefined) return undefined;
  if (data instanceof Error) {
    return { message: data.message, stack: data.stack };
  }
  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean' || data === null) {
    return data;
  }
  try {
    return JSON.parse(JSON.stringify(data));
  } catch (e) {
    return String(data);
  }
}

function logEvent(level, message, data) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    data: normalizeLogData(data)
  };
  appLogs.push(entry);
  if (appLogs.length > LOG_LIMIT) appLogs = appLogs.slice(-LOG_LIMIT);
  try {
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(appLogs));
  } catch (e) {}
  return entry;
}

function getAppLogs() {
  return appLogs.slice();
}

function buildAppLogsText() {
  const platform = window.Capacitor && typeof window.Capacitor.getPlatform === 'function'
    ? window.Capacitor.getPlatform()
    : 'web';
  const stateSummary = typeof state !== 'undefined'
    ? {
        shifts: (state.shifts || []).length,
        expenses: (state.expenses || []).length,
        maintenance: (state.maintenance || []).length,
        vehicle: state.vehicle || null
      }
    : null;

  const lines = [
    `MotoristaPro ${APP_VERSION}`,
    `Gerado em: ${new Date().toISOString()}`,
    `Plataforma: ${platform}`,
    stateSummary ? `Resumo de estado: ${JSON.stringify(stateSummary)}` : 'Resumo de estado: indisponível',
    '--- LOGS ---'
  ];

  getAppLogs().forEach(entry => {
    const data = entry.data !== undefined ? ` | ${JSON.stringify(entry.data)}` : '';
    lines.push(`[${entry.ts}] ${entry.level.toUpperCase()} - ${entry.message}${data}`);
  });

  return lines.join('\n');
}

function formatBRL(val) { return brlC(toC(val)); }

function setSignedValueClass(elOrId, numericValue) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el || !el.classList) return;
  el.classList.remove('val-emerald', 'val-rose');
  el.classList.add(numericValue < 0 ? 'val-rose' : 'val-emerald');
}

function setSignedBadgeState(elOrId, numericValue) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el) return;
  if (numericValue < 0) {
    el.style.background = 'rgba(244, 63, 94, 0.15)';
    el.style.color = '#fb7185';
    el.style.borderColor = 'rgba(244, 63, 94, 0.3)';
  } else {
    el.style.background = 'rgba(16, 185, 129, 0.15)';
    el.style.color = '#10b981';
    el.style.borderColor = 'rgba(16, 185, 129, 0.3)';
  }
}


// Escapa texto do usuário antes de interpolá-lo em innerHTML (evita injeção de HTML/XSS)
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}


// ---------- Máscara decimal (2 casas) sem precisar digitar vírgula ----------
// Digita só números: "28550" -> "285,50" (modelo centavos, padrão apps de pagamento)
function fmt2(v) {
  const n = parseVal(v);
  return n ? n.toFixed(2).replace('.', ',') : '';
}

function maskCents(input) {
  const digits = input.value.replace(/\D/g, '');
  input.value = digits ? (parseInt(digits, 10) / 100).toFixed(2).replace('.', ',') : '';
}


function formatDate(dStr) {
  if(!dStr) return '';
  const parts = dStr.split('-');
  if(parts.length !== 3) return dStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}


function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}


// ID numérico único (evita colisão de Date.now() no mesmo ms)
function uid() {
  let id = Date.now();
  const taken = new Set([...state.shifts, ...state.expenses, ...state.maintenance].map(x => x.id));
  while (taken.has(id)) id++;
  return id;
}
