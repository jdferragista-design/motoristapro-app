# Correção do login com Google (PKCE) — relatório de implementação

Data: 2026-11-08 · Versão: 1.18.2 (versionCode 11802) · Base: `9bad2ea` (main) · Ponto de restauro: tag `pre-oauth-8b7986b`
Escopo autorizado: **apenas** Google OAuth em `www/js/auth.js` (+ testes). Nada de Supabase, RLS, tabelas, dados, e-mail/senha ou Google Cloud foi alterado.

---

## 1. Causa raiz (confirmada)

O cliente Supabase era criado **sem `flowType`**, logo usava o default do vendor: `implicit`.
No fluxo implícito o Google devolve os tokens **no fragmento** do URL:

```
com.pro.driver://oauth-callback#access_token=…&refresh_token=…&expires_in=3600
```

O código antigo fazia `new URL(url).searchParams.get('code')`. O fragmento **nunca** aparece em `searchParams` → `code` era sempre `null` → o bloco de troca nunca executava → o browser não fechava, a UI não mudava e não havia sessão. Provado empiricamente (jsdom + vendor real, pasta de sondagem já removida):

| Cliente | URL de retorno | `searchParams.get('code')` | Pedido a `/token` |
|---|---|---|---|
| sem `flowType` (implicit) | `…#access_token=…` | `null` | nenhum |
| `flowType: 'pkce'` | `…?code=…` | o código | `grant_type=pkce` com `code_verifier` de 112 caracteres |

Pormenor importante: **trocar só para PKCE não bastava**. O vendor resolve o `code_verifier` por um `flow_id` derivado de `window.location`; em Android o `window.location` não tem `?code=`, pelo que enviava `code_verifier: ""`. Por isso a correção trata o URL **recebido do deep link** e não depende do URL da janela.

---

## 2. Alterações

Ficheiros tocados: `www/js/auth.js` (implementação) e `tests/boot-smoke.js` (testes). Mais nada.

### `www/js/auth.js`

1. **`mpInitSupabase()`** — `flowType: 'pkce'` (com comentário a explicar o defeito). Mantidos `persistSession`, `autoRefreshToken`, `detectSessionInUrl`, `storageKey: 'mp_sb_auth_v1'` — inalterados.
2. **Bloco de retorno reescrito** (`mpOAuthJaUsado`, `mpOAuthUrlValida`, `mpTemVerificadorPkce`, `mpFecharBrowser`, `mpProcessarRetornoOAuth`, `mpTratarRetornoOAuth`):
   - lê `?code=` (PKCE) e chama `exchangeCodeForSession(code)`;
   - **verifica a presença do verificador PKCE antes de chamar o servidor** — se faltar, explica em português (“inicie o login novamente neste aparelho”) em vez de propagar um erro técnico do vendor;
   - deduplicação por código (`Set`, máx. 20) → entrega repetida do mesmo link é ignorada **sem novo pedido**;
   - valida esquema/host: só `com.pro.driver://oauth-callback`; qualquer outro é recusado;
   - trata `error=` devolvido pelo provedor (`access_denied`, …);
   - compatibilidade com o fluxo implícito antigo (`#access_token` + `#refresh_token` → `setSession`) **isolada** num bloco próprio, sem efeito no caminho PKCE;
   - `mpFecharBrowser()` é chamado em **todos** os desfechos (sucesso, duplicado, erro);
   - devolve um relatório (`{ok, modo, motivo, duplicado, erro}`) para ser testável.
3. **`mpRegisterDeepLink()`** — listener `appUrlOpen` **e** `App.getLaunchUrl()` para arranque a frio (o evento já passou antes de existir listener). Registado no arranque **e** novamente em `mpLoginWithGoogle()` antes de sair para o browser.
4. **Logs** — só motivo/modo/`updated_at`. Nunca `code`, `access_token`, `refresh_token` ou `code_verifier`; o URL do deep link deixou de ser logado (o código antigo fazia `logEvent('info','Deep link recebido',{url})` — isso era um segredo em log).
5. **UI (Configurações → Conta & Nuvem)** — o botão gerado ganhou `id="mpBtnGoogle"` (antes o estado de carregamento procurava esse id e não o encontrava, porque só existe no ecrã de login). Nova `mpSetGoogleBusy()` atua nos dois pontos de entrada. `mpLoginWithGoogle()` mostra: “Abrindo Google…” → “Aguardando autenticação…” → “Conectando conta…” → sucesso ou erro específico. O botão **não** volta a “Entrar com Google” enquanto o browser está aberto (`aguardando`), mas é sempre libertado no retorno, inclusive em erro. Se o plugin `Browser` não estiver disponível, recorre a `window.location.href` em vez de ficar preso em “Abrindo…”.

### `tests/boot-smoke.js`

Bloco novo com jsdom + **vendor real** (`js/vendor/supabase.js`) + `auth.js` real; só `fetch` e os plugins nativos são simulados. Nenhum teste fala com o GoTrue real — logo não há “sucesso de servidor” inventado.

---

## 3. Resultado dos testes

`npm test` → **117 ✅ / 0 ❌** (eram 92 antes desta fase; +25 asserções). `npm run android:verify` → **exit 0**. `npm run version:check` → 1.18.2 / 11802.

