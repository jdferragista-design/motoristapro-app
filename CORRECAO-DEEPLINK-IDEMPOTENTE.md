# Registo idempotente do deep link Google OAuth

Data: 2026-11-08 · Versão 1.18.2 (versionCode 11802) · Base: `9e0e966` (branch `arena/a5269d1c-motoristapro-app`)
Ficheiros alterados: **`www/js/auth.js`** e **`tests/boot-smoke.js`**. Mais nenhum.

---

## 1. O problema, confirmado

`mpRegisterDeepLink()` chamava `App.addListener('appUrlOpen', …)` e `App.getLaunchUrl()` **sem qualquer guarda**, e era invocada no arranque (`mpInitSupabase`) e outra vez em cada `mpLoginWithGoogle()`.

Medido com a versão anterior (HEAD `9e0e966`), no cenário de 3 tentativas de login:

| Momento | Listeners registados | `getLaunchUrl()` |
|---|---|---|
| Arranque | 1 | 1 |
| +3 chamadas a `mpRegisterDeepLink()` | **4** | **4** |
| +3 tentativas de login | **7** | **7** |

Consequências reais: cada novo listener recebia o mesmo `appUrlOpen`; o mesmo código era entregue a vários caminhos em simultâneo; o `getLaunchUrl()` repetia em cada login uma consulta que só faz sentido no arranque. A deduplicação por código mascarava parte do efeito (evitava a segunda troca), mas o processamento concorrente acontecia e o resultado de cada caminho divergia.

## 2. Correção

Três guardas explícitas, junto das restantes variáveis de módulo:

```js
let mpDeepLinkRegistrado = false;   // appUrlOpen já ligado
let mpLaunchUrlConsultado = false;  // getLaunchUrl já consultado (arranque)
let mpRetornoEmCurso = null;        // promessa do retorno OAuth a decorrer
```

1. **`mpLigarListenerDeepLink(App)`** — devolve `false` de imediato se `mpDeepLinkRegistrado` já for `true`. `App.addListener('appUrlOpen', …)` corre **uma única vez** na vida da aplicação. A flag só é marcada **depois** de o `addListener` correr sem erro: se o plugin falhar na primeira tentativa, uma chamada posterior ainda pode registar.
2. **`mpConsultarLaunchUrl(App)`** — guarda `mpLaunchUrlConsultado`; `getLaunchUrl()` é consultado **só na inicialização**. Marca antes de invocar, para uma falha síncrona não abrir caminho a repetições.
3. **`mpTratarRetornoOAuth(url)`** — passou a ser um emissor serializado: se já houver um retorno a decorrer, **espera pelo desfecho desse** e devolve-o marcado com `concorrente: true`, em vez de abrir um segundo processamento. O corpo anterior mantém-se intacto em `mpExecutarRetornoOAuth(url)`, com `finally` a libertar o estado mesmo em erro.

`mpRegisterDeepLink()` mantém-se como ponto de entrada seguro e **continua a ser chamado antes de abrir o browser** (requisito 5), mas agora só liga o que falta.

Preservado sem alterações: `flowType: 'pkce'`, recuperação do `code_verifier` (`mpTemVerificadorPkce`), deduplicação por código (`MP_OAUTH_USADOS`), validação de esquema/host, tratamento de `error=` do provedor, `mpFecharBrowser()` em todos os desfechos, estados da UI e ausência de segredos em log.

## 3. Testes

`npm test` → **129 ✅ / 0 ❌** (eram 117; +12 asserções, todas do T10). `npm run android:verify` → exit 0. `npm run version:check` → `✔ versão sincronizada: 1.18.2 (versionCode 11802)`.

