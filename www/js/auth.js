// MotoristaPro — Autenticação Supabase (Google) + sincronização em nuvem
// Requer: js/vendor/supabase.js, js/config.js, utils.js (logEvent), data.js (state/saveState/migrateState)
//
// Modelo: local-first. O app continua 100% funcional offline;
// com sessão ativa, o estado é sincronizado (last-write-wins por updated_at).

const MP_SYNC_KEY = 'mp_last_sync_v8';
const MP_BACKUP_PULL_KEY = 'mp_state_backup_before_pull_v8';
const MPS_NEEDS_PULL_KEY = 'mp_pull_attempted_v8';
// (o antigo atalho "continuar sem conta" — mp_offline_mode_v8 — foi removido
// na Fase 3: já nada o lê nem o escreve.)
const MP_STATE_LS_KEY = 'mp_html_state_v8';

let mpSupabase = null;
let mpSession = null;
let mpSyncTimer = null;
let mpSyncBusy = false;

// Controlo do deep link OAuth. O listener nativo é um recurso único: registá-lo
// outra vez a cada tentativa de login acumulava callbacks e podia entregar o
// mesmo retorno a dois caminhos em simultâneo.
let mpDeepLinkRegistrado = false;   // appUrlOpen confirmado como ligado
let mpDeepLinkPromessa = null;      // registo a decorrer (evita registo duplo)
let mpLaunchUrlConsultado = false;  // getLaunchUrl já consultado (arranque)
let mpRetornoEmCurso = null;        // promessa do retorno OAuth a decorrer
let mpRetornoEmCursoChave = null;   // qual retorno está a decorrer (code/token)

// ---------- utilidades locais ----------
function mpIsNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function mpNotify(message, type) {
  let el = document.getElementById('mpNotify');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mpNotify';
    el.className = 'mp-notify';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = 'mp-notify mp-notify--show' + (type === 'error' ? ' mp-notify--error' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'mp-notify'; }, 3200);
}

function mpSetLoginStatus(msg, isError, tipo) {
  const el = document.getElementById('mpLoginStatus');
  const classe = 'mp-login-status' +
    (tipo === 'ok' ? ' mp-login-status--ok' : (isError ? ' mp-login-status--error' : ''));
  if (el) {
    el.textContent = msg || '';
    el.className = classe;
    // O status nasceu no ecrã de login, que já não aparece no arranque.
    // Sem isto, um erro de login ficava invisível e parecia "não fazer nada".
    el.style.display = msg ? 'block' : 'none';
    const box = document.getElementById('mpAccountBoxStatus');
    if (box) {
      box.textContent = msg || '';
      box.className = classe;
      box.style.display = msg ? 'block' : 'none';
    }
  }
}

function mpShowLoginScreen(show) {
  const el = document.getElementById('mpLoginScreen');
  if (el) el.style.display = show ? 'flex' : 'none';
}

function mpSetSyncStatus(kind) {
  const el = document.getElementById('mpSyncStatus');
  if (!el) return;
  const map = {
    synced: '☁️ Sincronizado com a nuvem',
    syncing: '🔄 Sincronizando…',
    offline: '📴 Offline — dados salvos neste aparelho',
    anon: 'Não conectado — dados só neste aparelho'
  };
  el.textContent = map[kind] || map.anon;
}


// ============================================================
// PORTÃO DE ACESSO — login obrigatório (Fase 3)
// ============================================================
//
// Regras, todas cobertas por teste:
//  1. Nada da área financeira aparece antes de uma sessão válida — o atributo
//     data-mp-locked é posto por script no <head>, antes do primeiro desenho.
//  2. Sessão válida (token não expirado) abre o app, mesmo sem internet.
//  3. Sessão expirada + sem rede: tolerância de 7 dias contados da última
//     validação bem-sucedida. Fora disso, pede conexão e NÃO apaga nada.
//  4. Falta de rede nunca é tratada como logout: o signOut só acontece por
//     ação explícita do utilizador.
//  5. Dados de demonstração nunca sobem para a nuvem.
//  6. Conta diferente da dona do aparelho não vê, não junta e não envia dados.

const MP_DEVICE_OWNER_KEY = 'mp_device_owner_v1';
const MP_AUTH_LAST_OK_KEY = 'mp_auth_last_ok_v1';
const MP_AUTH_LAST_USER_KEY = 'mp_auth_last_user_v1';
// A chave da demo já é declarada como `const` no init.js. Como os scripts
// clássicos partilham o escopo lexical global, declarar aqui outra vez dá
// `SyntaxError: Identifier 'MP_DEMO_KEY' has already been declared` e mata
// o ficheiro inteiro. Por isso usa-se um acessor (e o auth.js continua a
// funcionar isolado nos testes, que o avaliam sozinho).
function mpDemoKey() { return 'mp_demo_data_v1'; }
// Cópia exata do estado de exemplo que o init.js gravou. Serve para saber,
// ao entrar, se a demonstração continua intacta (pode ser substituída por
// um espaço vazio) ou se o utilizador já a editou (aí são dados dele e
// não se apaga nada).
function mpDemoSnapshotKey() { return 'mp_demo_snapshot_v1'; }
const MP_TOLERANCIA_DIAS = 7;
// O cliente do Supabase repete a renovação algumas vezes quando a rede está
// em baixo; sem prazo, o arranque ficaria em "Verificando…" por ~26 s.
const MP_AUTH_PRAZO_MS = 6000;

let mpAcesso = 'verificando';       // verificando | liberado | login | sem_conexao | conta_diferente
let mpAcessoSemValidacao = false;   // liberado pela tolerância offline

// Corre uma promessa com prazo. Nunca rejeita: devolve { valor } ou
// { prazoEsgotado: true } (a promessa original é abandonada, mas a sua
// rejeição já está tratada por quem a criou).
function mpComPrazo(promessa, ms) {
  return new Promise((resolve) => {
    let decidido = false;
    const fim = () => { if (!decidido) { decidido = true; clearTimeout(temporizador); } };
    const temporizador = setTimeout(() => {
      if (!decidido) { decidido = true; resolve({ prazoEsgotado: true }); }
    }, ms);
    promessa.then(
      (valor) => { if (!decidido) { fim(); resolve({ valor }); } },
      (erro) => { if (!decidido) { fim(); resolve({ erro }); } }
    );
  });
}

function mpLerSessaoGuardada() {
  try {
    const bruto = localStorage.getItem('mp_sb_auth_v1');
    if (!bruto) return null;
    const s = JSON.parse(bruto);
    return (s && s.user && s.user.id) ? s : null;
  } catch (_) { return null; }
}

function mpMarcarValidacao(uid) {
  try {
    localStorage.setItem(MP_AUTH_LAST_OK_KEY, new Date().toISOString());
    if (uid) localStorage.setItem(MP_AUTH_LAST_USER_KEY, uid);
  } catch (_) { /* storage indisponível: só se perde a contagem de tolerância */ }
}

function mpDiasDesdeUltimaValidacao() {
  try {
    const iso = localStorage.getItem(MP_AUTH_LAST_OK_KEY);
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    return (Date.now() - t) / 86400000;
  } catch (_) { return null; }
}

function mpErroDeRede(e) {
  if (!e) return false;
  if (e.status === 0) return true;
  const msg = String(e.message || e).toLowerCase();
  return /failed to fetch|network|load failed|networkerror|timeout|offline/.test(msg);
}

function mpEstadoEhDemo() {
  try { return localStorage.getItem(mpDemoKey()) === '1'; } catch (_) { return false; }
}

function mpMarcarDemo(valor) {
  try {
    if (valor) localStorage.setItem(mpDemoKey(), '1');
    else localStorage.removeItem(mpDemoKey());
  } catch (_) { /* sem storage: a marca não persiste */ }
}

// Dados reais = histórico do utilizador, nunca a demonstração.
function mpEstadoTemDadosReais() {
  if (typeof state === 'undefined' || !state) return false;
  if (mpEstadoEhDemo()) return false;
  return (state.shifts || []).length > 0 ||
         (state.expenses || []).length > 0 ||
         (state.maintenance || []).length > 0;
}

// Só sincroniza com sessão validada, aparelho do próprio utilizador e sem demo.
function mpPodeSincronizar() {
  return mpAcesso === 'liberado' && !mpAcessoSemValidacao && !!mpSession && !mpEstadoEhDemo();
}

function mpReconcileSePuder() {
  if (!mpPodeSincronizar()) {
    logEvent('info', 'Reconciliação adiada pelo portão de acesso', { acesso: mpAcesso, semValidacao: mpAcessoSemValidacao });
    return Promise.resolve(false);
  }
  return mpReconcile();
}

