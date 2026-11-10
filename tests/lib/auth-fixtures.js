/**
 * Apoio aos testes da janela de autenticação.
 *
 * A janela testada é a REAL: o markup de #mpLoginScreen é extraído de
 * www/index.html, para que o teste apanhe campos em falta, ids trocados ou
 * vistas que não existem — e não uma cópia que envelhece sozinha.
 *
 * As respostas do Supabase são simuladas ao nível do fetch (o vendor verdadeiro
 * é carregado), por isso o que se verifica é o pedido HTTP que o app produz
 * (grant_type, redirect_to, corpo), não uma maquete do cliente.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WWW = path.join(__dirname, '..', '..', 'www');
const raiz = path.join(__dirname, '..', '..');

function markupDaJanela() {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const doc = new JSDOM(html).window.document;
  const alvo = doc.getElementById('mpLoginScreen');
  if (!alvo) throw new Error('#mpLoginScreen não existe em www/index.html');
  return alvo.outerHTML;
}

/**
 * Cria uma janela isolada com a janela de autenticação real.
 * respostas: { 'trecho-da-url': { status, json } } — o primeiro trecho que
 * aparecer na URL define a resposta. Sem correspondência, 200 com {}.
 */
function criarJanelaAuth(opcoes) {
  const cfg = opcoes || {};
  const w = new JSDOM(
    '<!doctype html><html lang="pt-BR"><body>' +
      markupDaJanela() +
      '<div id="mpAccountEmail"></div><div id="mpAccountActions"></div>' +
      '<div id="mpAccountBoxStatus"></div><div id="mpSyncStatus"></div>' +
      '<div id="mpNotify"></div>' +
      '</body></html>',
    { url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true }
  ).window;

  w.eval(`
    window.__pedidos = [];
    window.__respostas = ${JSON.stringify(cfg.respostas || {})};
    window.__avisos = [];
    window.__nativo = ${cfg.nativo === false ? 'false' : 'true'};
    window.fetch = async (u, o) => {
      const url = String(u);
      const corpo = (o && o.body) ? String(o.body) : '';
      window.__pedidos.push({ url: url, body: corpo, method: (o && o.method) || 'GET' });
      const chaves = Object.keys(window.__respostas);
      const achado = chaves.filter(k => url.indexOf(k) !== -1)[0];
      const r = achado ? window.__respostas[achado] : { status: 200, json: {} };
      const status = r.status || 200;
      const ok = (typeof r.ok === 'boolean') ? r.ok : (status >= 200 && status < 300);
      const cabecalhos = r.headers || {};
      return {
        ok: ok,
        status: status,
        headers: { get: (h) => cabecalhos[String(h).toLowerCase()] || null },
        json: async () => (r.json || {}),
        text: async () => JSON.stringify(r.json || {})
      };
    };
    window.Capacitor = {
      isNativePlatform: () => window.__nativo,
      Plugins: {
        Browser: { open: async () => {}, close: async () => {} },
        App: {
          addListener: (ev, cb) => { window.__listenerAppUrlOpen = cb; return Promise.resolve({ remove: async () => {} }); },
          getLaunchUrl: async () => undefined
        }
      }
    };
    window.state = { shifts: [], expenses: [], maintenance: [] };
    window.logEvent = function () {};
    window.MP_SUPABASE_URL = 'https://projeto.supabase.co';
    window.MP_SUPABASE_ANON_KEY = 'sb_publishable_teste';
    window.MP_OAUTH_REDIRECT_NATIVE = 'com.pro.driver://oauth-callback';
  `);

  w.eval(fs.readFileSync(path.join(WWW, 'js', 'vendor', 'supabase.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(WWW, 'js', 'auth.js'), 'utf8'));

  // Isola a autenticação da sincronização: os testes de auth não devem
  // disparar leituras/escritas de user_states.
  w.eval(`
    window.mpReconcile = async function () { window.__reconcile = (window.__reconcile || 0) + 1; };
    window.mpNotify = function (m) { window.__avisos.push(String(m)); };
  `);

  if (cfg.limparLocalStorage !== false) {
    try { w.localStorage.clear(); } catch (_) { /* nada */ }
  }
  return w;
}

/**
 * Janela isolada para o PORTÃO DE ACESSO (Fase 3).
 *
 * Traz a janela de autenticação REAL (extraída de www/index.html), o <header> e
 * o <main class="container"> que o portão esconde, e o auth.js verdadeiro.
 *
 * opcoes:
 *   local       — { 'chave': 'valor' } semeado ANTES de o auth.js arrancar
 *                 (sessão guardada em mp_sb_auth_v1, dono, datas, demo…)
 *   respostas   — respostas simuladas do Supabase (como em criarJanelaAuth)
 *   falharRede  — fetch rejeita com "Failed to fetch"
 *   offline     — navigator.onLine === false
 *   estado      — estado em memória (por omissão, histórico com dados reais)
 */
function criarJanelaPortao(opcoes) {
  const cfg = opcoes || {};
  const w = new JSDOM(
    '<!doctype html><html lang="pt-BR"><body>' +
      '<header id="topo"></header>' +
      '<main class="container"><div id="mpSyncStatus"></div>' +
        '<div id="mpAccountEmail"></div><div id="mpAccountActions"></div>' +
        '<div id="mpAccountBoxStatus"></div></main>' +
      markupDaJanela() +
      '<div id="mpNotify"></div>' +
      '</body></html>',
    { url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true }
  ).window;

  const estado = cfg.estado || { vehicle: { odometer: 1000 }, shifts: [{ id: 's-1' }],
    expenses: [{ id: 'e-1' }], maintenance: [] };

  w.eval(`
    window.__pedidos = [];
    window.__respostas = ${JSON.stringify(cfg.respostas || {})};
    window.__falharRede = ${cfg.falharRede ? 'true' : 'false'};
    window.fetch = async (u, o) => {
      const url = String(u);
      window.__pedidos.push({ url: url, body: (o && o.body) ? String(o.body) : '', method: (o && o.method) || 'GET' });
      if (window.__falharRede) throw new TypeError('Failed to fetch');
      const chaves = Object.keys(window.__respostas);
      const achado = chaves.filter(k => url.indexOf(k) !== -1)[0];
      const r = achado ? window.__respostas[achado] : { status: 200, json: {} };
      const status = r.status || 200;
      const ok = (typeof r.ok === 'boolean') ? r.ok : (status >= 200 && status < 300);
      const cabecalhos = r.headers || {};
      return {
        ok: ok,
        status: status,
        headers: { get: (h) => cabecalhos[String(h).toLowerCase()] || null },
        json: async () => (r.json || {}),
        text: async () => JSON.stringify(r.json || {})
      };
    };
    window.Capacitor = {
      isNativePlatform: () => false,
      Plugins: {
        Browser: { open: async () => {}, close: async () => {} },
        App: { addListener: () => {}, getLaunchUrl: async () => undefined }
      }
    };
    window.state = ${JSON.stringify(estado)};
    window.defaultData = { vehicle: {}, fuelSettings: {} };
    window.migrateState = function (s) { return s; };
    window.saveState = function () { window.__gravacoes = (window.__gravacoes || 0) + 1; };
    window.render = function () {};
    window.logEvent = function () {};
    window.MP_SUPABASE_URL = 'https://projeto.supabase.co';
    window.MP_SUPABASE_ANON_KEY = 'sb_publishable_teste';
    window.MP_OAUTH_REDIRECT_NATIVE = 'com.pro.driver://oauth-callback';
  `);

  if (cfg.offline) {
    Object.defineProperty(w.navigator, 'onLine', { value: false, configurable: true });
  }
  const semente = cfg.local || {};
  Object.keys(semente).forEach((k) => w.localStorage.setItem(k, semente[k]));

  w.eval(fs.readFileSync(path.join(WWW, 'js', 'vendor', 'supabase.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(WWW, 'js', 'auth.js'), 'utf8'));

  // A reconciliação real fala com user_states; aqui só se conta se foi pedida.
  w.eval(`
    window.mpReconcile = async function () {
      window.__reconcile = (window.__reconcile || 0) + 1;
      window.__pedidos.push({ url: 'https://projeto.supabase.co/rest/v1/user_states?mp-simulado', body: '', method: 'GET' });
    };
  `);
  w.__estado = estado;
  return w;
}

/** Sessão no formato que o supabase-js grava em mp_sb_auth_v1. */
function sessaoGuardada(uid, segundosParaExpirar) {
  const agora = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    access_token: 'AT-' + uid,
    refresh_token: 'RT-' + uid,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: agora + segundosParaExpirar,
    user: { id: uid, email: uid + '@exemplo.com', aud: 'authenticated' }
  });
}

/** Resposta de renovação de token (grant_type=refresh_token) válida. */
function respostaRefresh(uid, segundos) {
  const agora = Math.floor(Date.now() / 1000);
  return {
    status: 200,
    json: {
      access_token: 'AT-novo-' + uid,
      refresh_token: 'RT-novo-' + uid,
      token_type: 'bearer',
      expires_in: segundos || 3600,
      expires_at: agora + (segundos || 3600),
      user: { id: uid, email: uid + '@exemplo.com', aud: 'authenticated' }
    }
  };
}

/** Último pedido cuja URL contém o trecho. */
function ultimoPedido(w, trecho) {
  const lista = (w.__pedidos || []).filter((p) => p.url.indexOf(trecho) !== -1);
  return lista.length ? lista[lista.length - 1] : null;
}

function pedidosCom(w, trecho) {
  return (w.__pedidos || []).filter((p) => p.url.indexOf(trecho) !== -1);
}

function jsonDoCorpo(pedido) {
  try { return JSON.parse(pedido.body); } catch (_) { return null; }
}

function statusDe(w, id) {
  const el = w.document.getElementById(id);
  return el ? String(el.textContent || '') : '';
}

function visivel(w, id) {
  const el = w.document.getElementById(id);
  return !!el && el.style.display !== 'none' && el.style.display !== '';
}

module.exports = {
  WWW,
  raiz,
  markupDaJanela,
  criarJanelaAuth,
  criarJanelaPortao,
  sessaoGuardada,
  respostaRefresh,
  ultimoPedido,
  pedidosCom,
  jsonDoCorpo,
  statusDe,
  visivel
};
