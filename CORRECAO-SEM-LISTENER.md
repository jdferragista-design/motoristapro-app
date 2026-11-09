# Correção final — Google OAuth bloqueado sem listener de retorno confirmado

**Base antes da alteração:** `cadf953` · branch `arena/a5269d1c-motoristapro-app` · árvore limpa
**Versão mantida:** 1.18.2 (versionCode 11802)
**Ficheiros alterados:** `www/js/auth.js`, `tests/boot-smoke.js` — mais nenhum

---

## 1. Causa

`mpLoginWithGoogle()` fazia:

```js
await mpRegisterDeepLink();   // resultado descartado
```

O resultado era ignorado, e o comentário assumia-o explicitamente ("uma falha não impede o login: o caminho de arranque a frio continua a apanhar o retorno"). A premissa é falsa: `mpConsultarLaunchUrl()` corre **uma única vez** no arranque. Se o utilizador inicia o login com o app já aberto e o listener não está ligado, o `appUrlOpen` de retorno não tem quem o ouça — o código OAuth perde-se e o login termina sem sessão, depois de o utilizador ter passado pelo ecrã do Google. Pior: o botão ficava em "Aguardando autenticação…" indefinidamente.

## 2. Solução

Em `mpLoginWithGoogle()`, o registo passa a ser pré-requisito **em nativo**:

- `await mpRegisterDeepLink()` → `retornoGarantido`;
- se `false`: **não** chama `Browser.open`, **não** chama `signInWithOAuth`, mostra
  *"Não foi possível preparar o retorno do Google. Tente novamente."*, repõe o botão em `Entrar com Google` e `return` — sem `try/finally` aberto, portanto sem indicador de carregamento preso e sem passar pelo `finally` do fluxo normal;
- se `true`: fluxo exatamente igual ao anterior (`try`/`finally`, estados "Abrindo Google…" → "Aguardando autenticação…", `aguardando`).

O detalhe técnico da falha fica no log (`logEvent('warn', …)` e o motivo do plugin em `mpLigarListenerDeepLink`), nunca no ecrã do utilizador.

### Decisão de escopo que tomei — e por quê

O guard é aplicado **apenas quando `mpIsNative()` é verdadeiro**. Em web não existe `appUrlOpen`: o `supabase-js` redireciona na mesma aba (`skipBrowserRedirect: false`) e a sessão é detetada por `detectSessionInUrl`. Aplicar o guard em web bloquearia o login com uma mensagem sobre um "retorno" que não existe nesse meio. Está coberto por um teste próprio. Não alterei `mpRegisterDeepLink()` nem qualquer outra função — a mudança é de 25 linhas, todas dentro de `mpLoginWithGoogle()`.

---

## 3. Resultados

`npm test` → **157 ✅ / 0 ❌** · `npm run android:verify` → **exit 0** · `npm run version:check` → **✔ 1.18.2 (versionCode 11802)**.

### T13 — falha no registo impede a abertura do navegador (6 asserções)
| Asserção | Resultado |
|---|---|
| `Browser.open()` **não** é chamado | ✅ 0 aberturas |
| O login OAuth **não** é iniciado (`signInWithOAuth`) | ✅ 0 chamadas |
| O botão sai do estado de carregamento | ✅ `disabled=false`, "Entrar com Google" |
| Mensagem compreensível ao utilizador | ✅ "Não foi possível preparar o retorno do Google. Tente novamente." |
| A mensagem não expõe detalhes internos do plugin | ✅ sem "registro nativo falhou", "Error", "addListener", "appUrlOpen" |
| Tentativa posterior (registo a funcionar) arranca normalmente | ✅ 1 abertura, 1 chamada |

### T14 — registo confirmado mantém o fluxo normal (5 asserções)
| Asserção | Resultado |
|---|---|
| `Browser.open()` chamado uma única vez | ✅ 1 |
| OAuth iniciado uma única vez | ✅ 1 |
| URL mantém PKCE (`code_challenge` + método) | ✅ `plain` (WebCrypto ausente no jsdom, como em produção sem https) |
| URL mantém o redirect nativo | ✅ `com.pro.driver://oauth-callback` |
| Interface entra em espera do Google (sem regressão) | ✅ "Aguardando autenticação…" |