// A demonstração nunca deve subir para a conta de ninguém e, ao entrar, o
// espaço do utilizador começa vazio. `zero` = estado vazio, não apaga nada real.
function mpDescartarDemo() {
  if (!mpEstadoEhDemo()) return false;
  // Demonstração editada = dados do utilizador. Só se descarta a marca; o
  // histórico fica onde está (preservação financeira acima de tudo).
  let intacta = true;
  try {
    const gravado = localStorage.getItem('mp_html_state_v8');
    const copia = localStorage.getItem(mpDemoSnapshotKey());
    if (gravado && copia && gravado !== copia) intacta = false;
  } catch (_) { /* sem storage: assume-se demonstração intacta */ }
  if (!intacta) {
    mpMarcarDemo(false);
    logEvent('info', 'Demonstração editada pelo utilizador: mantida como dados locais');
    return false;
  }
  try {
    state = migrateState({
      vehicle: Object.assign({}, defaultData.vehicle, {
        model: '', plate: '', odometer: 0, manualOdometerBase: 0
      }),
      fuelSettings: defaultData.fuelSettings,
      shifts: [], expenses: [], maintenance: []
    });
    mpMarcarDemo(false);
    try { localStorage.removeItem(mpDemoSnapshotKey()); } catch (_) { /* nada */ }
    saveState();
    logEvent('info', 'Dados de demonstração descartados ao autenticar');
    return true;
  } catch (e) {
    logEvent('warn', 'Falha ao descartar demonstração', { message: e && e.message });
    return false;
  }
}

// Dono do aparelho: quem primeiro tem dados reais. Sem dono e sem dados, o
// aparelho adota a conta que entrar (nada está em risco).
function mpVerificarDono(uid) {
  if (!uid) return { ok: false, motivo: 'sem-utilizador' };
  let dono = null;
  try { dono = localStorage.getItem(MP_DEVICE_OWNER_KEY); } catch (_) { /* nada */ }
  const temDados = mpEstadoTemDadosReais();
  const gravar = (v) => { try { if (v) localStorage.setItem(MP_DEVICE_OWNER_KEY, v); } catch (_) { /* nada */ } };

  if (!dono) {
    // Primeira conta a autenticar neste aparelho passa a ser a dona. Registar
    // mesmo sem dados evita que uma segunda conta apareça depois como "dona"
    // e receba o histórico que entretanto foi criado.
    gravar(uid);
    return { ok: true, adotado: true, semDados: !temDados };
  }
  if (dono === uid) return { ok: true };
  if (!temDados) { gravar(uid); return { ok: true, adotado: true, semDados: true }; }
  return { ok: false, motivo: 'conta-diferente' };
}

function mpAplicarPortao(liberado) {
  const html = document.documentElement;
  if (!html) return;
  if (liberado) html.removeAttribute('data-mp-locked');
  else html.setAttribute('data-mp-locked', '1');
  // `inert` reforça: sem foco, sem clique e fora da árvore de acessibilidade.
  const alvos = document.querySelectorAll('header, .desktop-nav, .mobile-nav, main.container, .modal-overlay');
  Array.prototype.forEach.call(alvos, (el) => {
    if (liberado) el.removeAttribute('inert');
    else el.setAttribute('inert', '');
  });
}

function mpPreencherResumoBloqueio() {
  const el = document.getElementById('mpBlockedResumo');
  if (!el) return;
  const s = (typeof state !== 'undefined' && state) ? state : {};
  const n = (a) => (Array.isArray(a) ? a.length : 0);
  el.innerHTML = '<strong>' + n(s.shifts) + ' turnos · ' + n(s.expenses) + ' despesas · ' +
    n(s.maintenance) + ' manutenções</strong> salvos neste aparelho';
}

function mpMostrarAcesso(estado) {
  mpAcesso = estado;
  const liberado = estado === 'liberado';
  mpAplicarPortao(liberado);
  if (liberado) {
    mpShowLoginScreen(false);
    mpUpdateAccountUI();
    mpSetSyncStatus(mpAcessoSemValidacao ? 'offline' : (mpSession ? 'synced' : 'anon'));
    return;
  }
  mpShowLoginScreen(true);
  const vista = {
    verificando: 'checking',
    login: 'login',
    sem_conexao: 'offline',
    conta_diferente: 'blocked'
  }[estado] || 'login';
  mpAuthMostrarVista(vista, true);
  if (estado === 'conta_diferente') mpPreencherResumoBloqueio();
  if (estado !== 'verificando') mpSetGoogleBusy(false, 'Entrar com Google');
}

function mpBloquearPorContaDiferente() {
  mpAcessoSemValidacao = false;
  mpMostrarAcesso('conta_diferente');
  logEvent('warn', 'Acesso bloqueado: o aparelho tem dados de outra conta');
  return 'conta_diferente';
}

// Decide se o app abre. É o único ponto que libera a área financeira.
async function mpAvaliarAcesso(opcoes) {
  const opts = opcoes || {};
  if (!mpSupabase) {
    mpMostrarAcesso('login');
    mpSetLoginStatus('Serviço indisponível — verifique sua conexão e a configuração.', true);
    return 'login';
  }
  if (mpAcesso !== 'liberado' && !opts.silencioso) mpMostrarAcesso('verificando');

  let sessao = null;
  let erro = null;
  const semRede = typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
  if (semRede) {
    // Rede declarada em baixo: não vale a pena esperar pelos retries do
    // cliente (podem levar ~26 s). A sessão guardada é avaliada pela
    // tolerância offline logo abaixo.
    erro = { status: 0, message: 'offline' };
  } else {
    const tentativa = mpSupabase.auth.getSession().then(
      (r) => ({ resposta: r }),
      (e) => ({ falha: e })
    );
    const r = await mpComPrazo(tentativa, MP_AUTH_PRAZO_MS);
    if (r.prazoEsgotado) {
      erro = { status: 0, message: 'timeout' };
    } else if (r.erro) {
      erro = r.erro;
    } else if (r.valor && r.valor.falha) {
      erro = r.valor.falha;
    } else if (r.valor && r.valor.resposta) {
      sessao = (r.valor.resposta.data && r.valor.resposta.data.session) || null;
      erro = r.valor.resposta.error || null;
    }
  }

  const agora = Date.now();
  const expiraEm = sessao && sessao.expires_at ? sessao.expires_at * 1000 : 0;
  const valida = !!sessao && expiraEm > agora + 30000;

  if (valida) {
    const uid = sessao.user && sessao.user.id;
    const dono = mpVerificarDono(uid);
    if (!dono.ok) return mpBloquearPorContaDiferente();
    mpSession = sessao;
    mpMarcarValidacao(uid);
    mpAcessoSemValidacao = false;
    if (mpEstadoEhDemo()) mpDescartarDemo();
    mpMostrarAcesso('liberado');
    logEvent('info', 'Acesso liberado com sessão válida');
    return 'liberado';
  }

  // Sem sessão utilizável: distinguir "sem internet" de "sessão terminou".
  const guardada = mpLerSessaoGuardada();
  const redeFalhou = mpErroDeRede(erro);

  if (guardada && redeFalhou) {
    const dias = mpDiasDesdeUltimaValidacao();
    let donoAparelho = null;
    try { donoAparelho = localStorage.getItem(MP_DEVICE_OWNER_KEY); } catch (_) { /* nada */ }
    const mesmaConta = !donoAparelho || donoAparelho === guardada.user.id;
    const dentroDaTolerancia = dias !== null && dias <= MP_TOLERANCIA_DIAS;

    if (dentroDaTolerancia && mesmaConta) {
      // Tolerância offline: a sessão existia e foi validada há pouco tempo.
      // Não há token utilizável, por isso nem sync nem push acontecem.
      mpSession = null;
      mpAcessoSemValidacao = true;
      if (mpEstadoEhDemo()) mpDescartarDemo();
      mpMostrarAcesso('liberado');
      logEvent('info', 'Acesso liberado por tolerância offline', { dias: Math.round(dias) });
      mpNotify('Sem conexão: sessão não validada agora. Seus dados locais estão disponíveis.');
      return 'liberado-sem-validacao';
    }
    mpSession = null;
    mpAcessoSemValidacao = false;
    mpMostrarAcesso('sem_conexao');
    logEvent('info', 'Acesso pendente de conexão para validar a sessão');
    return 'sem_conexao';
  }

  // Sessão inexistente ou refresh recusado pelo servidor.
  mpSession = null;
  mpAcessoSemValidacao = false;
  mpMostrarAcesso('login');
  if (opts.mensagem) mpSetLoginStatus(opts.mensagem, true);
  return 'login';
}

async function mpAuthTentarNovamente() {
  const btn = document.getElementById('mpBtnRetryAuth');
  if (btn) { btn.disabled = true; btn.__mpTexto = btn.textContent; btn.textContent = 'Verificando…'; }
  try {
    await mpAvaliarAcesso();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Tentar novamente'; }
  }
}

function mpExportarBackupEmergencia() {
  try {
    if (typeof exportJSONBackup === 'function') { exportJSONBackup(); return; }
    mpSetLoginStatus('Exportação indisponível neste contexto.', true);
  } catch (e) {
    logEvent('error', 'Falha ao exportar backup de emergência', { message: e && e.message });
    mpSetLoginStatus('Não foi possível exportar agora. Tente novamente.', true);
  }
}