| # | Asserção | Resultado |
|---|---|---|
| T10-1 | Listener registado **uma vez** no arranque | ✅ 1 |
| T10-2 | `getLaunchUrl()` consultado **uma vez** no arranque | ✅ 1 |
| T10-3 | +3 chamadas a `mpRegisterDeepLink()` não registam outro listener | ✅ 1 |
| T10-4 | +3 chamadas não repetem `getLaunchUrl()` | ✅ 1 |
| T10-5 | 3 tentativas de login → continua 1 só listener | ✅ 1 |
| T10-6 | 3 tentativas de login → não repete `getLaunchUrl()` | ✅ 1 |
| T10-7 | O login continua a abrir o browser em cada tentativa | ✅ 3 aberturas |
| T10-8 | Um retorno entregue ao listener → **exactamente uma** troca de código | ✅ 1 |
| T10-9 | Dois caminhos em simultâneo para o mesmo link → **uma só** troca | ✅ 1 |
| T10-10 | O segundo caminho recebe o desfecho do primeiro | ✅ `ok`+`concorrente` |
| T10-11 | Reentrega do mesmo link → nenhuma troca | ✅ 0 |
| T10-12 | No fim do percurso: 1 registo / 1 callback | ✅ |

### Prova de que os testes detetam o defeito

Corridos contra o `auth.js` **anterior** (`git show HEAD:www/js/auth.js`): **7 asserções falham** (122 ✅ / 7 ❌), nomeadamente `4 listener(s)`, `7 listener(s)`, `7 consulta(s)` e `nenhum listener extra ... → 7 registos / 7 callbacks`. Com o código novo: 129/0. Os testes não passam por acidente.

### Regressões verificadas

T1–T9 e os testes PKCE existentes continuam verdes (nenhum foi removido): desafio PKCE, verificador persistido, `exchangeCodeForSession` com `auth_code` + verificador correto, sessão persistida, sessão após reinício, deep link duplicado, arranque a frio, esquema/host inválido, erro do provedor, falha na troca sem sessão inventada, verificador ausente, browser fechado. T6 (logout preserva o histórico financeiro) e T7 (e-mail/senha) também verdes.

## 4. Fora do escopo — confirmado intocado

- `mpLoginWithEmail()` não aparece no diff (verificado por grep ao próprio diff).
- Supabase: sem alterações de URL, chave, RLS, tabelas, utilizadores ou dados. Nenhuma escrita, nenhuma migration.
- Google Cloud, `config.js`, `capacitor.config.json`, `AndroidManifest.xml`, service worker: intocados.
- Sem merge, sem deploy, sem APK.
- `npx cap copy android` executado para manter os assets sincronizados (`android:verify` confirma igualdade com `www/`).

## 5. Pendente (não declarado como concluído)

**Teste em aparelho Android real continua por fazer** — sem JDK/SDK no sandbox e sem APK autorizado. É o único passo que valida o ciclo completo (browser do sistema → Google → intent → sessão) e a ausência de acumulação de listeners no runtime nativo real.

---

## 6. Diff completo