Extra: em web, uma falha de registo **não** bloqueia o login (✅ `oauth=1`, sem mensagem de erro).

### Prova de que T13 deteta o defeito
Corrido contra o `auth.js` de `cadf953`: **5 asserções de T13 falham** — `1 abertura(s)`, `1 chamada(s) a signInWithOAuth`, botão preso em `disabled=true` / "Aguardando autenticação…", e a 2ª tentativa a somar `2 aberturas / 2 chamadas`. Com a correção: 157/0. O teste não passa por acidente.

### Testes anteriores
Todos mantidos e verdes: T1–T12 (PKCE, verificador, sessão, reinício, deduplicação, esquema/host, erro do provedor, falha de troca, browser fechado, arranque a frio, logout preserva histórico, e-mail/senha, idempotência, concorrência, registo assíncrono), além dos testes de Android/versão. Nenhum foi removido ou enfraquecido.

---

## 4. Confirmações

- **`mpLoginWithEmail()`**: intacta — não aparece no diff (verificado por grep ao próprio diff).
- **Supabase / Google Cloud / banco / RLS / tabelas / migrations / utilizadores / dados financeiros**: nenhuma alteração, nenhuma escrita.
- **Deep links no Android**: intocados (`AndroidManifest.xml`, `capacitor.config.json` sem diff). `npx cap copy android` apenas copiou `www/` para os assets (o `android:verify` confirma igualdade).
- **Versão**: 1.18.2 / 11802, sem alteração.
- **Arquivos modificados (lista exata)**: `www/js/auth.js`, `tests/boot-smoke.js`.
- **Sem merge, deploy, publicação ou geração de APK.** Nenhum workflow tocado.

## 5. O Google OAuth NÃO está concluído

Continua pendente, e não pode ser declarado aprovado:

1. **Teste em Android real** — sem JDK/SDK no ambiente e sem APK autorizado.
2. **Troca real do código com o GoTrue** — TLS para `*.supabase.co` falha no sandbox.

Os testes provam o que o código faz com o vendor real e plugins simulados; não provam que o intent nativo entregue o link nem que o servidor aceite a troca.

---

## 6. Diff completo

### `www/js/auth.js`
```diff
diff --git a/www/js/auth.js b/www/js/auth.js
index 8d76e1e..5f52e6b 100644
--- a/www/js/auth.js
+++ b/www/js/auth.js
@@ -475,11 +475,26 @@ async function mpLoginWithGoogle() {
   // Fica true enquanto o utilizador está no ecrã do Google: nesse estado o
   // botão NÃO deve voltar a "Entrar com Google" (o finally não o repõe).
   let aguardando = false;
-  // Garante o listener do retorno antes de sair para o navegador. O registo é
-  // assíncrono (@capacitor/app devolve Promise) — espera-se a confirmação para
-  // não sair do app com o listener por ligar. Uma falha não impede o login: o
-  // caminho de arranque a frio continua a apanhar o retorno.
-  await mpRegisterDeepLink();
+  // REGRA: em Android/iOS o navegador só abre com o retorno do Google
+  // garantido. Se o listener appUrlOpen não ficar confirmado, o código que
+  // voltar com o app aberto perde-se — getLaunchUrl() só é consultado no
+  // arranque, portanto não há segunda oportunidade para o recuperar. Nesse
+  // caso o login nem começa.
+  //
+  // Em web não há deep link: o próprio supabase-js redireciona na mesma aba,
+  // por isso o registo do listener não é pré-requisito.
+  if (mpIsNative()) {
+    const retornoGarantido = await mpRegisterDeepLink();
+    if (!retornoGarantido) {
+      // Mensagem para o utilizador; o detalhe do plugin fica no log técnico
+      // (feito em mpLigarListenerDeepLink), nunca no ecrã.
+      logEvent('warn', 'Login Google não iniciado: retorno do deep link não confirmado');
+      mpSetGoogleBusy(false, 'Entrar com Google');
+      mpSetLoginStatus('Não foi possível preparar o retorno do Google. Tente novamente.', true);
+      mpUpdateAccountUI();
+      return;
+    }
+  }
   mpSetGoogleBusy(true, 'Abrindo Google…');
   try {
     const redirectTo = mpIsNative()
```