// ---------- inicialização do cliente ----------
function mpInitSupabase() {
  if (typeof window.supabase === 'undefined' || !window.MP_SUPABASE_URL || !window.MP_SUPABASE_ANON_KEY) {
    logEvent('warn', 'Supabase não configurado (config.js em falta)');
    mpSetSyncStatus('anon');
    return null;
  }
  try {
    mpSupabase = window.supabase.createClient(window.MP_SUPABASE_URL, window.MP_SUPABASE_ANON_KEY, {
      auth: {
        // PKCE: o retorno do Google traz ?code=… e o token só é emitido depois
        // de o app provar que iniciou o fluxo (code_verifier). Com o default
        // 'implicit' o retorno trazia #access_token=… no fragmento, que o
        // deep link do Android não entregava a searchParams.get('code') — o
        // login terminava sem sessão (ver DIAGNOSTICO-GOOGLE-OAUTH.md).
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'mp_sb_auth_v1'
      }
    });
  } catch (e) {
    logEvent('error', 'Falha ao criar cliente Supabase', { message: e.message });
    mpSetSyncStatus('anon');
    return null;
  }

  // Arranque: o portão decide se abre, se pede login ou se espera conexão.
  mpAvaliarAcesso().catch(e => {
    logEvent('error', 'Falha ao avaliar acesso no arranque', { message: e && e.message });
    mpMostrarAcesso('login');
    mpSetLoginStatus('Não foi possível verificar sua sessão. Tente entrar novamente.', true);
  });

  // Mudanças de sessão (login, logout, token refresh)
  mpSupabase.auth.onAuthStateChange((event, session) => {
    mpSession = session;
    // O link de recuperação abre uma sessão. Sem distinguir o evento, o
    // utilizador cairia no app "já dentro" sem nunca poder definir a senha.
    if (event === 'PASSWORD_RECOVERY') {
      mpAcessoSemValidacao = false;
      mpAplicarPortao(true);
      mpShowLoginScreen(true);
      mpAuthTratarRecuperacao();
      mpUpdateAccountUI();
      return;
    }
    if (event === 'SIGNED_IN') {
      mpSetLoginStatus('');
      // Aparelho de outra conta: a sessão existe mas o acesso fica fechado.
      const uid = mpSession && mpSession.user && mpSession.user.id;
      const dono = mpVerificarDono(uid);
      if (!dono.ok) { mpBloquearPorContaDiferente(); return; }
      mpMarcarValidacao(uid);
      mpAcessoSemValidacao = false;
      if (mpEstadoEhDemo()) mpDescartarDemo();
      mpMostrarAcesso('liberado');
      if (mpAuthLerIntencao() === 'recovery') {
        mpAuthTratarRecuperacao();
      } else {
        mpNotify('Conectado! Sincronizando dados…');
      }
      mpReconcileSePuder();
      return;
    }
    if (event === 'SIGNED_OUT') {
      mpSession = null;
      mpAcessoSemValidacao = false;
      mpMostrarAcesso('login');
      return;
    }
    mpApplySessionUI();
  });

  mpRegisterDeepLink();
  mpAuthLigarEventos();
  window.addEventListener('online', () => {
    // Sem internet nunca é logout: ao voltar a rede revalidamos e, se a sessão
    // estiver boa, reconciliamos.
    mpAvaliarAcesso({ silencioso: mpAcesso === 'liberado' }).then((estado) => {
      if (estado === 'liberado') mpReconcileSePuder();
    });
  });
  return mpSupabase;
}

// ---------- retorno do Google (Android) ----------
// O app é aberto por com.pro.driver://oauth-callback?code=… (fluxo PKCE).
// Regras aprendidas com o defeito anterior (DIAGNOSTICO-GOOGLE-OAUTH.md):
//  - o código pode chegar na query (?code=) ou, em builds antigos do fluxo
//    implícito, no fragmento (#access_token=…). O fragmento NUNCA aparece em
//    searchParams, era exatamente aí que o login morria;
//  - o mesmo link pode ser entregue mais de uma vez (reabertura, duplicação
//    do intent): o código tem de ser consumido uma única vez;
//  - o browser tem de fechar sempre, com sucesso ou com erro;
//  - nunca registar em log o code, o access_token, o refresh_token ou o
//    verificador PKCE.

// Deduplicação por código. Não guarda mais de 20 para não crescer sem limite.
const MP_OAUTH_USADOS = new Set();
function mpOAuthJaUsado(chave) {
  if (!chave) return false;
  if (MP_OAUTH_USADOS.has(chave)) return true;
  MP_OAUTH_USADOS.add(chave);
  if (MP_OAUTH_USADOS.size > 20) MP_OAUTH_USADOS.delete(MP_OAUTH_USADOS.values().next().value);
  return false;
}

// Só aceita o nosso esquema/host: com.pro.driver://oauth-callback
function mpOAuthUrlValida(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'com.pro.driver:' && u.host === 'oauth-callback';
  } catch (_) {
    return false;
  }
}

// O verificador PKCE é escrito pelo supabase-js no arranque do fluxo (chaves
// "<storageKey>-code-verifier" e "<storageKey>-flow-<id>-code-verifier").
// Sem ele o exchange falha sempre — é melhor dizer isso ao utilizador do que
// deixar o vendor devolver um erro técnico.
function mpTemVerificadorPkce() {
  try {
    const chave = (mpSupabase && mpSupabase.auth && mpSupabase.auth.storageKey) || 'mp_sb_auth_v1';
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(chave) === 0 && k.indexOf('code-verifier') !== -1) {
        if (localStorage.getItem(k)) return true;
      }
    }
  } catch (_) { /* storage indisponível (modo privado): deixa o vendor decidir */ }
  return false;
}

async function mpFecharBrowser() {
  try {
    if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser) {
      await Capacitor.Plugins.Browser.close();
    }
  } catch (_) { /* o browser pode já estar fechado */ }
}