| # | Teste | Resultado |
|---|---|---|
| T1 | URL de autorização com `code_challenge` + método (caminho real do botão → `Browser.open`) | ✅ |
| T2 | `code_verifier` persistido; retorno `?code=` processado como `pkce` | ✅ (3 chaves, 112 chars) |
| T3 | `exchangeCodeForSession` envia `auth_code` **e** o verificador que estava guardado | ✅ |
| T4 | Sessão persistida em `localStorage` (`mp_sb_auth_v1`) com o utilizador | ✅ |
| T5 | Sessão recuperável após reabrir o app (novo cliente, mesmo storage) | ✅ |
| T6 | Logout **não** apaga turnos/despesas/manutenções/veículo; nada é enviado ao servidor para apagar | ✅ (5 asserções) |
| T7 | Login e-mail/senha intacto (`grant_type=password`, sessão, senha limpa, sem OAuth) | ✅ (4 asserções) |
| T8 | Deep link duplicado ignorado sem novo pedido | ✅ (`duplicado=true`, 0 pedidos) |
| T9 | Arranque a frio via `getLaunchUrl` conclui o login e persiste a sessão | ✅ |
| T10 | `npm test` | ✅ 117/0 |
| T11 | `npm run android:verify` | ✅ |

Extras (defesas que o diagnóstico mostrou serem necessárias):
- esquema/host diferente → recusado;
- `error=` do provedor → tratado e mostrado;
- falha na troca → reportada, **sem sessão inventada**;
- verificador ausente no aparelho → falha explicada **sem** pedido ao servidor;
- browser fechado em todos os desfechos (6 fechos contados).

Três erros reais encontrados **pelos próprios testes** e corrigidos:
1. `URL` sombreado no ficheiro de testes (é o endereço do servidor local) → construtor global explícito;
2. o supabase-js guarda valores em JSON, logo o verificador semeado tem de ser `JSON.stringify(...)` (sem isso o arranque a frio falhava — exatamente o cenário “verificador não encontrado”);
3. `finally` repunha o botão durante a espera do Google.

---

## 4. O que NÃO mudou

- `mpLoginWithEmail()`: **byte a byte igual** (o diff não a toca). T7 prova o comportamento.
- URL/chave do Supabase, `config.js`, `capacitor.config.json`, `AndroidManifest.xml`, service worker: intocados.
- Nenhuma escrita no Supabase: sem migrations, sem DDL, sem alteração de RLS, tabelas, utilizadores ou dados. O único tráfego de rede é o que o app já fazia (`/auth/v1/token`, `user_states`).
- Histórico financeiro: T6 prova que o logout não o apaga (memória + storage) e que nada é enviado para apagar.
- Sem segredos em log (verificado por grep).

---

## 5. Pendências de teste manual (não declaradas como aprovadas)

1. **Teste em aparelho Android real — NÃO REALIZADO.** Sem JDK/SDK no sandbox (`dl.google.com`, `objects.githubusercontent.com` bloqueados) e sem APK autorizado. É o único passo que valida o ciclo completo: browser do sistema → Google → intent `com.pro.driver://oauth-callback` → sessão.
2. **Troca real do código contra o GoTrue.** TLS para `*.supabase.co` falha no sandbox (`SSL_ERROR_SYSCALL`). Os testes provam o que o **código envia**, não que o servidor aceite.
3. Confirmar no aparelho que o Google devolve `?code=` (e não `#access_token=`): é o sinal de que o PKCE está ativo no cliente instalado.
4. Confirmar que, após reinstalar o app, o erro é o texto amigável (“inicie o login novamente neste aparelho”).
5. `npx cap copy android` já executado: `www/js/auth.js` e `android/app/src/main/assets/public/js/auth.js` estão iguais (verificado por `diff`).

Rollback: `git reset --hard pre-oauth-8b7986b`.

---

## 6. Diff completo