### `tests/boot-smoke.js`
```diff
diff --git a/tests/boot-smoke.js b/tests/boot-smoke.js
index b3f4eef..0257446 100644
--- a/tests/boot-smoke.js
+++ b/tests/boot-smoke.js
@@ -1138,6 +1138,137 @@ server.listen(0, '127.0.0.1', () => {
             JSON.stringify(wLogin.__ordem) === JSON.stringify(['browser']),
             JSON.stringify(wLogin.__ordem));
 
+          // ============================================================
+          // T13 / T14 — o navegador só abre com o retorno confirmado
+          // ============================================================
+          // Observáveis reais (sem inspecionar código):
+          //  - Browser.open e o URL que recebeu;
+          //  - chamadas a auth.signInWithOAuth (o client é embrulhado ANTES de o
+          //    auth.js o criar, por isso o login iniciado é contado de verdade —
+          //    em nativo a URL de autorização é gerada localmente, sem pedido);
+          //  - estado do botão e texto do #mpLoginStatus.
+          function janelaLogin(modoRegistoInicial) {
+            const w = new (require('jsdom').JSDOM)(
+              '<!doctype html><html><body>' +
+              '<button id="mpBtnGoogle">Entrar com Google</button>' +
+              '<button id="mpBtnGoogleLogin">Entrar com Google</button>' +
+              '<div id="mpLoginStatus"></div><div id="mpAccountEmail"></div>' +
+              '<div id="mpAccountActions"></div><div id="mpNotify"></div>' +
+              '</body></html>',
+              { url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true }
+            ).window;
+            w.eval(`
+              window.__browserAberto = [];
+              window.__oauthIniciados = 0;
+              window.__modoAddListener = ${JSON.stringify(modoRegistoInicial || 'resolve')};
+              window.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
+                json: async () => ({}), text: async () => '' });
+              window.Capacitor = { isNativePlatform: () => true, Plugins: {
+                Browser: {
+                  open: async ({ url }) => { window.__browserAberto.push(url); },
+                  close: async () => {}
+                },
+                App: {
+                  addListener: (evento, cb) => {
+                    if (window.__modoAddListener === 'rejeitar') {
+                      return Promise.reject(new Error('registro nativo falhou (detalhe interno)'));
+                    }
+                    return Promise.resolve({ remove: async () => {} });
+                  },
+                  getLaunchUrl: async () => undefined
+                } } };
+              window.state = { shifts: [], expenses: [], maintenance: [] };
+              window.logEvent = function () {}; window.mpNotify = function () {};
+              window.mpReconcile = async function () {}; window.mpApplySessionUI = function () {};
+              window.MP_SUPABASE_URL = 'https://projeto.supabase.co';
+              window.MP_SUPABASE_ANON_KEY = 'sb_publishable_teste';
+              window.MP_OAUTH_REDIRECT_NATIVE = 'com.pro.driver://oauth-callback';
+            `);
+            w.eval(fs.readFileSync(path.join(WWW, 'js/vendor/supabase.js'), 'utf8'));
+            // Embrulhar o client antes de o auth.js o criar: conta as tentativas
+            // reais de iniciar o OAuth (nativo gera a URL sem pedido de rede).
+            w.eval(`
+              const criarOriginal = window.supabase.createClient.bind(window.supabase);
+              window.supabase.createClient = function () {
+                const c = criarOriginal.apply(null, arguments);
+                const iniciarOriginal = c.auth.signInWithOAuth.bind(c.auth);
+                c.auth.signInWithOAuth = function (o) {
+                  window.__oauthIniciados++;
+                  return iniciarOriginal(o);
+                };
+                return c;
+              };
+            `);
+            w.eval(fs.readFileSync(path.join(WWW, 'js/auth.js'), 'utf8'));
+            return w;
+          }
+          const estadoLogin = (w) => ({
+            browser: (w.__browserAberto || []).length,
+            oauth: w.__oauthIniciados || 0,
+            ocupado: w.document.getElementById('mpBtnGoogle').disabled,
+            textoBotao: w.document.getElementById('mpBtnGoogle').textContent,
+            status: w.document.getElementById('mpLoginStatus').textContent
+          });
+
+          // --- T13 — o registo falha no arranque: nada arranca --------------
+          const wT13 = janelaLogin('rejeitar');
+          await new Promise(r => setTimeout(r, 100)); // arranque: registo falha
+          await wT13.eval(`mpLoginWithGoogle()`);      // login: nova tentativa falha
+          const dep13 = estadoLogin(wT13);
+
+          check('T13: Browser.open NÃO é chamado sem retorno confirmado',
+            dep13.browser === 0, dep13.browser + ' abertura(s)');
+          check('T13: o login OAuth não é iniciado (signInWithOAuth não é chamado)',
+            dep13.oauth === 0, dep13.oauth + ' chamada(s) a signInWithOAuth');
+          check('T13: o botão Google sai do estado de carregamento',
+            dep13.ocupado === false && dep13.textoBotao === 'Entrar com Google',
+            'disabled=' + dep13.ocupado + ', texto=' + JSON.stringify(dep13.textoBotao));
+          check('T13: é apresentada uma mensagem compreensível ao utilizador',
+            /não foi possível preparar o retorno do Google/i.test(dep13.status) && /tente novamente/i.test(dep13.status),
+            JSON.stringify(dep13.status));
+          check('T13: a mensagem não expõe detalhes internos do plugin',
+            !/registro nativo falhou|detalhe interno|\bError\b|addListener|appUrlOpen/i.test(dep13.status),
+            JSON.stringify(dep13.status));
+
+          // tentativa posterior, já com o registo a funcionar
+          wT13.eval(`window.__modoAddListener = 'resolve'`);
+          await wT13.eval(`mpLoginWithGoogle()`);
+          const dep13b = estadoLogin(wT13);
+          check('T13: depois do registo passar a funcionar, o login arranca normalmente',
+            dep13b.browser === 1 && dep13b.oauth === 1,
+            dep13b.browser + ' abertura(s), ' + dep13b.oauth + ' chamada(s) a signInWithOAuth');
+
+          // --- T14 — registo confirmado: fluxo normal ---------------------
+          const wT14 = janelaLogin('resolve');
+          await new Promise(r => setTimeout(r, 100)); // arranque confirma o registo
+          await wT14.eval(`mpLoginWithGoogle()`);
+          const dep14 = estadoLogin(wT14);
+          check('T14: Browser.open é chamado uma única vez', dep14.browser === 1, dep14.browser + ' abertura(s)');
+          check('T14: o login OAuth é iniciado uma única vez', dep14.oauth === 1, dep14.oauth + ' chamada(s)');
+
+          const urlT14 = (wT14.__browserAberto || [])[0] || '';
+          const params14 = (() => { try { return new (require('url').URL)(urlT14).searchParams; } catch (_) { return null; } })();
+          check('T14: a URL mantém o fluxo PKCE (code_challenge + método)',
+            !!params14 && params14.get('code_challenge') !== null &&
+            ['s256', 'plain'].includes((params14.get('code_challenge_method') || '').toLowerCase()),
+            params14 ? ('método=' + params14.get('code_challenge_method')) : 'sem URL');
+          check('T14: a URL mantém o redirect nativo atual',
+            !!params14 && params14.get('redirect_to') === 'com.pro.driver://oauth-callback',
+            params14 ? String(params14.get('redirect_to')) : 'sem URL');
+          check('T14: a interface entra no estado de espera do Google (sem regressão)',
+            dep14.ocupado === true && /Aguardando autenticação/.test(dep14.textoBotao) &&
+            /Aguardando autenticação/.test(dep14.status),
+            'texto=' + JSON.stringify(dep14.textoBotao));
+
+          // --- em web o guard não se aplica (não há deep link) ------------
+          const wWeb = janelaLogin('rejeitar');
+          wWeb.eval(`window.Capacitor.isNativePlatform = () => false;`);
+          await wWeb.eval(`mpLoginWithGoogle()`);
+          const statusWeb = wWeb.document.getElementById('mpLoginStatus').textContent;
+          check('T13/T14: em web uma falha de registo não bloqueia o login',
+            (wWeb.__oauthIniciados || 0) === 1 && !/preparar o retorno do Google/i.test(statusWeb),
+            'oauth=' + wWeb.__oauthIniciados + ', status=' + JSON.stringify(statusWeb));
+
           // ============================================================
           // T6 / T7 — o que NÃO podia mudar (regressões)
           // ============================================================
```