// Processa um URL de retorno. Devolve um relatório para poder ser testado.
// modo: 'pkce' (code) | 'implicit' (tokens no fragmento, compatibilidade)
async function mpProcessarRetornoOAuth(url) {
  const relatorio = { ok: false, modo: null, motivo: null, duplicado: false, erro: null };
  if (!url) { relatorio.motivo = 'url vazia'; return relatorio; }
  if (!mpOAuthUrlValida(url)) { relatorio.motivo = 'esquema/host inesperado'; return relatorio; }
  if (!mpSupabase) { relatorio.motivo = 'cliente Supabase indisponível'; return relatorio; }

  let u;
  try { u = new URL(url); } catch (_) { relatorio.motivo = 'url inválida'; return relatorio; }

  // O GoTrue devolve erros explicitamente: não os ignorar.
  const erroDevolvido = u.searchParams.get('error') ||
    new URLSearchParams((u.hash || '').replace(/^#/, '')).get('error');
  if (erroDevolvido) {
    relatorio.motivo = 'o provedor devolveu um erro';
    relatorio.erro = erroDevolvido;
    return relatorio;
  }

  const paramsHash = new URLSearchParams((u.hash || '').replace(/^#/, ''));
  const code = u.searchParams.get('code');
  const accessToken = paramsHash.get('access_token');

  if (code) {
    relatorio.modo = 'pkce';
    if (mpOAuthJaUsado('code:' + code)) { relatorio.duplicado = true; relatorio.motivo = 'código já processado'; return relatorio; }
    // O código só é trocável com o verificador do MESMO aparelho/instalação.
    // Verificar antes evita um pedido condenado a falhar.
    if (!mpTemVerificadorPkce()) {
      relatorio.motivo = 'verificador PKCE ausente neste aparelho';
      relatorio.erro = 'inicie o login novamente neste aparelho';
      return relatorio;
    }
    try {
      const { data, error } = await mpSupabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      if (!data || !data.session) throw new Error('sem sessão devolvida');
      relatorio.ok = true;
      return relatorio;
    } catch (e) {
      relatorio.motivo = 'falha ao trocar o código';
      relatorio.erro = String((e && e.message) || e);
      // O código pode ter sido consumido: não tentar de novo com o mesmo.
      return relatorio;
    }
  }

  if (accessToken) {
    // Compatibilidade com o fluxo implícito antigo (tokens no fragmento).
    // Isolado e sem efeito no caminho PKCE.
    relatorio.modo = 'implicit';
    const refreshToken = paramsHash.get('refresh_token');
    if (!refreshToken) { relatorio.motivo = 'token sem refresh_token'; return relatorio; }
    if (mpOAuthJaUsado('token:' + accessToken)) { relatorio.duplicado = true; relatorio.motivo = 'tokens já processados'; return relatorio; }
    try {
      const { data, error } = await mpSupabase.auth.setSession({
        access_token: accessToken, refresh_token: refreshToken
      });
      if (error) throw error;
      if (!data || !data.session) throw new Error('sem sessão devolvida');
      relatorio.ok = true;
      return relatorio;
    } catch (e) {
      relatorio.motivo = 'falha ao adotar os tokens';
      relatorio.erro = String((e && e.message) || e);
      return relatorio;
    }
  }

  relatorio.motivo = 'sem code nem tokens no retorno';
  return relatorio;
}

// Identifica um retorno pelo que ele traz. Dois links com o MESMO código (ou os
// mesmos tokens) são a mesma entrega; códigos diferentes são retornos distintos
// e não podem partilhar resultado.
function mpChaveDoRetorno(url) {
  try {
    const u = new URL(url);
    const code = u.searchParams.get('code');
    if (code) return 'code:' + code;
    const h = new URLSearchParams((u.hash || '').replace(/^#/, ''));
    const at = h.get('access_token');
    if (at) return 'token:' + at;
  } catch (_) { /* url inválida: cai no fallback */ }
  return 'url:' + String(url || '');
}

// Trata o retorno de ponta a ponta, admitindo um só processamento de cada vez.
//  - mesmo código a chegar outra vez: espera pelo que está a decorrer e recebe
//    o desfecho desse (concorrente: true);
//  - código DIFERENTE a chegar durante um processamento: não corre uma segunda
//    troca em paralelo e NUNCA devolve o resultado do primeiro como se fosse o
//    deste. Devolve um conflito explícito que o chamador pode distinguir.
async function mpTratarRetornoOAuth(url) {
  const chave = mpChaveDoRetorno(url);
  if (mpRetornoEmCurso) {
    if (chave === mpRetornoEmCursoChave) {
      const r = await mpRetornoEmCurso;
      logEvent('info', 'Entrega repetida do mesmo retorno aguardou o processamento em curso');
      return Object.assign({}, r, { concorrente: true });
    }
    // Nada é trocado e nada é apresentado como sucesso: o retorno em curso é o
    // dono exclusivo da sessão. O código novo não é marcado como usado, para
    // poder ser tratado numa próxima tentativa.
    logEvent('warn', 'Retorno OAuth diferente chegou durante um processamento em curso');
    return {
      ok: false,
      modo: null,
      motivo: 'outro retorno OAuth está a ser processado',
      erro: 'aguarde a conclusão do login em curso e tente novamente',
      duplicado: false,
      conflito: true
    };
  }
  mpRetornoEmCursoChave = chave;
  // A promessa é criada já a partir de uma chamada assíncrona: se
  // mpExecutarRetornoOAuth lançasse de forma síncrona (antes do primeiro await),
  // o `finally` limpava o estado e o chamador ficava com uma rejeição.
  mpRetornoEmCurso = Promise.resolve().then(() => mpExecutarRetornoOAuth(url));
  try {
    return await mpRetornoEmCurso;
  } finally {
    mpRetornoEmCurso = null;
    mpRetornoEmCursoChave = null;
  }
}

// Corpo do processamento (um por retorno, garantido pelo emissor acima).
async function mpExecutarRetornoOAuth(url) {
  mpSetLoginStatus('Conectando conta…');
  const r = await mpProcessarRetornoOAuth(url);
  await mpFecharBrowser();

  if (r.ok) {
    mpSetLoginStatus('');
    // onAuthStateChange já faz o resto (sessão, UI, reconciliação). Aqui só
    // garantimos o estado caso o evento chegue depois.
    mpSetGoogleBusy(false, 'Entrar com Google');
    if (typeof mpApplySessionUI === 'function') mpApplySessionUI();
    mpUpdateAccountUI();
    // Retorno de um link de recuperação de senha: a sessão existe, mas o que
    // o utilizador pediu foi definir uma senha nova — não entrar.
    if (mpAuthConsumirIntencao() === 'recovery') {
      mpAuthTratarRecuperacao();
      return r;
    }
    mpNotify('Login com Google concluído ☁️');
  } else if (r.duplicado) {
    // Entrega repetida do mesmo link: não é erro para o utilizador.
    logEvent('info', 'Retorno OAuth repetido ignorado', { motivo: r.motivo });
    mpSetLoginStatus('');
  } else {
    // Não registar o código nem os tokens: só o motivo.
    logEvent('error', 'Retorno OAuth falhou', { motivo: r.motivo, erro: r.erro, modo: r.modo });
    mpSetLoginStatus('Falha ao concluir login com Google' + (r.erro ? ': ' + r.erro : '.'), true);
    mpSetGoogleBusy(false, 'Entrar com Google');
    mpUpdateAccountUI();
  }
  return r;
}

// Liga o listener do deep link UMA única vez durante a vida da aplicação.
//
// App.addListener devolve Promise<PluginListenerHandle> (@capacitor/app 8.x),
// por isso o registo só conta como concluído quando a promessa resolve — marcar
// antes disso esconderia uma falha de registo para sempre. Garantias:
//  - chamadas simultâneas partilham a MESMA promessa: um único addListener;
//  - rejeição assíncrona deixa a flag em false, para nova tentativa (login
//    seguinte, ou o retorno de segurança antes de abrir o browser);
//  - erro síncrono do plugin também não marca registado.
// Devolve Promise<boolean>: true se ficou (ou já estava) ligado.
function mpLigarListenerDeepLink(App) {
  if (mpDeepLinkRegistrado) return Promise.resolve(true);
  if (mpDeepLinkPromessa) return mpDeepLinkPromessa; // registo já a decorrer

  let chamada;
  try {
    chamada = App.addListener('appUrlOpen', ({ url }) => {
      // Nunca logar o URL completo: contém códigos e/ou tokens.
      logEvent('info', 'Deep link OAuth recebido');
      mpTratarRetornoOAuth(url);
    });
  } catch (e) {
    logEvent('warn', 'Não foi possível registar deep link', { message: e.message });
    return Promise.resolve(false);
  }

  mpDeepLinkPromessa = Promise.resolve(chamada).then(() => {
    mpDeepLinkRegistrado = true;
    return true;
  }).catch((e) => {
    // Registo falhou: fica por ligar e pode ser tentado outra vez.
    mpDeepLinkRegistrado = false;
    logEvent('warn', 'Registo do deep link falhou (nova tentativa no próximo login)', {
      message: String((e && e.message) || e)
    });
    return false;
  }).then((ok) => {
    mpDeepLinkPromessa = null;
    return ok;
  });
  return mpDeepLinkPromessa;
}

// Arranque a frio: se o app foi ABERTO pelo link, o evento appUrlOpen já passou
// antes de existir listener. Só se consulta na inicialização — nunca a cada
// login, onde não há novidade nenhuma a descobrir.
function mpConsultarLaunchUrl(App) {
  if (mpLaunchUrlConsultado) return false;
  if (typeof App.getLaunchUrl !== 'function') { mpLaunchUrlConsultado = true; return false; }
  mpLaunchUrlConsultado = true;
  try {
    App.getLaunchUrl().then((res) => {
      const url = res && res.url;
      if (url && mpOAuthUrlValida(url)) {
        logEvent('info', 'App aberto por deep link OAuth (arranque a frio)');
        mpTratarRetornoOAuth(url);
      }
    }).catch(() => { /* não é fatal: o login continua disponível pelo botão */ });
  } catch (e) {
    logEvent('warn', 'getLaunchUrl falhou', { message: e.message });
  }
  return true;
}

// Botão "voltar" do Android. Sem isto, com a janela de autenticação aberta o
// toque em voltar fecharia o APP (comportamento antigo) em vez de fechar a
// janela. O comportamento fora da janela mantém-se: sai do app.
let mpBotaoVoltarLigado = false;
function mpLigarBotaoVoltar() {
  if (mpBotaoVoltarLigado) return;
  const App = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App;
  if (!App || typeof App.addListener !== 'function') return;
  mpBotaoVoltarLigado = true;
  try {
    const chamada = App.addListener('backButton', () => {
      const tela = document.getElementById('mpLoginScreen');
      const aberta = !!tela && tela.style.display === 'flex';
      if (aberta) {
        // Vista interna → volta para "entrar"; já em "entrar" → fecha.
        if (mpAuthVistaAtual !== 'login') mpAuthMostrarVista('login');
        else mpAuthFechar();
        return;
      }
      if (typeof App.exitApp === 'function') App.exitApp();
    });
    if (chamada && typeof chamada.catch === 'function') {
      chamada.catch(() => { mpBotaoVoltarLigado = false; });
    }
  } catch (e) {
    mpBotaoVoltarLigado = false;
    logEvent('warn', 'Não foi possível ligar o botão voltar', { message: e.message });
  }
}

// Ponto de entrada seguro para chamar em qualquer altura (arranque, antes de
// abrir o browser). Ligar o listener e consultar o arranque são operações
// distintas, cada uma com a sua guarda.
function mpRegisterDeepLink() {
  if (!mpIsNative() || !window.Capacitor || !Capacitor.Plugins || !Capacitor.Plugins.App) {
    return Promise.resolve(false);
  }
  const App = Capacitor.Plugins.App;
  mpConsultarLaunchUrl(App);
  return mpLigarListenerDeepLink(App);
}

function mpApplySessionUI() {
  const hasSession = !!mpSession;
  // Fase 3: o acesso é obrigatório. Se o portão ainda não liberou, a janela
  // de autenticação mantém-se e a área financeira continua oculta.
  const tela = document.getElementById('mpLoginScreen');
  const aberta = !!tela && tela.style.display === 'flex';

  if (mpAcesso !== 'liberado') {
    mpShowLoginScreen(true);
    mpUpdateAccountUI();
    mpSetSyncStatus('anon');
    return;
  }
  // Já liberado: não fechar a janela por baixo de quem está a usá-la
  // (entrar, criar conta, recuperar ou redefinir senha).
  if (aberta) { mpUpdateAccountUI(); return; }
  mpShowLoginScreen(false);
  mpUpdateAccountUI();
  if (hasSession) mpSetSyncStatus('synced');
  else mpSetSyncStatus('anon');
}

function mpUpdateAccountUI() {
  const emailEl = document.getElementById('mpAccountEmail');
  const actionsEl = document.getElementById('mpAccountActions');
  if (!emailEl || !actionsEl) return;
  if (mpSession && mpSession.user) {
    emailEl.textContent = mpSession.user.email || 'Conectado';
    actionsEl.innerHTML = '<button type="button" class="btn btn-danger btn-sm" onclick="mpLogout()">Sair da conta</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="mpAuthAbrirTrocaSenha()">Alterar senha</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="mpRestorePrePullBackup()">Restaurar cópia anterior</button>';
  } else {
    emailEl.textContent = 'Não conectado';
    // A entrada de conta passou a ser a janela de autenticação completa
    // (entrar por e-mail/senha, Google, criar conta e recuperar senha). Antes
    // eram dois campos soltos aqui, sem cadastro nem recuperação possíveis.
    actionsEl.innerHTML =
      '<button type="button" class="btn btn-primary btn-sm" id="mpBtnAbrirAuth" onclick="mpAuthAbrir(\'login\')">Entrar ou criar conta</button>';
  }
}

// Mesmo depois de autenticado, o utilizador precisa de poder trocar a senha
// sem sair do app (Configurações → Conta & Nuvem).
function mpAuthAbrirTrocaSenha() {
  if (!mpSession) { mpAuthAbrir('login'); return; }
  mpAuthAbrir('reset');
  mpSetLoginStatus('Defina a nova senha da sua conta ' + ((mpSession.user && mpSession.user.email) || '') + '.', false, 'ok');
}

// Estado visual do botão Google — funciona nos dois pontos de entrada
// (ecrã de login e Configurações → Conta & Nuvem).
function mpSetGoogleBusy(ocupado, texto) {
  ['mpBtnGoogle', 'mpBtnGoogleLogin'].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.disabled = !!ocupado;
    b.classList.toggle('mp-login-btn--busy', !!ocupado);
    if (texto) b.textContent = texto;
  });
}

// ---------- login / logout ----------
async function mpLoginWithGoogle() {
  if (!mpSupabase) {
    mpSetLoginStatus('Serviço indisponível — verifique a configuração.', true);
    return;
  }
  // Fica true enquanto o utilizador está no ecrã do Google: nesse estado o
  // botão NÃO deve voltar a "Entrar com Google" (o finally não o repõe).
  let aguardando = false;
  // REGRA: em Android/iOS o navegador só abre com o retorno do Google
  // garantido. Se o listener appUrlOpen não ficar confirmado, o código que
  // voltar com o app aberto perde-se — getLaunchUrl() só é consultado no
  // arranque, portanto não há segunda oportunidade para o recuperar. Nesse
  // caso o login nem começa.
  //
  // Em web não há deep link: o próprio supabase-js redireciona na mesma aba,
  // por isso o registo do listener não é pré-requisito.
  if (mpIsNative()) {
    const retornoGarantido = await mpRegisterDeepLink();
    if (!retornoGarantido) {
      // Mensagem para o utilizador; o detalhe do plugin fica no log técnico
      // (feito em mpLigarListenerDeepLink), nunca no ecrã.
      logEvent('warn', 'Login Google não iniciado: retorno do deep link não confirmado');
      mpSetGoogleBusy(false, 'Entrar com Google');
      mpSetLoginStatus('Não foi possível preparar o retorno do Google. Tente novamente.', true);
      mpUpdateAccountUI();
      return;
    }
  }
  mpSetGoogleBusy(true, 'Abrindo Google…');
  try {
    const redirectTo = mpIsNative()
      ? window.MP_OAUTH_REDIRECT_NATIVE
      : (window.location.origin + window.location.pathname);
    const { data, error } = await mpSupabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: mpIsNative() }
    });
    if (error) throw error;
    if (mpIsNative() && data && data.url) {
      const temBrowser = !!(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser);
      if (temBrowser) {
        await Capacitor.Plugins.Browser.open({ url: data.url, presentationStyle: 'AUTO' });
      } else {
        // Plugin indisponível: sem isto o botão ficava "a abrir" para sempre.
        window.location.href = data.url;
      }
      aguardando = true;
      mpSetGoogleBusy(true, 'Aguardando autenticação…');
      mpSetLoginStatus('Aguardando autenticação no Google…');
    }
    // Em web, o próprio supabase-js redireciona (skipBrowserRedirect: false)
  } catch (e) {
    logEvent('error', 'Login Google falhou', { message: e.message });
    mpSetLoginStatus('Erro ao iniciar login: ' + e.message, true);
    await mpFecharBrowser();
  } finally {
    // Só repõe o botão se o browser não ficou aberto à espera do Google; se
    // ficou, o estado "Aguardando autenticação…" mantém-se até o deep link
    // chegar (mpTratarRetornoOAuth liberta-o em qualquer desfecho).
    if (!aguardando) {
      mpSetGoogleBusy(false, 'Entrar com Google');
      mpUpdateAccountUI();
    }
  }
}

// ============================================================
// Janela de autenticação (entrar, criar conta, esqueci, redefinir)
// ============================================================
//
// Modelo: local-first continua igual — a janela é opcional e não bloqueia a
// abertura do app. Ela existe para o utilizador poder entrar com e-mail/senha,
// criar conta, recuperar e redefinir a senha sem sair do app.
//
// Regras que valem para TODAS as ações abaixo:
//  - um clique repetido não dispara um segundo pedido (trava mpAuthEmCurso);
//  - as mensagens são em pt-BR e não revelam dados sensíveis;
//  - nunca se registra em log a senha, o código ou os tokens;
//  - o destino do retorno é SEMPRE explícito (redirectTo), porque o site_url do
//    projeto é http://localhost:8080 e o GoTrue usaria esse valor por padrão.

const MP_AUTH_INTENT_KEY = 'mp_auth_intent_v1';
const MP_SENHA_MIN = 8;
// Mesma composição exigida pelo projeto Supabase:
// minúscula + MAIÚSCULA + dígito, mínimo de 8 caracteres.
const MP_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

let mpAuthEmCurso = null;          // ação em curso (trava de cliques repetidos)
let mpAuthVistaAtual = 'login';    // vista visível

function mpAuthEmailValido(email) {
  const e = String(email || '').trim();
  if (!e || e.length > 254) return false;
  if (/\s/.test(e)) return false;
  return MP_EMAIL_RE.test(e);
}

// Devolve o estado da política de senha e, quando reprova, o que falta — para
// a mensagem poder ser específica em vez de "senha inválida".
function mpAuthPoliticaSenha(senha) {
  const s = String(senha == null ? '' : senha);
  const regras = {
    len: s.length >= MP_SENHA_MIN,
    lower: /[a-z]/.test(s),
    upper: /[A-Z]/.test(s),
    digit: /[0-9]/.test(s)
  };
  const faltas = [];
  if (!regras.len) faltas.push('pelo menos ' + MP_SENHA_MIN + ' caracteres');
  if (!regras.lower) faltas.push('uma letra minúscula');
  if (!regras.upper) faltas.push('uma letra MAIÚSCULA');
  if (!regras.digit) faltas.push('um número');
  return { ok: faltas.length === 0, regras, faltas };
}

function mpAuthMensagemFaltaSenha(politica) {
  if (!politica || politica.ok) return '';
  if (politica.faltas.length === 1) return 'A senha precisa de ' + politica.faltas[0] + '.';
  const ultima = politica.faltas[politica.faltas.length - 1];
  const resto = politica.faltas.slice(0, -1).join(', ');
  return 'A senha precisa de ' + resto + ' e ' + ultima + '.';
}

// Mensagens de erro do GoTrue traduzidas. A ordem importa: os casos mais
// específicos vêm primeiro.
function mpAuthMensagemErro(e) {
  const msg = String((e && (e.message || e.error_description)) || e || '');
  const status = e && (e.status || e.statusCode);
  const t = msg.toLowerCase();

  if (/email not confirmed|not confirmed/.test(t)) {
    return 'Confirme seu e-mail antes de entrar. Procure o link de confirmação na sua caixa de entrada.';
  }
  if (/invalid login credentials|invalid credentials|invalid_grant/.test(t)) {
    return 'E-mail ou senha incorretos.';
  }
  if (/user already registered|already been registered|email already in use/.test(t)) {
    return 'Este e-mail já tem conta. Use "Entrar" ou "Esqueci minha senha".';
  }
  if (/signups? not allowed|signup is disabled/.test(t)) {
    return 'A criação de contas está temporariamente indisponível. Tente mais tarde.';
  }
  if (/email rate limit|over_email_send_rate_limit|rate limit/.test(t) || status === 429) {
    return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.';
  }
  if (/password should be at least|password is too weak|weak_password|password.*characters/.test(t)) {
    return 'A senha não atende à política: mínimo de 8 caracteres, com letra minúscula, letra maiúscula e número.';
  }
  if (/unable to validate email|invalid email|email address .* is invalid/.test(t)) {
    return 'E-mail inválido. Verifique e tente novamente.';
  }
  if (/auth session missing|session.*missing|jwt expired|invalid.*token|token.*expired/.test(t)) {
    return 'O link expirou ou já foi usado. Solicite um novo link de recuperação.';
  }
  if (/failed to fetch|networkerror|network request failed|load failed/.test(t)) {
    return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.';
  }
  return msg || 'Não foi possível concluir. Tente novamente.';
}

// Destino do retorno (confirmação de e-mail / recuperação de senha).
// Explícito por regra: o site_url do projeto aponta para localhost.
function mpAuthRedirectTo() {
  if (mpIsNative()) return window.MP_OAUTH_REDIRECT_NATIVE;
  return window.location.origin + window.location.pathname;
}

function mpAuthMarcarIntencao(intencao) {
  try {
    if (intencao) localStorage.setItem(MP_AUTH_INTENT_KEY, intencao);
    else localStorage.removeItem(MP_AUTH_INTENT_KEY);
  } catch (_) { /* storage indisponível: o fluxo segue, só perde a dica */ }
}

function mpAuthLerIntencao() {
  try { return localStorage.getItem(MP_AUTH_INTENT_KEY); } catch (_) { return null; }
}

function mpAuthConsumirIntencao() {
  const i = mpAuthLerIntencao();
  if (i) mpAuthMarcarIntencao(null);
  return i;
}

// ---------- controlo da janela ----------
function mpAuthAbrir(vista) {
  // O "voltar" do Android só é ligado quando a janela é usada, para não alterar
  // nada no arranque (o boot não acrescenta listeners nativos).
  mpLigarBotaoVoltar();
  mpShowLoginScreen(true);
  mpAuthMostrarVista(vista || 'login');
}

function mpAuthFechar() {
  // Fase 3: a janela é o portão. Sem sessão validada não se fecha — fechá-la
  // deixaria o utilizador à frente de um ecrã vazio (a área principal está
  // escondida por data-mp-locked).
  if (mpAcesso !== 'liberado') {
    mpSetLoginStatus('Entre com sua conta para usar o app.', true);
    return;
  }
  mpAuthLimparCampos();
  mpSetLoginStatus('');
  mpShowLoginScreen(false);
}

function mpAuthVistaEl(nome) {
  return document.getElementById('mpAuthView' + nome.charAt(0).toUpperCase() + nome.slice(1));
}

// `manterStatus` existe para o portão de acesso: a verificação de sessão em
// segundo plano não pode apagar uma mensagem que o utilizador está a ler
// (ex.: "Digite seu e-mail.") quando o arranque termina depois do clique.
function mpAuthMostrarVista(vista, manterStatus) {
  // 'checking', 'offline' e 'blocked' são vistas de sistema do portão de acesso.
  const vistas = ['login', 'signup', 'forgot', 'reset', 'checking', 'offline', 'blocked'];
  const alvo = vistas.indexOf(vista) !== -1 ? vista : 'login';
  mpAuthVistaAtual = alvo;
  vistas.forEach((v) => {
    const el = mpAuthVistaEl(v);
    if (el) el.style.display = (v === alvo) ? 'block' : 'none';
  });
  // Trocar de vista não pode arrastar senhas digitadas na vista anterior.
  mpAuthLimparCampos();
  if (!manterStatus) mpSetLoginStatus('');
  const nota = document.getElementById('mpAuthNote');
  const semNota = alvo === 'reset' || alvo === 'checking' || alvo === 'offline' || alvo === 'blocked';
  if (nota) nota.style.display = semNota ? 'none' : 'block';
  const foco = { login: 'mpAuthEmail', signup: 'mpSignupNome', forgot: 'mpForgotEmail', reset: 'mpResetSenha' }[alvo];
  if (!foco) return; // vistas de sistema não têm campo para focar
  setTimeout(() => {
    const el = document.getElementById(foco);
    if (el && typeof el.focus === 'function') { try { el.focus(); } catch (_) { /* WebView sem foco */ } }
  }, 60);
}

function mpAuthLimparCampos() {
  ['mpAuthSenha', 'mpSignupSenha', 'mpSignupSenha2', 'mpResetSenha', 'mpResetSenha2'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['mpSignupReq', 'mpResetReq'].forEach((id) => mpAuthPintarRequisitos(id, mpAuthPoliticaSenha('')));
}

// Mostrar/ocultar senha (essencial no telemóvel, onde errar é frequente).
function mpAuthVerSenha(btn) {
  const id = btn && btn.getAttribute('data-alvo');
  const input = id && document.getElementById(id);
  if (!input) return;
  const mostrar = input.type === 'password';
  input.type = mostrar ? 'text' : 'password';
  btn.textContent = mostrar ? '🙈' : '👁';
  btn.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
}

function mpAuthPintarRequisitos(listaId, politica) {
  const lista = document.getElementById(listaId);
  if (!lista || !lista.querySelectorAll) return;
  lista.querySelectorAll('li[data-req]').forEach((li) => {
    const chave = li.getAttribute('data-req');
    const cumpre = !!(politica && politica.regras && politica.regras[chave]);
    li.classList.toggle('ok', cumpre);
  });
}

// Atualiza a lista de requisitos enquanto o utilizador digita.
function mpAuthLigarRequisitos(inputId, listaId) {
  const input = document.getElementById(inputId);
  if (!input || input.__mpReqLigado) return;
  input.__mpReqLigado = true;
  const atualizar = () => mpAuthPintarRequisitos(listaId, mpAuthPoliticaSenha(input.value));
  input.addEventListener('input', atualizar);
  atualizar();
}

function mpAuthBotao(id, ocupado, textoOcupado, textoNormal) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = !!ocupado;
  if (ocupado && textoOcupado) {
    if (!btn.__mpTexto) btn.__mpTexto = btn.textContent;
    btn.textContent = textoOcupado;
  } else if (textoNormal) {
    btn.textContent = textoNormal;
  } else if (btn.__mpTexto) {
    btn.textContent = btn.__mpTexto;
  }
}

function mpAuthCampo(id) {
  const el = document.getElementById(id);
  return (el && el.value) || '';
}

// Liga os eventos de validação uma única vez (idempotente).
function mpAuthLigarEventos() {
  mpAuthLigarRequisitos('mpSignupSenha', 'mpSignupReq');
  mpAuthLigarRequisitos('mpResetSenha', 'mpResetReq');
}

// ---------- entrar com e-mail e senha ----------
async function mpLoginWithEmail() {
  if (!mpSupabase) {
    mpSetLoginStatus('Serviço indisponível — verifique a configuração.', true);
    return;
  }
  // Aceita os campos da janela atual e, por compatibilidade, os campos que
  // existiam dentro de Configurações → Conta & Nuvem.
  const emailEl = document.getElementById('mpAuthEmail') || document.getElementById('mpEmailInput');
  const passEl = document.getElementById('mpAuthSenha') || document.getElementById('mpPasswordInput');
  const email = ((emailEl && emailEl.value) || '').trim();
  const senha = (passEl && passEl.value) || '';

  if (!email) { mpSetLoginStatus('Digite seu e-mail.', true); if (emailEl) emailEl.focus(); return; }
  if (!mpAuthEmailValido(email)) { mpSetLoginStatus('E-mail inválido. Verifique e tente novamente.', true); if (emailEl) emailEl.focus(); return; }
  if (!senha) { mpSetLoginStatus('Digite sua senha.', true); if (passEl) passEl.focus(); return; }

  // Trava de cliques repetidos: um segundo toque não abre outro pedido.
  if (mpAuthEmCurso) { logEvent('info', 'Clique repetido ignorado durante autenticação', { acao: mpAuthEmCurso }); return; }
  mpAuthEmCurso = 'login';
  const btn = document.getElementById('mpBtnEmail');
  mpAuthBotao('mpBtnEmail', true, 'Entrando…');
  if (emailEl) emailEl.disabled = true;
  if (passEl) passEl.disabled = true;
  mpSetLoginStatus('Entrando…');
  try {
    const { data, error } = await mpSupabase.auth.signInWithPassword({ email, password: senha });
    if (error) throw error;
    mpSession = data.session;
    if (passEl) passEl.value = '';
    mpSetLoginStatus('');
    mpApplySessionUI();
    mpAuthFechar();
    mpNotify('Conectado! Sincronizando…');
    await mpReconcileSePuder();
  } catch (e) {
    logEvent('warn', 'Login por e-mail falhou', { message: String((e && e.message) || e) });
    mpSetLoginStatus(mpAuthMensagemErro(e), true);
  } finally {
    mpAuthEmCurso = null;
    mpAuthBotao('mpBtnEmail', false, null, 'Entrar');
    if (btn) btn.disabled = false;
    if (emailEl) emailEl.disabled = false;
    if (passEl) passEl.disabled = false;
  }
}

// ---------- criar conta ----------
async function mpSignupWithEmail() {
  if (!mpSupabase) {
    mpSetLoginStatus('Serviço indisponível — verifique a configuração.', true);
    return;
  }
  const nome = mpAuthCampo('mpSignupNome').trim();
  const email = mpAuthCampo('mpSignupEmail').trim();
  const senha = mpAuthCampo('mpSignupSenha');
  const senha2 = mpAuthCampo('mpSignupSenha2');

  if (!email) { mpSetLoginStatus('Digite seu e-mail.', true); return; }
  if (!mpAuthEmailValido(email)) { mpSetLoginStatus('E-mail inválido. Verifique e tente novamente.', true); return; }
  const politica = mpAuthPoliticaSenha(senha);
  if (!politica.ok) { mpSetLoginStatus(mpAuthMensagemFaltaSenha(politica), true); return; }
  if (senha !== senha2) { mpSetLoginStatus('As senhas não são iguais. Digite a mesma senha nos dois campos.', true); return; }
  if (nome.length > 80) { mpSetLoginStatus('O nome pode ter no máximo 80 caracteres.', true); return; }

  if (mpAuthEmCurso) { logEvent('info', 'Clique repetido ignorado durante autenticação', { acao: mpAuthEmCurso }); return; }
  mpAuthEmCurso = 'signup';
  mpAuthBotao('mpBtnSignup', true, 'Criando conta…');
  mpSetLoginStatus('Criando conta…');
  try {
    const opcoes = { emailRedirectTo: mpAuthRedirectTo() };
    if (nome) opcoes.data = { nome: nome };
    const { data, error } = await mpSupabase.auth.signUp({ email, password: senha, options: opcoes });
    if (error) throw error;

    const user = data && data.user;
    // O GoTrue (com confirmação de e-mail ativa) não diz se o e-mail já existe:
    // devolve um utilizador com a lista de identidades vazia. Não afirmar que a
    // conta foi criada nesse caso — informar o caminho sem enumerar contas.
    const jaExistia = !!(user && Array.isArray(user.identities) && user.identities.length === 0);

    ['mpSignupSenha', 'mpSignupSenha2'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    mpAuthPintarRequisitos('mpSignupReq', mpAuthPoliticaSenha(''));

    if (data && data.session && !jaExistia) {
      // Confirmação automática (não é o caso deste projeto, mas o fluxo cobre).
      mpSession = data.session;
      mpAuthFechar();
      mpNotify('Conta criada e conectada ☁️');
      mpApplySessionUI();
      await mpReconcileSePuder();
      return;
    }
    // Volta para o ecrã de entrada com o e-mail já preenchido. A mensagem é
    // escrita DEPOIS da troca de vista (que limpa o status).
    mpAuthMostrarVista('login');
    const emailLogin = document.getElementById('mpAuthEmail');
    if (emailLogin) emailLogin.value = email;
    if (jaExistia) {
      mpSetLoginStatus('Se este e-mail já tiver conta, use "Entrar" ou "Esqueci minha senha". ' +
        'Caso contrário, confira sua caixa de entrada para confirmar o cadastro.', false, 'ok');
    } else {
      mpSetLoginStatus('Conta criada! Enviamos um link de confirmação para ' + email +
        '. Abra o link para ativar sua conta e depois entre.', false, 'ok');
    }
  } catch (e) {
    logEvent('warn', 'Criação de conta falhou', { message: String((e && e.message) || e) });
    mpSetLoginStatus(mpAuthMensagemErro(e), true);
  } finally {
    mpAuthEmCurso = null;
    mpAuthBotao('mpBtnSignup', false, null, 'Criar conta');
  }
}

// ---------- esqueci a senha ----------
async function mpRequestPasswordReset() {
  if (!mpSupabase) {
    mpSetLoginStatus('Serviço indisponível — verifique a configuração.', true);
    return;
  }
  const email = mpAuthCampo('mpForgotEmail').trim();
  if (!email) { mpSetLoginStatus('Digite seu e-mail.', true); return; }
  if (!mpAuthEmailValido(email)) { mpSetLoginStatus('E-mail inválido. Verifique e tente novamente.', true); return; }

  if (mpAuthEmCurso) { logEvent('info', 'Clique repetido ignorado durante autenticação', { acao: mpAuthEmCurso }); return; }
  mpAuthEmCurso = 'forgot';
  mpAuthBotao('mpBtnForgot', true, 'Enviando…');
  mpSetLoginStatus('Enviando link…');
  try {
    // A intenção permite reconhecer, no retorno do link, que a sessão criada
    // é de recuperação e deve abrir o ecrã de nova senha (e não só entrar).
    mpAuthMarcarIntencao('recovery');
    const { error } = await mpSupabase.auth.resetPasswordForEmail(email, { redirectTo: mpAuthRedirectTo() });
    if (error) throw error;
    // Mensagem sempre igual: não revela se o e-mail tem conta.
    mpSetLoginStatus('Se este e-mail tiver conta, o link de recuperação chegará em instantes. ' +
      'Confira também a caixa de spam.', false, 'ok');
    const campo = document.getElementById('mpForgotEmail');
    if (campo) campo.value = '';
  } catch (e) {
    mpAuthMarcarIntencao(null);
    logEvent('warn', 'Pedido de recuperação falhou', { message: String((e && e.message) || e) });
    mpSetLoginStatus(mpAuthMensagemErro(e), true);
  } finally {
    mpAuthEmCurso = null;
    mpAuthBotao('mpBtnForgot', false, null, 'Enviar link de recuperação');
  }
}

// ---------- definir nova senha (sessão de recuperação) ----------
async function mpUpdatePassword() {
  if (!mpSupabase) {
    mpSetLoginStatus('Serviço indisponível — verifique a configuração.', true);
    return;
  }
  const senha = mpAuthCampo('mpResetSenha');
  const senha2 = mpAuthCampo('mpResetSenha2');
  const politica = mpAuthPoliticaSenha(senha);
  if (!politica.ok) { mpSetLoginStatus(mpAuthMensagemFaltaSenha(politica), true); return; }
  if (senha !== senha2) { mpSetLoginStatus('As senhas não são iguais. Digite a mesma senha nos dois campos.', true); return; }

  // O updateUser exige sessão. Sem ela o pedido é recusado pelo servidor, mas
  // aqui a mensagem certa só pode ser dada sabendo o estado local.
  if (!mpSession) {
    mpSetLoginStatus('O link de recuperação expirou ou já foi usado. Volte e solicite um novo link.', true);
    return;
  }

  if (mpAuthEmCurso) { logEvent('info', 'Clique repetido ignorado durante autenticação', { acao: mpAuthEmCurso }); return; }
  mpAuthEmCurso = 'reset';
  mpAuthBotao('mpBtnReset', true, 'Salvando…');
  mpSetLoginStatus('Salvando nova senha…');
  try {
    const { error } = await mpSupabase.auth.updateUser({ password: senha });
    if (error) throw error;
    mpAuthConsumirIntencao();
    ['mpResetSenha', 'mpResetSenha2'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    mpAuthPintarRequisitos('mpResetReq', mpAuthPoliticaSenha(''));
    mpSetLoginStatus('');
    mpAuthFechar();
    mpNotify('Senha alterada com sucesso 🔒');
    mpApplySessionUI();
    await mpReconcileSePuder();
  } catch (e) {
    logEvent('warn', 'Redefinição de senha falhou', { message: String((e && e.message) || e) });
    mpSetLoginStatus(mpAuthMensagemErro(e), true);
  } finally {
    mpAuthEmCurso = null;
    mpAuthBotao('mpBtnReset', false, null, 'Salvar nova senha');
  }
}

// Abre o ecrã de nova senha quando o retorno do link é de recuperação.
function mpAuthTratarRecuperacao() {
  mpAuthAbrir('reset');
  mpSetLoginStatus('Escolha uma nova senha para concluir a recuperação.', false, 'ok');
}

async function mpLogout() {
  try {
    if (mpSupabase) await mpSupabase.auth.signOut();
  } catch (e) {
    logEvent('warn', 'signOut falhou', { message: e.message });
  }
  mpSession = null;
  mpAcessoSemValidacao = false;
  // Logout encerra a sessão e volta ao login. Os dados financeiros do aparelho
  // NÃO são tocados: nenhuma chave mp_html_state_v8 / mp_backup_v8_* é removida.
  // Também não fica nenhum "atalho" de acesso sem conta: a próxima abertura
  // volta a pedir credenciais.
  mpMostrarAcesso('login');
  mpUpdateAccountUI();
  mpSetSyncStatus('offline');
  mpNotify('Desconectado. Seus dados continuam neste aparelho.');
}

// Removido na Fase 3: o acesso exige conta. Mantido como no-op para que um
// index.html antigo em cache (service worker) não provoque erro de função.
function mpContinueOffline() {
  mpSetLoginStatus('O acesso agora exige uma conta. Entre com e-mail/senha ou Google.', true);
}

// ---------- sincronização (last-write-wins) ----------
function scheduleCloudSync(delay) {
  // Fase 3: sem acesso liberado não se agenda sincronização nenhuma.
  if (!mpSupabase || mpAcesso !== 'liberado' || mpAcessoSemValidacao) return;
  if (mpEstadoEhDemo()) return; // demonstração nunca sobe
  // Sem sessão mas com cliente e sem sync prévia: pode ser um aparelho que
  // recebeu um backup manual. Tenta uma vez (o pull decidirá sem risco).
  if (!mpSupabase) return;
  if (!mpSession) {
    if (localStorage.getItem(MPS_NEEDS_PULL_KEY) === '1') return; // já tentou
    localStorage.setItem(MPS_NEEDS_PULL_KEY, '1');
    clearTimeout(mpSyncTimer);
    mpSyncTimer = setTimeout(() => mpTrySilentPull(), delay || 4000);
    return;
  }
  clearTimeout(mpSyncTimer);
  mpSyncTimer = setTimeout(() => mpRunGuarded(mpPushCore), delay || 2500);
}

async function mpRunGuarded(fn) {
  if (mpSyncBusy) return;
  mpSyncBusy = true;
  mpSetSyncStatus('syncing');
  try {
    await fn();
  } finally {
    mpSyncBusy = false;
  }
}

async function mpPushCore() {
  // Fase 3: nenhum envio para a nuvem sem sessão validada, sem dono correto e
  // nunca com dados de demonstração. É a guarda única de saída de dados.
  if (!mpPodeSincronizar()) {
    logEvent('info', 'Envio para a nuvem bloqueado pelo portão de acesso', {
      acesso: mpAcesso, semValidacao: mpAcessoSemValidacao, demo: mpEstadoEhDemo()
    });
    return;
  }
  // updated_at é carimbado pelo TRIGGER no servidor (ver migration
  // 20261108_01): o relógio do telemóvel não decide quem ganha o conflito.
  // O valor devolvido é o do servidor, e é esse que guardamos como referência.
  const { data, error } = await mpSupabase
    .from('user_states')
    .upsert(
      { user_id: mpSession.user.id, state: state, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    .select('updated_at')
    .single();
  if (error) throw error;
  const stamp = (data && data.updated_at) ? data.updated_at : new Date().toISOString();
  localStorage.setItem(MP_SYNC_KEY, stamp);
  mpSetSyncStatus('synced');
  logEvent('info', 'Estado enviado para a nuvem', { updated_at: stamp });
}

// ---------- reconciliação segura ----------
// Data.parse devolve null quando o valor é vazio/inválido. Comparar strings
// como antes fazia: "" < qualquer data, então um aparelho com localStorage
// limpo SEMPRE adotava a nuvem — inclusive por cima de dados locais bons.
function mpParseTime(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function mpLocalHasData(st) {
  const s = st || {};
  return (s.shifts || []).length > 0 || (s.expenses || []).length > 0 ||
         (s.maintenance || []).length > 0;
}

// União por id. Nunca remove: a nuvem pode estar incompleta (push a meio,
// backup antigo) e substituir apagaria meses de histórico sem aviso.
function mpMergeLists(localArr, remoteArr) {
  const byId = new Map();
  (remoteArr || []).forEach(x => { if (x && x.id != null) byId.set(String(x.id), x); });
  let recuperados = 0;
  (localArr || []).forEach(x => {
    if (!x || x.id == null) return;
    const k = String(x.id);
    if (!byId.has(k)) { byId.set(k, x); recuperados++; }
  });
  return { lista: Array.from(byId.values()), recuperados };
}

function mpMergeStates(local, remote) {
  const out = JSON.parse(JSON.stringify(remote || {}));
  const campos = ['shifts', 'expenses', 'maintenance', 'recurring', 'installments'];
  let recuperados = 0;
  campos.forEach(c => {
    const r = mpMergeLists(local[c], out[c]);
    out[c] = r.lista;
    recuperados += r.recuperados;
  });
  // Veículo/combustível: fica o que tiver odómetro mais avançado (é o sinal
  // mais fiável de qual aparelho andou mais tempo com o app).
  const odoLocal = Number((local.vehicle || {}).odometer) || 0;
  const odoRemoto = Number((out.vehicle || {}).odometer) || 0;
  if (odoLocal > odoRemoto) {
    out.vehicle = local.vehicle;
    out.fuelSettings = local.fuelSettings;
  }
  return { estado: out, recuperados };
}

// Guarda uma cópia antes de adotar a nuvem: se a adoção for má, o histórico
// ainda está recuperável no próprio aparelho.
function mpBackupBeforePull() {
  try {
    localStorage.setItem(MP_BACKUP_PULL_KEY, JSON.stringify({
      at: new Date().toISOString(),
      state: state
    }));
    return true;
  } catch (e) {
    logEvent('warn', 'Backup pré-pull falhou (quota?)', { message: e.message });
    return false;
  }
}

function mpAdoptState(novo, motivo) {
  mpBackupBeforePull();
  state = novo;
  localStorage.setItem(MP_STATE_LS_KEY, JSON.stringify(state));
  if (typeof syncVehicleOdometer === 'function') syncVehicleOdometer();
  if (typeof render === 'function') render();
  logEvent('info', 'Estado adotado da nuvem', { motivo });
}

async function mpReconcile() {
  if (!mpSupabase || !mpSession) return;
  await mpRunGuarded(async () => {
    try {
      const { data: row, error } = await mpSupabase
        .from('user_states')
        .select('state, updated_at')
        .eq('user_id', mpSession.user.id)
        .maybeSingle();
      if (error) throw error;

      // Nuvem vazia → primeira sincronização: envia o local. Sempre seguro.
      if (!row) {
        await mpPushCore();
        mpNotify('Dados salvos na nuvem ☁️');
        return;
      }

      const remotoT = mpParseTime(row.updated_at);
      const lastSyncT = mpParseTime(localStorage.getItem(MP_SYNC_KEY));
      const localTemDados = mpLocalHasData(state);
      const remotoTemDados = mpLocalHasData(row.state);

      // Regras, por ordem de prioridade. Antes eram só duas comparações de
      // string, o que fazia um aparelho sem lastSync adotar a nuvem cegamente.
      if (!remotoTemDados && localTemDados) {
        // Nuvem sem histórico: nunca sobrescrever o local com vazio.
        await mpPushCore();
        mpNotify('Seus dados foram enviados para a nuvem ☁️');
        return;
      }

      if (localTemDados && lastSyncT === null) {
        // Primeira vez NESTE aparelho: não sabemos quem é mais novo.
        // Adota pela UNIÃO e preserva o local num backup.
        const { estado, recuperados } = mpMergeStates(state, row.state);
        mpAdoptState(estado, 'primeira-sync-uniao');
        if (recuperados > 0) {
          mpNotify(`${recuperados} registro(s) locais preservados na junção ☁️`);
        }
        await mpPushCore();
        return;
      }

      if (remotoT !== null && lastSyncT !== null && remotoT > lastSyncT) {
        // Nuvem realmente mais nova: une (não substitui) e mantém o local
        // de lado antes de qualquer perda.
        const { estado, recuperados } = mpMergeStates(state, row.state);
        mpAdoptState(estado, 'nuvem-mais-nova');
        localStorage.setItem(MP_SYNC_KEY, row.updated_at);
        mpSetSyncStatus('synced');
        mpNotify(recuperados > 0
          ? `Dados da nuvem ☁️ (${recuperados} do aparelho preservados)`
          : 'Dados restaurados da nuvem ☁️');
        return;
      }

      if (remotoT === null) {
        // Timestamp inválido na nuvem: não arriscar, empurra o local.
        await mpPushCore();
        return;
      }

      if (lastSyncT === null || remotoT < lastSyncT) {
        // Alterações locais mais recentes → envia
        await mpPushCore();
        return;
      }

      mpSetSyncStatus('synced');
    } catch (e) {
      logEvent('warn', 'Sincronização falhou (offline?)', { message: e.message });
      mpSetSyncStatus('offline');
    }
  });
}

// Restaurar o backup guardado antes de um pull (botão nas Configurações).
function mpRestorePrePullBackup() {
  const raw = localStorage.getItem(MP_BACKUP_PULL_KEY);
  if (!raw) {
    mpNotify('Não há cópia guardada para restaurar.', 'error');
    return false;
  }
  try {
    const bk = JSON.parse(raw);
    if (!bk || !bk.state) throw new Error('cópia vazia');
    mpAdoptState(migrateState(bk.state), 'restauro-manual');
    localStorage.removeItem(MP_SYNC_KEY); // força o próximo pull a unir
    mpNotify('Cópia anterior restaurada. Envie para a nuvem quando confirmar.');
    return true;
  } catch (e) {
    logEvent('error', 'Restauro do backup falhou', { message: e.message });
    mpNotify('Não foi possível restaurar a cópia.', 'error');
    return false;
  }
}

// Força a atualização do app: apaga as caches do service worker e recarrega.
// Existe porque o SW antigo servia JS do cache primeiro, deixando o
// utilizador preso a um build anterior (ex.: config.js a apontar para um
// projeto Supabase que já não resolve). NÃO toca nos dados do app —
// o estado vive em localStorage, não na Cache API.
async function mpForceUpdate() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    mpNotify('Versão atualizada. Recarregando…');
    setTimeout(() => window.location.reload(true), 600);
  } catch (e) {
    logEvent('error', 'Falha ao forçar atualização', { message: e.message });
    mpNotify('Não foi possível atualizar. Tente limpar os dados do site.', 'error');
  }
}

// Tentativa de recuperar o estado da nuvem quando o aparelho local está
// vazio e não há sessão ativa. Não pede login: se não houver sessão
// guardada, o supabase-js devolve null e nada acontece.
async function mpTrySilentPull() {
  if (!mpSupabase || mpSession) return;
  // Sem portão liberado não se busca nada da nuvem (nem para "adivinhar" dono).
  if (mpAcesso !== 'liberado' || mpAcessoSemValidacao) return;
  try {
    const { data } = await mpSupabase.auth.getSession();
    const s = data && data.session;
    if (!s) {
      logEvent('info', 'Sem sessao guardada — nada a recuperar da nuvem');
      return;
    }
    mpSession = s;
    mpApplySessionUI();
    await mpReconcileSePuder();
  } catch (e) {
    logEvent('warn', 'Pull silencioso falhou', { message: e.message });
  }
}

// ---------- boot ----------
mpInitSupabase();
// Liga a validação em tempo real da política de senha. O script é carregado no
// fim do <body>, por isso os campos já existem; se não existirem (testes com
// DOM mínimo), as funções simplesmente não encontram os elementos.
mpAuthLigarEventos();