### `www/js/auth.js`
```diff
diff --git a/www/js/auth.js b/www/js/auth.js
index 7f0e86d..cce6b33 100644
--- a/www/js/auth.js
+++ b/www/js/auth.js
@@ -79,6 +79,12 @@ function mpInitSupabase() {
   try {
     mpSupabase = window.supabase.createClient(window.MP_SUPABASE_URL, window.MP_SUPABASE_ANON_KEY, {
       auth: {
+        // PKCE: o retorno do Google traz ?code=… e o token só é emitido depois
+        // de o app provar que iniciou o fluxo (code_verifier). Com o default
+        // 'implicit' o retorno trazia #access_token=… no fragmento, que o
+        // deep link do Android não entregava a searchParams.get('code') — o
+        // login terminava sem sessão (ver DIAGNOSTICO-GOOGLE-OAUTH.md).
+        flowType: 'pkce',
         persistSession: true,
         autoRefreshToken: true,
         detectSessionInUrl: true,
@@ -115,29 +121,186 @@ function mpInitSupabase() {
   return mpSupabase;
 }
 
-// Retorno do Google (Android): com.pro.driver://oauth-callback?code=...
+// ---------- retorno do Google (Android) ----------
+// O app é aberto por com.pro.driver://oauth-callback?code=… (fluxo PKCE).
+// Regras aprendidas com o defeito anterior (DIAGNOSTICO-GOOGLE-OAUTH.md):
+//  - o código pode chegar na query (?code=) ou, em builds antigos do fluxo
+//    implícito, no fragmento (#access_token=…). O fragmento NUNCA aparece em
+//    searchParams, era exatamente aí que o login morria;
+//  - o mesmo link pode ser entregue mais de uma vez (reabertura, duplicação
+//    do intent): o código tem de ser consumido uma única vez;
+//  - o browser tem de fechar sempre, com sucesso ou com erro;
+//  - nunca registar em log o code, o access_token, o refresh_token ou o
+//    verificador PKCE.
+
+// Deduplicação por código. Não guarda mais de 20 para não crescer sem limite.
+const MP_OAUTH_USADOS = new Set();
+function mpOAuthJaUsado(chave) {
+  if (!chave) return false;
+  if (MP_OAUTH_USADOS.has(chave)) return true;
+  MP_OAUTH_USADOS.add(chave);
+  if (MP_OAUTH_USADOS.size > 20) MP_OAUTH_USADOS.delete(MP_OAUTH_USADOS.values().next().value);
+  return false;
+}
+
+// Só aceita o nosso esquema/host: com.pro.driver://oauth-callback
+function mpOAuthUrlValida(url) {
+  try {
+    const u = new URL(url);
+    return u.protocol === 'com.pro.driver:' && u.host === 'oauth-callback';
+  } catch (_) {
+    return false;
+  }
+}
+
+// O verificador PKCE é escrito pelo supabase-js no arranque do fluxo (chaves
+// "<storageKey>-code-verifier" e "<storageKey>-flow-<id>-code-verifier").
+// Sem ele o exchange falha sempre — é melhor dizer isso ao utilizador do que
+// deixar o vendor devolver um erro técnico.
+function mpTemVerificadorPkce() {
+  try {
+    const chave = (mpSupabase && mpSupabase.auth && mpSupabase.auth.storageKey) || 'mp_sb_auth_v1';
+    for (let i = 0; i < localStorage.length; i++) {
+      const k = localStorage.key(i);
+      if (k && k.indexOf(chave) === 0 && k.indexOf('code-verifier') !== -1) {
+        if (localStorage.getItem(k)) return true;
+      }
+    }
+  } catch (_) { /* storage indisponível (modo privado): deixa o vendor decidir */ }
+  return false;
+}
+
+async function mpFecharBrowser() {
+  try {
+    if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser) {
+      await Capacitor.Plugins.Browser.close();
+    }
+  } catch (_) { /* o browser pode já estar fechado */ }
+}
+
+// Processa um URL de retorno. Devolve um relatório para poder ser testado.
+// modo: 'pkce' (code) | 'implicit' (tokens no fragmento, compatibilidade)
+async function mpProcessarRetornoOAuth(url) {
+  const relatorio = { ok: false, modo: null, motivo: null, duplicado: false, erro: null };
+  if (!url) { relatorio.motivo = 'url vazia'; return relatorio; }
+  if (!mpOAuthUrlValida(url)) { relatorio.motivo = 'esquema/host inesperado'; return relatorio; }
+  if (!mpSupabase) { relatorio.motivo = 'cliente Supabase indisponível'; return relatorio; }
+
+  let u;
+  try { u = new URL(url); } catch (_) { relatorio.motivo = 'url inválida'; return relatorio; }
+
+  // O GoTrue devolve erros explicitamente: não os ignorar.
+  const erroDevolvido = u.searchParams.get('error') ||
+    new URLSearchParams((u.hash || '').replace(/^#/, '')).get('error');
+  if (erroDevolvido) {
+    relatorio.motivo = 'o provedor devolveu um erro';
+    relatorio.erro = erroDevolvido;
+    return relatorio;
+  }
+
+  const paramsHash = new URLSearchParams((u.hash || '').replace(/^#/, ''));
+  const code = u.searchParams.get('code');
+  const accessToken = paramsHash.get('access_token');
+
+  if (code) {
+    relatorio.modo = 'pkce';
+    if (mpOAuthJaUsado('code:' + code)) { relatorio.duplicado = true; relatorio.motivo = 'código já processado'; return relatorio; }
+    // O código só é trocável com o verificador do MESMO aparelho/instalação.
+    // Verificar antes evita um pedido condenado a falhar.
+    if (!mpTemVerificadorPkce()) {
+      relatorio.motivo = 'verificador PKCE ausente neste aparelho';
+      relatorio.erro = 'inicie o login novamente neste aparelho';
+      return relatorio;
+    }
+    try {
+      const { data, error } = await mpSupabase.auth.exchangeCodeForSession(code);
+      if (error) throw error;
+      if (!data || !data.session) throw new Error('sem sessão devolvida');
+      relatorio.ok = true;
+      return relatorio;
+    } catch (e) {
+      relatorio.motivo = 'falha ao trocar o código';
+      relatorio.erro = String((e && e.message) || e);
+      // O código pode ter sido consumido: não tentar de novo com o mesmo.
+      return relatorio;
+    }
+  }
+
+  if (accessToken) {
+    // Compatibilidade com o fluxo implícito antigo (tokens no fragmento).
+    // Isolado e sem efeito no caminho PKCE.
+    relatorio.modo = 'implicit';
+    const refreshToken = paramsHash.get('refresh_token');
+    if (!refreshToken) { relatorio.motivo = 'token sem refresh_token'; return relatorio; }
+    if (mpOAuthJaUsado('token:' + accessToken)) { relatorio.duplicado = true; relatorio.motivo = 'tokens já processados'; return relatorio; }
+    try {
+      const { data, error } = await mpSupabase.auth.setSession({
+        access_token: accessToken, refresh_token: refreshToken
+      });
+      if (error) throw error;
+      if (!data || !data.session) throw new Error('sem sessão devolvida');
+      relatorio.ok = true;
+      return relatorio;
+    } catch (e) {
+      relatorio.motivo = 'falha ao adotar os tokens';
+      relatorio.erro = String((e && e.message) || e);
+      return relatorio;
+    }
+  }
+
+  relatorio.motivo = 'sem code nem tokens no retorno';
+  return relatorio;
+}
+
+// Trata o retorno de ponta a ponta: processa, fecha o browser e atualiza a UI.
+async function mpTratarRetornoOAuth(url) {
+  mpSetLoginStatus('Conectando conta…');
+  const r = await mpProcessarRetornoOAuth(url);
+  await mpFecharBrowser();
+
+  if (r.ok) {
+    mpSetLoginStatus('');
+    // onAuthStateChange já faz o resto (sessão, UI, reconciliação). Aqui só
+    // garantimos o estado caso o evento chegue depois.
+    mpSetGoogleBusy(false, 'Entrar com Google');
+    if (typeof mpApplySessionUI === 'function') mpApplySessionUI();
+    mpUpdateAccountUI();
+    mpNotify('Login com Google concluído ☁️');
+  } else if (r.duplicado) {
+    // Entrega repetida do mesmo link: não é erro para o utilizador.
+    logEvent('info', 'Retorno OAuth repetido ignorado', { motivo: r.motivo });
+    mpSetLoginStatus('');
+  } else {
+    // Não registar o código nem os tokens: só o motivo.
+    logEvent('error', 'Retorno OAuth falhou', { motivo: r.motivo, erro: r.erro, modo: r.modo });
+    mpSetLoginStatus('Falha ao concluir login com Google' + (r.erro ? ': ' + r.erro : '.'), true);
+    mpSetGoogleBusy(false, 'Entrar com Google');
+    mpUpdateAccountUI();
+  }
+  return r;
+}
+
+// Registar o listener ANTES de qualquer login (arranque a frio incluído).
 function mpRegisterDeepLink() {
   if (!mpIsNative() || !window.Capacitor || !Capacitor.Plugins || !Capacitor.Plugins.App) return;
   try {
-    Capacitor.Plugins.App.addListener('appUrlOpen', async ({ url }) => {
-      logEvent('info', 'Deep link recebido', { url });
-      try {
-        const u = new URL(url);
-        const code = u.searchParams.get('code');
-        if (code && mpSupabase) {
-          const { error } = await mpSupabase.auth.exchangeCodeForSession(code);
-          if (error) throw error;
-          if (Capacitor.Plugins.Browser) {
-            try { await Capacitor.Plugins.Browser.close(); } catch (_) {}
-          }
-        }
-      } catch (e) {
-        logEvent('error', 'Deep link OAuth falhou', { message: e.message });
-        mpSetLoginStatus('Falha ao concluir login com Google.', true);
-        // Não bloquear a app: o login é opcional (Configurações → Conta & Nuvem)
-        mpShowLoginScreen(false);
-      }
+    Capacitor.Plugins.App.addListener('appUrlOpen', ({ url }) => {
+      // Nunca logar o URL completo: contém o códigos e/ou tokens.
+      logEvent('info', 'Deep link OAuth recebido');
+      mpTratarRetornoOAuth(url);
     });
+
+    // Arranque a frio: se o app foi ABERTO pelo link, o evento appUrlOpen já
+    // passou antes de existir listener. getLaunchUrl() devolve-o aqui.
+    if (typeof Capacitor.Plugins.App.getLaunchUrl === 'function') {
+      Capacitor.Plugins.App.getLaunchUrl().then((res) => {
+        const url = res && res.url;
+        if (url && mpOAuthUrlValida(url)) {
+          logEvent('info', 'App aberto por deep link OAuth (arranque a frio)');
+          mpTratarRetornoOAuth(url);
+        }
+      }).catch(() => { /* não é fatal: o login continua disponível pelo botão */ });
+    }
   } catch (e) {
     logEvent('warn', 'Não foi possível registar deep link', { message: e.message });
   }
@@ -163,8 +326,11 @@ function mpUpdateAccountUI() {
       '<button type="button" class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="mpRestorePrePullBackup()">Restaurar cópia anterior</button>';
   } else {
     emailEl.textContent = 'Não conectado';
+    // O botão Google tem de existir também aqui: antes o estado de carregamento
+    // procurava #mpBtnGoogle (que só existe no ecrã de login, oculto neste
+    // fluxo), pelo que nunca havia feedback ao tocar em Configurações.
     actionsEl.innerHTML =
-      '<button type="button" class="btn btn-primary btn-sm" onclick="mpLoginWithGoogle()">Entrar com Google</button>' +
+      '<button type="button" class="btn btn-primary btn-sm" id="mpBtnGoogle" onclick="mpLoginWithGoogle()">Entrar com Google</button>' +
       '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-sub);">' +
         '<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">ou entrar com email</div>' +
         '<input type="email" id="mpEmailInput" class="form-control" placeholder="seu@email.com" autocomplete="email" style="margin-bottom:6px;" />' +
@@ -174,14 +340,30 @@ function mpUpdateAccountUI() {
   }
 }
 
+// Estado visual do botão Google — funciona nos dois pontos de entrada
+// (ecrã de login e Configurações → Conta & Nuvem).
+function mpSetGoogleBusy(ocupado, texto) {
+  ['mpBtnGoogle', 'mpBtnGoogleLogin'].forEach((id) => {
+    const b = document.getElementById(id);
+    if (!b) return;
+    b.disabled = !!ocupado;
+    b.classList.toggle('mp-login-btn--busy', !!ocupado);
+    if (texto) b.textContent = texto;
+  });
+}
+
 // ---------- login / logout ----------
 async function mpLoginWithGoogle() {
   if (!mpSupabase) {
     mpSetLoginStatus('Serviço indisponível — verifique a configuração.', true);
     return;
   }
-  const btn = document.getElementById('mpBtnGoogle');
-  if (btn) { btn.disabled = true; btn.classList.add('mp-login-btn--busy'); }
+  // Fica true enquanto o utilizador está no ecrã do Google: nesse estado o
+  // botão NÃO deve voltar a "Entrar com Google" (o finally não o repõe).
+  let aguardando = false;
+  // Garante o listener do retorno antes de sair para o navegador.
+  mpRegisterDeepLink();
+  mpSetGoogleBusy(true, 'Abrindo Google…');
   try {
     const redirectTo = mpIsNative()
       ? window.MP_OAUTH_REDIRECT_NATIVE
@@ -191,16 +373,31 @@ async function mpLoginWithGoogle() {
       options: { redirectTo, skipBrowserRedirect: mpIsNative() }
     });
     if (error) throw error;
-    if (mpIsNative() && window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser && data && data.url) {
-      await Capacitor.Plugins.Browser.open({ url: data.url, presentationStyle: 'AUTO' });
-      mpSetLoginStatus('Complete o login na janela do Google…');
+    if (mpIsNative() && data && data.url) {
+      const temBrowser = !!(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser);
+      if (temBrowser) {
+        await Capacitor.Plugins.Browser.open({ url: data.url, presentationStyle: 'AUTO' });
+      } else {
+        // Plugin indisponível: sem isto o botão ficava "a abrir" para sempre.
+        window.location.href = data.url;
+      }
+      aguardando = true;
+      mpSetGoogleBusy(true, 'Aguardando autenticação…');
+      mpSetLoginStatus('Aguardando autenticação no Google…');
     }
     // Em web, o próprio supabase-js redireciona (skipBrowserRedirect: false)
   } catch (e) {
     logEvent('error', 'Login Google falhou', { message: e.message });
     mpSetLoginStatus('Erro ao iniciar login: ' + e.message, true);
+    await mpFecharBrowser();
   } finally {
-    if (btn) { btn.disabled = false; btn.classList.remove('mp-login-btn--busy'); }
+    // Só repõe o botão se o browser não ficou aberto à espera do Google; se
+    // ficou, o estado "Aguardando autenticação…" mantém-se até o deep link
+    // chegar (mpTratarRetornoOAuth liberta-o em qualquer desfecho).
+    if (!aguardando) {
+      mpSetGoogleBusy(false, 'Entrar com Google');
+      mpUpdateAccountUI();
+    }
   }
 }
 
@@ -527,5 +724,3 @@ async function mpTrySilentPull() {
 
 // ---------- boot ----------
 mpInitSupabase();
-
-
```

