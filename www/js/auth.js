// MotoristaPro — Autenticação Supabase (Google) + sincronização em nuvem
// Requer: js/vendor/supabase.js, js/config.js, utils.js (logEvent), data.js (state/saveState/migrateState)
//
// Modelo: local-first. O app continua 100% funcional offline;
// com sessão ativa, o estado é sincronizado (last-write-wins por updated_at).

const MP_SYNC_KEY = 'mp_last_sync_v8';
const MP_BACKUP_PULL_KEY = 'mp_state_backup_before_pull_v8';
const MPS_NEEDS_PULL_KEY = 'mp_pull_attempted_v8';
const MP_OFFLINE_KEY = 'mp_offline_mode_v8';
const MP_STATE_LS_KEY = 'mp_html_state_v8';

let mpSupabase = null;
let mpSession = null;
let mpSyncTimer = null;
let mpSyncBusy = false;

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

function mpSetLoginStatus(msg, isError) {
  const el = document.getElementById('mpLoginStatus');
  if (el) {
    el.textContent = msg || '';
    el.className = 'mp-login-status' + (isError ? ' mp-login-status--error' : '');
    // O status nasceu no ecrã de login, que já não aparece no arranque.
    // Sem isto, um erro de login ficava invisível e parecia "não fazer nada".
    el.style.display = msg ? 'block' : 'none';
    const box = document.getElementById('mpAccountBoxStatus');
    if (box) {
      box.textContent = msg || '';
      box.className = 'mp-login-status' + (isError ? ' mp-login-status--error' : '');
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

  // Sessão existente (arranque / refresh)
  mpSupabase.auth.getSession().then(({ data }) => {
    mpSession = data.session || null;
    mpApplySessionUI();
    if (mpSession) mpReconcile();
  }).catch(e => logEvent('warn', 'getSession falhou', { message: e.message }));

  // Mudanças de sessão (login, logout, token refresh)
  mpSupabase.auth.onAuthStateChange((event, session) => {
    mpSession = session;
    if (event === 'SIGNED_IN') {
      localStorage.removeItem(MP_OFFLINE_KEY);
      mpSetLoginStatus('');
      mpNotify('Conectado! Sincronizando dados…');
    }
    mpApplySessionUI();
    if (event === 'SIGNED_IN' && mpSession) mpReconcile();
  });

  mpRegisterDeepLink();
  window.addEventListener('online', () => { if (mpSession) mpReconcile(); });
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

// Trata o retorno de ponta a ponta: processa, fecha o browser e atualiza a UI.
async function mpTratarRetornoOAuth(url) {
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

// Registar o listener ANTES de qualquer login (arranque a frio incluído).
function mpRegisterDeepLink() {
  if (!mpIsNative() || !window.Capacitor || !Capacitor.Plugins || !Capacitor.Plugins.App) return;
  try {
    Capacitor.Plugins.App.addListener('appUrlOpen', ({ url }) => {
      // Nunca logar o URL completo: contém o códigos e/ou tokens.
      logEvent('info', 'Deep link OAuth recebido');
      mpTratarRetornoOAuth(url);
    });

    // Arranque a frio: se o app foi ABERTO pelo link, o evento appUrlOpen já
    // passou antes de existir listener. getLaunchUrl() devolve-o aqui.
    if (typeof Capacitor.Plugins.App.getLaunchUrl === 'function') {
      Capacitor.Plugins.App.getLaunchUrl().then((res) => {
        const url = res && res.url;
        if (url && mpOAuthUrlValida(url)) {
          logEvent('info', 'App aberto por deep link OAuth (arranque a frio)');
          mpTratarRetornoOAuth(url);
        }
      }).catch(() => { /* não é fatal: o login continua disponível pelo botão */ });
    }
  } catch (e) {
    logEvent('warn', 'Não foi possível registar deep link', { message: e.message });
  }
}

function mpApplySessionUI() {
  const hasSession = !!mpSession;
  // Login nunca bloqueia a abertura: o app abre sempre direto (como antes).
  // O login Google é opcional e faz-se em Configurações → Conta & Nuvem.
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
      '<button type="button" class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="mpRestorePrePullBackup()">Restaurar cópia anterior</button>';
  } else {
    emailEl.textContent = 'Não conectado';
    // O botão Google tem de existir também aqui: antes o estado de carregamento
    // procurava #mpBtnGoogle (que só existe no ecrã de login, oculto neste
    // fluxo), pelo que nunca havia feedback ao tocar em Configurações.
    actionsEl.innerHTML =
      '<button type="button" class="btn btn-primary btn-sm" id="mpBtnGoogle" onclick="mpLoginWithGoogle()">Entrar com Google</button>' +
      '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-sub);">' +
        '<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">ou entrar com email</div>' +
        '<input type="email" id="mpEmailInput" class="form-control" placeholder="seu@email.com" autocomplete="email" style="margin-bottom:6px;" />' +
        '<input type="password" id="mpPasswordInput" class="form-control" placeholder="Senha" autocomplete="current-password" style="margin-bottom:6px;" />' +
        '<button type="button" class="btn btn-secondary btn-sm" id="mpBtnEmail" onclick="mpLoginWithEmail()">Entrar</button>' +
      '</div>';
  }
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
  // Garante o listener do retorno antes de sair para o navegador.
  mpRegisterDeepLink();
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

// ---------- login por email (alternativa ao Google) ----------
// Existe porque o Google OAuth exige um client no Google Cloud que o
// utilizador ainda não configurou. Com isto o sync pode ser testado hoje.
async function mpLoginWithEmail() {
  if (!mpSupabase) {
    mpSetLoginStatus('Serviço indisponível — verifique a configuração.', true);
    return;
  }
  const emailEl = document.getElementById('mpEmailInput');
  const passEl = document.getElementById('mpPasswordInput');
  const email = (emailEl && emailEl.value || '').trim();
  const senha = (passEl && passEl.value) || '';
  if (!email || !senha) {
    mpSetLoginStatus('Preencha email e senha.', true);
    return;
  }
  const btn = document.getElementById('mpBtnEmail');
  if (btn) btn.disabled = true;
  mpSetLoginStatus('Entrando…');
  try {
    const { data, error } = await mpSupabase.auth.signInWithPassword({ email, password: senha });
    if (error) throw error;
    mpSession = data.session;
    if (passEl) passEl.value = '';
    mpSetLoginStatus('');
    mpApplySessionUI();
    mpNotify('Conectado! Sincronizando…');
    await mpReconcile();
  } catch (e) {
    const msg = String(e.message || e);
    const amigavel = /invalid login credentials/i.test(msg)
      ? 'Email ou senha incorretos.'
      : (/email not confirmed/i.test(msg)
        ? 'Confirme o email antes de entrar.'
        : msg);
    logEvent('warn', 'Login por email falhou', { message: msg });
    mpSetLoginStatus(amigavel, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function mpLogout() {
  try {
    if (mpSupabase) await mpSupabase.auth.signOut();
  } catch (e) {
    logEvent('warn', 'signOut falhou', { message: e.message });
  }
  mpSession = null;
  localStorage.setItem(MP_OFFLINE_KEY, '1'); // não volta a forçar login
  mpApplySessionUI();
  mpNotify('Desconectado. Seus dados continuam neste aparelho.');
}

function mpContinueOffline() {
  localStorage.setItem(MP_OFFLINE_KEY, '1');
  mpShowLoginScreen(false);
  mpSetSyncStatus('offline');
}

// ---------- sincronização (last-write-wins) ----------
function scheduleCloudSync(delay) {
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
  try {
    const { data } = await mpSupabase.auth.getSession();
    const s = data && data.session;
    if (!s) {
      logEvent('info', 'Sem sessao guardada — nada a recuperar da nuvem');
      return;
    }
    mpSession = s;
    mpApplySessionUI();
    await mpReconcile();
  } catch (e) {
    logEvent('warn', 'Pull silencioso falhou', { message: e.message });
  }
}

// ---------- boot ----------
mpInitSupabase();
