// MotoristaPro — Autenticação Supabase (Google) + sincronização em nuvem
// Requer: js/vendor/supabase.js, js/config.js, utils.js (logEvent), data.js (state/saveState/migrateState)
//
// Modelo: local-first. O app continua 100% funcional offline;
// com sessão ativa, o estado é sincronizado (last-write-wins por updated_at).

const MP_SYNC_KEY = 'mp_last_sync_v8';
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

// Retorno do Google (Android): com.pro.driver://oauth-callback?code=...
function mpRegisterDeepLink() {
  if (!mpIsNative() || !window.Capacitor || !Capacitor.Plugins || !Capacitor.Plugins.App) return;
  try {
    Capacitor.Plugins.App.addListener('appUrlOpen', async ({ url }) => {
      logEvent('info', 'Deep link recebido', { url });
      try {
        const u = new URL(url);
        const code = u.searchParams.get('code');
        if (code && mpSupabase) {
          const { error } = await mpSupabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          if (Capacitor.Plugins.Browser) {
            try { await Capacitor.Plugins.Browser.close(); } catch (_) {}
          }
        }
      } catch (e) {
        logEvent('error', 'Deep link OAuth falhou', { message: e.message });
        mpSetLoginStatus('Falha ao concluir login com Google.', true);
        // Não bloquear a app: o login é opcional (Configurações → Conta & Nuvem)
        mpShowLoginScreen(false);
      }
    });
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
    actionsEl.innerHTML = '<button type="button" class="btn btn-danger btn-sm" onclick="mpLogout()">Sair da conta</button>';
  } else {
    emailEl.textContent = 'Não conectado';
    actionsEl.innerHTML = '<button type="button" class="btn btn-primary btn-sm" onclick="mpLoginWithGoogle()">Entrar com Google</button>';
  }
}

// ---------- login / logout ----------
async function mpLoginWithGoogle() {
  if (!mpSupabase) {
    mpSetLoginStatus('Serviço indisponível — verifique a configuração.', true);
    return;
  }
  const btn = document.getElementById('mpBtnGoogle');
  if (btn) { btn.disabled = true; btn.classList.add('mp-login-btn--busy'); }
  try {
    const redirectTo = mpIsNative()
      ? window.MP_OAUTH_REDIRECT_NATIVE
      : (window.location.origin + window.location.pathname);
    const { data, error } = await mpSupabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: mpIsNative() }
    });
    if (error) throw error;
    if (mpIsNative() && window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser && data && data.url) {
      await Capacitor.Plugins.Browser.open({ url: data.url, presentationStyle: 'AUTO' });
      mpSetLoginStatus('Complete o login na janela do Google…');
    }
    // Em web, o próprio supabase-js redireciona (skipBrowserRedirect: false)
  } catch (e) {
    logEvent('error', 'Login Google falhou', { message: e.message });
    mpSetLoginStatus('Erro ao iniciar login: ' + e.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('mp-login-btn--busy'); }
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
  if (!mpSupabase || !mpSession) return;
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
  const now = new Date().toISOString();
  const { error } = await mpSupabase
    .from('user_states')
    .upsert({ user_id: mpSession.user.id, state: state, updated_at: now });
  if (error) throw error;
  localStorage.setItem(MP_SYNC_KEY, now);
  mpSetSyncStatus('synced');
  logEvent('info', 'Estado enviado para a nuvem');
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

      const lastSync = localStorage.getItem(MP_SYNC_KEY) || '';

      if (!row) {
        // Nuvem vazia → primeira sincronização: envia o estado local
        await mpPushCore();
        mpNotify('Dados salvos na nuvem ☁️');
        return;
      }

      if (String(row.updated_at) > lastSync) {
        // Nuvem mais nova que a última sincronização → adota
        state = migrateState(row.state);
        localStorage.setItem(MP_STATE_LS_KEY, JSON.stringify(state));
        if (typeof syncVehicleOdometer === 'function') syncVehicleOdometer();
        render();
        localStorage.setItem(MP_SYNC_KEY, row.updated_at);
        mpSetSyncStatus('synced');
        mpNotify('Dados restaurados da nuvem ☁️');
        logEvent('info', 'Pull da nuvem aplicado', { updated_at: row.updated_at });
      } else if (String(row.updated_at) < lastSync) {
        // Alterações locais mais recentes → envia
        await mpPushCore();
      } else {
        mpSetSyncStatus('synced');
      }
    } catch (e) {
      logEvent('warn', 'Sincronização falhou (offline?)', { message: e.message });
      mpSetSyncStatus('offline');
    }
  });
}

// ---------- boot ----------
mpInitSupabase();