### `tests/boot-smoke.js`
```diff
diff --git a/tests/boot-smoke.js b/tests/boot-smoke.js
index 8f27b67..10931f9 100644
--- a/tests/boot-smoke.js
+++ b/tests/boot-smoke.js
@@ -64,8 +64,8 @@ server.listen(0, '127.0.0.1', () => {
     return norm(el.innerText !== undefined ? el.innerText : el.textContent);
   };
 
-  JSDOM.fromURL(URL, opts).then(dom => {
-    setTimeout(() => {
+  JSDOM.fromURL(URL, opts).then(async dom => {
+    setTimeout(async () => {
       const w = dom.window;
       const d = w.document;
       const g = id => d.getElementById(id);
@@ -83,7 +83,7 @@ server.listen(0, '127.0.0.1', () => {
 
       // Estado demo novo + período "tudo": painel e WhatsApp têm de coincidir
       JSDOM.fromURL(URL, opts).then(dom2 => {
-        setTimeout(() => {
+        setTimeout(async () => {
           const w2 = dom2.window;
           const d2 = w2.document;
           w2.mpFirstUse('demo');
@@ -660,6 +660,303 @@ server.listen(0, '127.0.0.1', () => {
           const foraDoSw = scriptsHtml.filter(s => !assetsSw.includes(s));
           check('SW: todos os scripts do index.html estão na lista offline', foraDoSw.length === 0, foraDoSw.join(', ') || 'nenhum em falta');
 
+          // ============================================================
+          // GOOGLE OAUTH (PKCE) — T1 a T9
+          // ------------------------------------------------------------
+          // NOTA DE HONESTIDADE: estes testes usam o vendor real do app
+          // (supabase-js) mas com fetch substituído. Verificam o que o CÓDIGO
+          // envia (desafio PKCE, code_verifier, troca do código, deduplicação),
+          // não que o GoTrue aceite a troca. Isso exige rede e aparelho, e está
+          // listado como teste pendente no relatório.
+          // ============================================================
+          const pkce = (() => {
+            // janela limpa, só com o vendor + o auth.js real do app
+            const janela = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>', {
+              url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true
+            }).window;
+
+            const pedidos = [];
+            let respostaToken = { ok: true, status: 200 };
+            janela.eval(`
+              window.__pedidos = [];
+              window.__respostaToken = null;
+              window.fetch = async (url, opts) => {
+                const u = String(url);
+                window.__pedidos.push({ url: u, body: opts && opts.body });
+                const falha = window.__respostaToken;
+                if (u.includes('grant_type=pkce') || u.includes('/token')) {
+                  if (falha) {
+                    return { ok: false, status: 400, headers: { get: () => 'application/json' },
+                      json: async () => ({ error: 'invalid_grant', error_description: falha }), text: async () => '' };
+                  }
+                  return { ok: true, status: 200, headers: { get: () => 'application/json' },
+                    json: async () => ({ access_token: 'AT', refresh_token: 'RT', token_type: 'bearer',
+                                        expires_in: 3600, user: { id: 'u-1', email: 'a@b.c' } }),
+                    text: async () => '' };
+                }
+                return { ok: true, status: 200, headers: { get: () => 'application/json' },
+                  json: async () => ({}), text: async () => '' };
+              };
+              // plugins nativos simulados (Browser sempre disponível)
+              window.__browserAberto = []; window.__browserFechado = 0;
+              window.__listeners = {};
+              window.Capacitor = {
+                isNativePlatform: () => true,
+                Plugins: {
+                  Browser: {
+                    open: async ({ url }) => { window.__browserAberto.push(url); },
+                    close: async () => { window.__browserFechado++; }
+                  },
+                  App: {
+                    addListener: (evento, cb) => { (window.__listeners[evento] = window.__listeners[evento] || []).push(cb); },
+                    getLaunchUrl: async () => window.__launchUrl ? { url: window.__launchUrl } : undefined
+                  }
+                }
+              };
+            `);
+
+            // dependências mínimas que o auth.js usa (state/saveState/render ficam de fora)
+            janela.eval(`
+              window.state = { shifts: [], expenses: [], maintenance: [] };
+              window.logEvent = function () {};
+              window.mpNotify = function () {};
+              window.mpReconcile = async function () { window.__reconcileados = (window.__reconcileados||0)+1; };
+              window.mpApplySessionUI = function () {};
+              window.MP_SUPABASE_URL = 'https://projeto.supabase.co';
+              window.MP_SUPABASE_ANON_KEY = 'sb_publishable_teste';
+              window.MP_OAUTH_REDIRECT_NATIVE = 'com.pro.driver://oauth-callback';
+            `);
+
+            // carregar o vendor e o auth.js REAIS
+            janela.eval(fs.readFileSync(path.join(WWW, 'js/vendor/supabase.js'), 'utf8'));
+            // o auth.js referencia elementos do DOM que não existem aqui: os
+            // acessos são todos guardados por if (el), por isso não parte.
+            janela.eval(fs.readFileSync(path.join(WWW, 'js/auth.js'), 'utf8'));
+            return { janela, pedidos };
+          })();
+          const wPkce = pkce.janela;
+
+          // T1 — o caminho REAL do botão: mpLoginWithGoogle() tem de produzir
+          // uma URL de autorização com desafio PKCE e abri-la no browser.
+          // (Não se usa mpSupabase diretamente: é uma variável `let` interna
+          // do script e o jsdom não a expõe entre avaliações. O comportamento
+          // observado é o que o utilizador provoca ao tocar no botão.)
+          await wPkce.eval(`mpLoginWithGoogle()`);
+          const urlAuth = (wPkce.__browserAberto || [])[0] || '';
+          check('T1 Google: URL de autorização inclui code_challenge e método', (() => {
+            try {
+              // NOTA: neste ficheiro a variável URL é o endereço do servidor
+              // de teste; usa-se o construtor global explicitamente.
+              const u = new (require('url').URL)(urlAuth);
+              return u.searchParams.get('code_challenge') !== null &&
+                     ['s256', 'plain'].includes((u.searchParams.get('code_challenge_method') || '').toLowerCase());
+            } catch (_) { return false; }
+          })(), String(urlAuth).replace(/code_challenge=[^&]+/, 'code_challenge=…').slice(0, 140));
+
+          // o verificador ficou persistido no storage do cliente
+          const chavesVerifier = Object.keys(wPkce.localStorage).filter(k => k.includes('code-verifier'));
+          check('T2 Google: code_verifier persistido no storage do cliente', chavesVerifier.length > 0, chavesVerifier.length + ' chave(s)');
+
+          // T2/T3 — retorno com ?code=: o verificador correto tem de ser enviado
+          const antesToken = (wPkce.__pedidos || []).length;
+          const r1 = await wPkce.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-1')`);
+          const pedidoToken = (wPkce.__pedidos || []).slice(antesToken).find(p => p.url.includes('grant_type=pkce'));
+          let corpo = null;
+          try { corpo = JSON.parse(pedidoToken.body); } catch (_) {}
+          check('T2 Google: retorno com ?code= processado como PKCE', r1.ok === true && r1.modo === 'pkce');
+          check('T3 Google: exchangeCodeForSession enviou auth_code e code_verifier não vazio',
+            !!corpo && corpo.auth_code === 'CODIGO-1' && typeof corpo.code_verifier === 'string' && corpo.code_verifier.length > 20,
+            corpo ? ('verifier de ' + String(corpo.code_verifier || '').length + ' caracteres') : 'sem pedido /token');
+          check('T3 Google: o verificador enviado é o que estava guardado', (() => {
+            if (!corpo) return false;
+            const guardados = Object.keys(wPkce.localStorage)
+              .filter(k => k.includes('code-verifier'))
+              .map(k => wPkce.localStorage.getItem(k))
+              .join('|');
+            return guardados.includes(corpo.code_verifier);
+          })());
+
+          // T4 — sessão persistida no storage
+          const chaveSessao = wPkce.localStorage.getItem('mp_sb_auth_v1');
+          check('T4 Google: sessão persistida em localStorage (mp_sb_auth_v1)', !!chaveSessao && /access_token/.test(chaveSessao || ''));
+          check('T4 Google: a sessão traz o utilizador autenticado', (() => {
+            try { return JSON.parse(chaveSessao).user.id === 'u-1'; } catch (_) { return false; }
+          })());
+
+          // T5 — reinicialização simulada: novo cliente, mesmo storage
+          check('T5 Google: sessão recuperável após reabrir o app (novo cliente, mesmo storage)', await wPkce.eval(`(async () => {
+            const c2 = supabase.createClient('https://projeto.supabase.co', 'sb_publishable_teste', {
+              auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: false,
+                      detectSessionInUrl: true, storageKey: 'mp_sb_auth_v1' }
+            });
+            const { data } = await c2.auth.getSession();
+            return !!(data && data.session && data.session.user && data.session.user.id === 'u-1');
+          })()`));
+
+          // T8 — deep link duplicado não volta a trocar o mesmo código
+          const antesDup = (wPkce.__pedidos || []).length;
+          const rDup = await wPkce.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-1')`);
+          const novosPedidos = (wPkce.__pedidos || []).length - antesDup;
+          check('T8 Google: retorno duplicado é ignorado sem novo pedido ao servidor',
+            rDup.duplicado === true && novosPedidos === 0, 'duplicado=' + rDup.duplicado + ', pedidos=' + novosPedidos);
+
+          // esquema/host errados não são processados
+          const rEsquema = await wPkce.eval(`mpTratarRetornoOAuth('evil://oauth-callback?code=OUTRO')`);
+          const rHost = await wPkce.eval(`mpTratarRetornoOAuth('com.pro.driver://outro-host?code=OUTRO2')`);
+          check('Google: esquema ou host diferente é recusado',
+            rEsquema.ok === false && rHost.ok === false && /esquema/.test(rEsquema.motivo));
+
+          // erro devolvido pelo provedor é tratado, não ignorado
+          const rErroProv = await wPkce.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?error=access_denied')`);
+          check('Google: erro do provedor é tratado e mostrado', rErroProv.ok === false && /provedor/.test(rErroProv.motivo));
+
+          // falha na troca (sem rede / código inválido) não cria sessão falsa
+          wPkce.eval(`window.__respostaToken = 'invalid grant'`);
+          const rFalha = await wPkce.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-FALHA')`);
+          check('Google: falha na troca do código é reportada (sem sessão inventada)',
+            rFalha.ok === false && /trocar o código/.test(rFalha.motivo), rFalha.erro || '');
+          wPkce.eval(`window.__respostaToken = null`);
+
+          // Verificador em falta (ex.: app reinstalado, storage limpo): o código
+          // não é trocável. Tem de ser detetado ANTES de incomodar o servidor.
+          wPkce.eval(`Object.keys(localStorage).filter(k => k.indexOf('code-verifier') !== -1)
+            .forEach(k => localStorage.removeItem(k))`);
+          const antesSemVerif = (wPkce.__pedidos || []).length;
+          const rSemVerif = await wPkce.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-SEM-VERIFICADOR')`);
+          check('Google: sem verificador no aparelho a falha é explicada e não há pedido ao servidor',
+            rSemVerif.ok === false && /verificador PKCE ausente/.test(rSemVerif.motivo) &&
+            (wPkce.__pedidos || []).length === antesSemVerif,
+            rSemVerif.motivo || '');
+
+          // o browser é fechado em qualquer desfecho
+          check('Google: o browser é fechado após o processamento', wPkce.eval('window.__browserFechado') >= 2,
+            wPkce.eval('window.__browserFechado') + ' fecho(s)');
+
+          // T9 — arranque a frio: app aberto pelo link, listener registado depois
+          const janelaFria = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>', {
+            url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true
+          }).window;
+          janelaFria.eval(`
+            window.__pedidos = [];
+            window.fetch = async (u, o) => { window.__pedidos.push({ url: String(u), body: o && o.body });
+              return { ok: true, status: 200, headers: { get: () => 'application/json' },
+                json: async () => ({ access_token: 'AT', refresh_token: 'RT', token_type: 'bearer', expires_in: 3600,
+                                     user: { id: 'u-frio', email: 'f@rio' } }), text: async () => '' }; };
+            // O verificador é gravado pelo PRÓPRIO supabase-js ao iniciar o
+            // fluxo (signInWithOAuth). Num arranque a frio real ele já está no
+            // armazenamento persistente, porque o login foi iniciado nesta
+            // mesma instalação antes de o app ser fechado. Semeia-se com um
+            // valor fixo, sem nunca imprimir o do fluxo real.
+            window.__verifierFrio = 'verificador-frio-de-teste-0123456789';
+            // O supabase-js guarda os valores em JSON (JSON.stringify), por isso
+            // o verificador tem de ser semeado como string JSON — não em bruto.
+            localStorage.setItem('mp_sb_auth_v1-code-verifier', JSON.stringify(window.__verifierFrio));
+            window.__launchUrl = 'com.pro.driver://oauth-callback?code=CODIGO-FRIO';
+            window.Capacitor = { isNativePlatform: () => true, Plugins: {
+              Browser: { open: async () => {}, close: async () => {} },
+              App: { addListener: () => {}, getLaunchUrl: async () => ({ url: window.__launchUrl }) } } };
+            window.state = { shifts: [], expenses: [], maintenance: [] };
+            window.logEvent = function () {}; window.mpNotify = function () {};
+            window.mpReconcile = async function () {}; window.mpApplySessionUI = function () {};
+            window.MP_SUPABASE_URL = 'https://projeto.supabase.co';
+            window.MP_SUPABASE_ANON_KEY = 'sb_publishable_teste';
+            window.MP_OAUTH_REDIRECT_NATIVE = 'com.pro.driver://oauth-callback';
+          `);
+          janelaFria.eval(fs.readFileSync(path.join(WWW, 'js/vendor/supabase.js'), 'utf8'));
+          janelaFria.eval(fs.readFileSync(path.join(WWW, 'js/auth.js'), 'utf8'));
+          await new Promise(r => setTimeout(r, 60));
+          const pedidoFrio = (janelaFria.__pedidos || []).find(p => p.url.includes('grant_type=pkce'));
+          const corpoFrio = (() => { try { return JSON.parse(pedidoFrio.body); } catch (_) { return null; } })();
+          const sessaoFria = (() => { try { return JSON.parse(janelaFria.localStorage.getItem('mp_sb_auth_v1')); } catch (_) { return null; } })();
+          check('T9 Google: arranque a frio usa getLaunchUrl (pedido /token com o code do link)',
+            !!corpoFrio && corpoFrio.auth_code === 'CODIGO-FRIO');
+          check('T9 Google: arranque a frio conclui o login e persiste a sessão',
+            !!sessaoFria && sessaoFria.user && sessaoFria.user.id === 'u-frio' && !!sessaoFria.access_token);
+
+          // ============================================================
+          // T6 / T7 — o que NÃO podia mudar (regressões)
+          // ============================================================
+          const wLocal = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>', {
+            url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true
+          }).window;
+          wLocal.eval(`
+            window.__pedidos = [];
+            window.fetch = async (u, o) => {
+              window.__pedidos.push({ url: String(u), body: o && o.body });
+              const u2 = String(u);
+              if (u2.includes('grant_type=password')) {
+                return { ok: true, status: 200, headers: { get: () => 'application/json' },
+                  json: async () => ({ access_token: 'AT-E', refresh_token: 'RT-E', token_type: 'bearer',
+                                       expires_in: 3600, user: { id: 'u-email', email: 'e@mail' } }), text: async () => '' };
+              }
+              return { ok: true, status: 200, headers: { get: () => 'application/json' },
+                json: async () => ({}), text: async () => '' };
+            };
+            window.Capacitor = { isNativePlatform: () => true, Plugins: {
+              Browser: { open: async () => {}, close: async () => {} },
+              App: { addListener: () => {}, getLaunchUrl: async () => undefined } } };
+            window.state = { shifts: [], expenses: [], maintenance: [] };
+            window.logEvent = function () {}; window.mpNotify = function () {};
+            window.mpReconcile = async function () {}; window.mpApplySessionUI = function () {};
+            window.MP_SUPABASE_URL = 'https://projeto.supabase.co';
+            window.MP_SUPABASE_ANON_KEY = 'sb_publishable_teste';
+            window.MP_OAUTH_REDIRECT_NATIVE = 'com.pro.driver://oauth-callback';
+          `);
+          wLocal.eval(fs.readFileSync(path.join(WWW, 'js/vendor/supabase.js'), 'utf8'));
+          wLocal.eval(fs.readFileSync(path.join(WWW, 'js/auth.js'), 'utf8'));
+
+          // T6 — logout não apaga o histórico financeiro local
+          const historico = {
+            shifts: [{ id: 's1', date: '2026-11-01', km: 120, gross: 250, net: 180 }],
+            expenses: [{ id: 'e1', date: '2026-11-02', category: 'Combustível', value: 90 }],
+            maintenance: [{ id: 'm1', date: '2026-11-03', desc: 'Óleo', value: 120 }],
+            vehicle: { odometer: 54321 }, fuelSettings: { price: 5.89 }
+          };
+          const antesLogout = JSON.stringify(historico);
+          wLocal.eval(`
+            window.state = ${JSON.stringify(historico)};
+            localStorage.setItem('mp_html_state_v8', JSON.stringify(window.state));
+          `);
+          check('T6 logout: dados financeiros gravados antes do logout', JSON.stringify(wLocal.state) === antesLogout);
+          await wLocal.eval(`mpLogout()`);
+          check('T6 logout: histórico em memória intacto (turnos, despesas, manutenções)',
+            JSON.stringify(wLocal.state) === antesLogout,
+            'turnos=' + wLocal.state.shifts.length + ', despesas=' + wLocal.state.expenses.length +
+            ', manutenções=' + wLocal.state.maintenance.length);
+          check('T6 logout: histórico continua gravado no armazenamento local',
+            (() => {
+              try {
+                const s = JSON.parse(wLocal.localStorage.getItem('mp_html_state_v8'));
+                return s.shifts.length === 1 && s.expenses.length === 1 && s.maintenance.length === 1 &&
+                       s.vehicle.odometer === 54321;
+              } catch (_) { return false; }
+            })());
+          check('T6 logout: modo offline fica registado (não força novo login)',
+            wLocal.localStorage.getItem('mp_offline_mode_v8') === '1');
+          check('T6 logout: nada é enviado ao servidor para apagar dados',
+            !(wLocal.__pedidos || []).some(p => /DELETE|\/rest\/v1\/user_states/.test(p.url + ' ' + (p.body || ''))));
+
+          // T7 — login por email/senha continua a funcionar e usar o fluxo de senha
+          wLocal.document.body.innerHTML =
+            '<input id="mpEmailInput" value="e@mail"><input id="mpPasswordInput" value="segredo">' +
+            '<button id="mpBtnEmail"></button><div id="mpLoginStatus"></div><div id="mpNotify"></div>';
+          const antesEmail = (wLocal.__pedidos || []).length;
+          await wLocal.eval(`mpLoginWithEmail()`);
+          const pedidoSenha = (wLocal.__pedidos || []).slice(antesEmail).find(p => p.url.includes('grant_type=password'));
+          check('T7 email/senha: envia grant_type=password com email e senha',
+            !!pedidoSenha && (() => {
+              try { const b = JSON.parse(pedidoSenha.body); return b.email === 'e@mail' && b.password === 'segredo'; }
+              catch (_) { return false; }
+            })());
+          check('T7 email/senha: sessão criada e persistida', (() => {
+            try { return JSON.parse(wLocal.localStorage.getItem('mp_sb_auth_v1')).user.id === 'u-email'; }
+            catch (_) { return false; }
+          })());
+          check('T7 email/senha: campo da senha é limpo após entrar',
+            wLocal.document.getElementById('mpPasswordInput').value === '');
+          check('T7 email/senha: nenhum pedido OAuth foi disparado',
+            !(wLocal.__pedidos || []).some(p => /grant_type=pkce|\/authorize/.test(p.url)));
+
           // ============================================================
           // ANDROID — consistência dos assets e do APK (verificação estática)
           // ============================================================
```