### `www/js/auth.js`
```diff
diff --git a/www/js/auth.js b/www/js/auth.js
index cce6b33..ee0abd3 100644
--- a/www/js/auth.js
+++ b/www/js/auth.js
@@ -15,6 +15,13 @@ let mpSession = null;
 let mpSyncTimer = null;
 let mpSyncBusy = false;
 
+// Controlo do deep link OAuth. O listener nativo é um recurso único: registá-lo
+// outra vez a cada tentativa de login acumulava callbacks e podia entregar o
+// mesmo retorno a dois caminhos em simultâneo.
+let mpDeepLinkRegistrado = false;   // appUrlOpen já ligado
+let mpLaunchUrlConsultado = false;  // getLaunchUrl já consultado (arranque)
+let mpRetornoEmCurso = null;        // promessa do retorno OAuth a decorrer
+
 // ---------- utilidades locais ----------
 function mpIsNative() {
   return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
@@ -252,8 +259,25 @@ async function mpProcessarRetornoOAuth(url) {
   return relatorio;
 }
 
-// Trata o retorno de ponta a ponta: processa, fecha o browser e atualiza a UI.
+// Trata o retorno de ponta a ponta. Se já houver um retorno a decorrer, espera
+// por esse desfecho em vez de abrir um segundo caminho: um único link produz um
+// único processamento e uma única troca de código.
 async function mpTratarRetornoOAuth(url) {
+  if (mpRetornoEmCurso) {
+    const r = await mpRetornoEmCurso;
+    logEvent('info', 'Retorno OAuth concorrente aguardou o processamento em curso');
+    return Object.assign({}, r, { concorrente: true });
+  }
+  mpRetornoEmCurso = mpExecutarRetornoOAuth(url);
+  try {
+    return await mpRetornoEmCurso;
+  } finally {
+    mpRetornoEmCurso = null;
+  }
+}
+
+// Corpo do processamento (um por retorno, garantido pelo emissor acima).
+async function mpExecutarRetornoOAuth(url) {
   mpSetLoginStatus('Conectando conta…');
   const r = await mpProcessarRetornoOAuth(url);
   await mpFecharBrowser();
@@ -280,30 +304,55 @@ async function mpTratarRetornoOAuth(url) {
   return r;
 }
 
-// Registar o listener ANTES de qualquer login (arranque a frio incluído).
-function mpRegisterDeepLink() {
-  if (!mpIsNative() || !window.Capacitor || !Capacitor.Plugins || !Capacitor.Plugins.App) return;
+// Liga o listener do deep link UMA única vez durante a vida da aplicação.
+// Idempotente: chamadas repetidas (arranque + cada tentativa de login) não
+// acumulam callbacks. Só marca como registado depois de o addListener correr
+// sem erro — se o plugin falhar, uma chamada posterior ainda pode tentar.
+function mpLigarListenerDeepLink(App) {
+  if (mpDeepLinkRegistrado) return false;
   try {
-    Capacitor.Plugins.App.addListener('appUrlOpen', ({ url }) => {
-      // Nunca logar o URL completo: contém o códigos e/ou tokens.
+    App.addListener('appUrlOpen', ({ url }) => {
+      // Nunca logar o URL completo: contém códigos e/ou tokens.
       logEvent('info', 'Deep link OAuth recebido');
       mpTratarRetornoOAuth(url);
     });
-
-    // Arranque a frio: se o app foi ABERTO pelo link, o evento appUrlOpen já
-    // passou antes de existir listener. getLaunchUrl() devolve-o aqui.
-    if (typeof Capacitor.Plugins.App.getLaunchUrl === 'function') {
-      Capacitor.Plugins.App.getLaunchUrl().then((res) => {
-        const url = res && res.url;
-        if (url && mpOAuthUrlValida(url)) {
-          logEvent('info', 'App aberto por deep link OAuth (arranque a frio)');
-          mpTratarRetornoOAuth(url);
-        }
-      }).catch(() => { /* não é fatal: o login continua disponível pelo botão */ });
-    }
+    mpDeepLinkRegistrado = true;
+    return true;
   } catch (e) {
     logEvent('warn', 'Não foi possível registar deep link', { message: e.message });
+    return false;
+  }
+}
+
+// Arranque a frio: se o app foi ABERTO pelo link, o evento appUrlOpen já passou
+// antes de existir listener. Só se consulta na inicialização — nunca a cada
+// login, onde não há novidade nenhuma a descobrir.
+function mpConsultarLaunchUrl(App) {
+  if (mpLaunchUrlConsultado) return false;
+  if (typeof App.getLaunchUrl !== 'function') { mpLaunchUrlConsultado = true; return false; }
+  mpLaunchUrlConsultado = true;
+  try {
+    App.getLaunchUrl().then((res) => {
+      const url = res && res.url;
+      if (url && mpOAuthUrlValida(url)) {
+        logEvent('info', 'App aberto por deep link OAuth (arranque a frio)');
+        mpTratarRetornoOAuth(url);
+      }
+    }).catch(() => { /* não é fatal: o login continua disponível pelo botão */ });
+  } catch (e) {
+    logEvent('warn', 'getLaunchUrl falhou', { message: e.message });
   }
+  return true;
+}
+
+// Ponto de entrada seguro para chamar em qualquer altura (arranque, antes de
+// abrir o browser). Ligar o listener e consultar o arranque são operações
+// distintas, cada uma com a sua guarda.
+function mpRegisterDeepLink() {
+  if (!mpIsNative() || !window.Capacitor || !Capacitor.Plugins || !Capacitor.Plugins.App) return;
+  const App = Capacitor.Plugins.App;
+  mpLigarListenerDeepLink(App);
+  mpConsultarLaunchUrl(App);
 }
 
 function mpApplySessionUI() {
```

### `tests/boot-smoke.js`
```diff
diff --git a/tests/boot-smoke.js b/tests/boot-smoke.js
index 10931f9..f5f6284 100644
--- a/tests/boot-smoke.js
+++ b/tests/boot-smoke.js
@@ -873,6 +873,112 @@ server.listen(0, '127.0.0.1', () => {
           check('T9 Google: arranque a frio conclui o login e persiste a sessão',
             !!sessaoFria && sessaoFria.user && sessaoFria.user.id === 'u-frio' && !!sessaoFria.access_token);
 
+          // ============================================================
+          // T10 — registo IDEMPOTENTE do deep link e retorno único
+          // ============================================================
+          // Janela própria: aqui interessa contar listeners e consultas, não
+          // o fluxo de tokens.
+          const wReg = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>', {
+            url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true
+          }).window;
+          wReg.eval(`
+            window.__pedidos = [];
+            window.fetch = async (u, o) => {
+              window.__pedidos.push({ url: String(u), body: o && o.body });
+              return { ok: true, status: 200, headers: { get: () => 'application/json' },
+                json: async () => ({ access_token: 'AT', refresh_token: 'RT', token_type: 'bearer',
+                                     expires_in: 3600, user: { id: 'u-reg', email: 'r@eg' } }), text: async () => '' };
+            };
+            // Contadores do que o app pede ao nativo.
+            window.__listeners = 0;
+            window.__consultasLaunch = 0;
+            window.__callbacks = [];
+            window.__browserAberto = [];
+            window.Capacitor = {
+              isNativePlatform: () => true,
+              Plugins: {
+                Browser: { open: async ({ url }) => { window.__browserAberto.push(url); }, close: async () => {} },
+                App: {
+                  addListener: (evento, cb) => {
+                    if (evento === 'appUrlOpen') { window.__listeners++; window.__callbacks.push(cb); }
+                    return { remove: async () => {} };
+                  },
+                  getLaunchUrl: async () => { window.__consultasLaunch++; return undefined; }
+                }
+              }
+            };
+            window.state = { shifts: [], expenses: [], maintenance: [] };
+            window.logEvent = function () {}; window.mpNotify = function () {};
+            window.mpReconcile = async function () {}; window.mpApplySessionUI = function () {};
+            window.MP_SUPABASE_URL = 'https://projeto.supabase.co';
+            window.MP_SUPABASE_ANON_KEY = 'sb_publishable_teste';
+            window.MP_OAUTH_REDIRECT_NATIVE = 'com.pro.driver://oauth-callback';
+          `);
+          wReg.eval(fs.readFileSync(path.join(WWW, 'js/vendor/supabase.js'), 'utf8'));
+          wReg.eval(fs.readFileSync(path.join(WWW, 'js/auth.js'), 'utf8'));
+          await new Promise(r => setTimeout(r, 60));
+
+          // o arranque (mpInitSupabase) já registou uma vez
+          check('T10 deep link: listener registado uma vez no arranque',
+            wReg.__listeners === 1, wReg.__listeners + ' listener(s)');
+          check('T10 deep link: getLaunchUrl consultado uma vez no arranque',
+            wReg.__consultasLaunch === 1, wReg.__consultasLaunch + ' consulta(s)');
+
+          // chamar o registo várias vezes não acumula listeners
+          wReg.eval(`mpRegisterDeepLink(); mpRegisterDeepLink(); mpRegisterDeepLink();`);
+          await new Promise(r => setTimeout(r, 40));
+          check('T10 deep link: chamadas repetidas não registam outro listener',
+            wReg.__listeners === 1, wReg.__listeners + ' listener(s)');
+          check('T10 deep link: chamadas repetidas não repetem getLaunchUrl',
+            wReg.__consultasLaunch === 1, wReg.__consultasLaunch + ' consulta(s)');
+
+          // várias tentativas de login também não acumulam
+          for (let i = 0; i < 3; i++) await wReg.eval(`mpLoginWithGoogle()`);
+          check('T10 deep link: três tentativas de login continuam com um só listener',
+            wReg.__listeners === 1, wReg.__listeners + ' listener(s)');
+          check('T10 deep link: três tentativas de login não repetem getLaunchUrl',
+            wReg.__consultasLaunch === 1, wReg.__consultasLaunch + ' consulta(s)');
+          check('T10 deep link: o login continuou a abrir o browser em cada tentativa',
+            (wReg.__browserAberto || []).length === 3, (wReg.__browserAberto || []).length + ' abertura(s)');
+
+          // um único retorno entregue com o listener registado: uma troca só
+          wReg.eval(`localStorage.setItem('mp_sb_auth_v1-code-verifier', JSON.stringify('verificador-reg-0123456789abcdef'))`);
+          const antesRetorno = (wReg.__pedidos || []).length;
+          wReg.eval(`window.__callbacks[0]({ url: 'com.pro.driver://oauth-callback?code=CODIGO-UNICO' })`);
+          await new Promise(r => setTimeout(r, 250));
+          const trocas = (wReg.__pedidos || []).slice(antesRetorno).filter(p => p.url.includes('grant_type=pkce'));
+          check('T10 deep link: um retorno produz exactamente uma troca de código',
+            trocas.length === 1, trocas.length + ' troca(s)');
+
+          // dois caminhos em simultâneo para o MESMO link: um processa, o outro
+          // espera — nunca duas trocas concorrentes
+          wReg.eval(`localStorage.setItem('mp_sb_auth_v1-code-verifier', JSON.stringify('verificador-reg-2-0123456789ab'))`);
+          const antesDuplo = (wReg.__pedidos || []).length;
+          const resultadosDuplos = await wReg.eval(`(async () => {
+            const [a, b] = await Promise.all([
+              mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-CONCORRENTE'),
+              mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-CONCORRENTE')
+            ]);
+            return [a, b];
+          })()`);
+          const trocasDuplas = (wReg.__pedidos || []).slice(antesDuplo).filter(p => p.url.includes('grant_type=pkce'));
+          check('T10 deep link: retorno em simultâneo por dois caminhos gera uma só troca',
+            trocasDuplas.length === 1, trocasDuplas.length + ' troca(s)');
+          check('T10 deep link: o segundo caminho recebe o desfecho do primeiro',
+            resultadosDuplos[0].ok === true && resultadosDuplos[1].ok === true &&
+            resultadosDuplos[1].concorrente === true);
+
+          // o mesmo link entregue outra vez pelo listener não volta a trocar
+          const antesRepetido = (wReg.__pedidos || []).length;
+          wReg.eval(`window.__callbacks.forEach(cb => cb({ url: 'com.pro.driver://oauth-callback?code=CODIGO-UNICO' }))`);
+          await new Promise(r => setTimeout(r, 200));
+          const trocasRepetidas = (wReg.__pedidos || []).slice(antesRepetido).filter(p => p.url.includes('grant_type=pkce'));
+          check('T10 deep link: reentrega do mesmo link não repete a troca',
+            trocasRepetidas.length === 0, trocasRepetidas.length + ' troca(s)');
+          check('T10 deep link: nenhum listener extra apareceu no fim do percurso',
+            wReg.__listeners === 1 && wReg.__callbacks.length === 1,
+            wReg.__listeners + ' registo(s) / ' + wReg.__callbacks.length + ' callback(s)');
+
           // ============================================================
           // T6 / T7 — o que NÃO podia mudar (regressões)
           // ============================================================
```
