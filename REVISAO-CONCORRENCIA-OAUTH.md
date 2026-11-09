# Revisão final — concorrência e registo assíncrono do Google OAuth

Data: 2026-11-08 · Versão 1.18.2 (versionCode 11802) · Base: `d79a033`
Ficheiros alterados: **`www/js/auth.js`** e **`tests/boot-smoke.js`**. Mais nenhum.

---

## 0. Assinatura real de `App.addListener` (verificada na versão instalada)

| Verificação | Resultado |
|---|---|
| Pacote instalado | `@capacitor/app` **8.1.2** (core 8.6.0) |
| Declaração em `dist/esm/definitions.d.ts` | `addListener(eventName: 'appUrlOpen', listenerFunc: URLOpenListener): Promise<PluginListenerHandle>` |
| Forma do handle | `PluginListenerHandle { remove: () => Promise<void> }` |

**Conclusão: devolve Promise.** O código anterior marcava `mpDeepLinkRegistrado = true` de forma síncrona, logo uma rejeição assíncrona do registo passava despercebida e o listener ficava por ligar para sempre — exatamente o cenário que a revisão pediu para cobrir. Corrigido.

---

## 1. Retornos **diferentes** durante um processamento

`mpRetornoEmCurso` passou a ter companhia: `mpRetornoEmCursoChave`, calculada por `mpChaveDoRetorno(url)` (`code:<código>`, `token:<access_token>`, ou o URL como último recurso).

| Situação | Comportamento |
|---|---|
| **Mesmo código** a chegar outra vez | espera a promessa existente e devolve o desfecho dela com `concorrente: true` (como antes) |
| **Código diferente** durante um processamento | **não** corre segunda troca e **não** devolve o resultado do primeiro. Devolve `{ ok: false, conflito: true, duplicado: false, modo: null, motivo: 'outro retorno OAuth está a ser processado', erro: 'aguarde a conclusão …' }` |

Detalhe deliberado: o código em conflito **não é marcado como usado** em `MP_OAUTH_USADOS`, para poder ser processado numa tentativa seguinte. A deduplicação existente não foi enfraquecida — o teste T11 confirma que o mesmo código continua a devolver `duplicado: true` sem novo pedido.

A promessa em curso é agora criada via `Promise.resolve().then(() => mpExecutarRetornoOAuth(url))`, para que um lançamento síncrono antes do primeiro `await` não deixe o estado inconsistente.

## 2. Registo assíncrono do listener

`mpLigarListenerDeepLink(App)` passou a devolver **`Promise<boolean>`**:

- **chamadas simultâneas** → partilham a mesma promessa (`mpDeepLinkPromessa`), logo **um único** `addListener`;
- **só marca registado quando a promessa resolve** — `mpDeepLinkRegistrado = true` acontece no `.then()`;
- **rejeição assíncrona** → `mpDeepLinkRegistrado` fica `false` e é registado em log (sem segredos); a tentativa seguinte volta a chamar o plugin;
- **erro síncrono** do plugin → devolve `false` sem marcar nada;
- **`mpRegisterDeepLink()`** devolve a promessa e mantém-se como ponto de entrada seguro;
- **`mpLoginWithGoogle()`** faz agora `await mpRegisterDeepLink()`: confirma o registo **antes** de abrir o browser. Se o registo falhar, o login continua (o arranque a frio ainda apanha o retorno).

Preservado: PKCE, `code_verifier`, deduplicação, fecho do Browser, `error=` do provedor, esquema/host, estados da UI, ausência de segredos em log, `getLaunchUrl()` só no arranque.

---

## 3. Resultados

`npm test` → **145 ✅ / 0 ❌** (eram 129; +16). `npm run android:verify` → exit 0. `npm run version:check` → `✔ versão sincronizada: 1.18.2 (versionCode 11802)`.

### T11 — retornos diferentes
| Asserção | Resultado |
|---|---|
| Dois códigos diferentes em simultâneo → uma única troca | ✅ 1 |
| O segundo não devolve sucesso emprestado do primeiro | ✅ `ok=false` |
| Conflito explícito e identificável | ✅ `conflito=true` + motivo |
| Não é duplicado nem sucesso | ✅ `duplicado=false`, `modo=null` |
| A única troca enviada é a do primeiro código | ✅ `CODIGO-AAA` |
| O código posto de lado é processável depois | ✅ |
| A deduplicação por código continua a funcionar | ✅ `duplicado=true`, 0 pedidos |

### T12 — registo assíncrono
| Asserção | Resultado |
|---|---|
| A versão instalada documenta `addListener` como Promise | ✅ |
| Registo bem-sucedido liga o listener uma vez | ✅ 1 chamada |
| Três chamadas simultâneas partilham um único `addListener` | ✅ 1 chamada |
| Rejeição assíncrona não conta como registado | ✅ `false` |
| Depois de falhar, nova tentativa volta a registar | ✅ 2 → 3 chamadas |
| Erro síncrono não marca registado e permite nova tentativa | ✅ |
| Após recuperar, deixa de haver novas chamadas | ✅ |
| Com registo em falta, o login confirma-o antes de abrir o browser | ✅ `["addListener","registado","browser"]` |
| Com registo confirmado, o login não volta a registar | ✅ `["browser"]` |

### Prova de que os testes detetam os defeitos

| `auth.js` usado | Resultado |
|---|---|
| **Final (este commit)** | 145 ✅ / 0 ❌ |
| `d79a033` (emissor único + registo síncrono) | 119 ✅ / **5 ❌** — T11 devolve `ok=true` emprestado; T12 falha no registo síncrono |
| `8a0dc36` (antes de qualquer idempotência) | **13 ❌** — inclui `2 troca(s)` paralelas e `7 listener(s)` |

T1–T10 e todos os testes PKCE anteriores continuam verdes; nenhum foi removido.

---

## 4. Escopo

- `mpLoginWithEmail()` não aparece no diff (verificado por grep).
- Supabase, Google Cloud, banco, RLS, tabelas, utilizadores e dados financeiros: intocados. Nenhuma escrita nem migration.
- Sem merge, deploy ou APK. `npx cap copy android` apenas sincronizou os assets (`android:verify` confirma igualdade com `www/`).

## 5. Pendente — não declarado como concluído

**O Google OAuth não está provado em Android real.** Continua sem JDK/SDK no ambiente e sem APK autorizado. Os testes provam o que o código faz (registo, concorrência, troca, deduplicação) com o vendor real e plugins simulados; não provam que o intent nativo entregue o link nem que o GoTrue aceite a troca. Teste físico continua obrigatório antes de considerar a correção fechada.

---

## 6. Diff completo

### `www/js/auth.js`
```diff
diff --git a/www/js/auth.js b/www/js/auth.js
index ee0abd3..8d76e1e 100644
--- a/www/js/auth.js
+++ b/www/js/auth.js
@@ -18,9 +18,11 @@ let mpSyncBusy = false;
 // Controlo do deep link OAuth. O listener nativo é um recurso único: registá-lo
 // outra vez a cada tentativa de login acumulava callbacks e podia entregar o
 // mesmo retorno a dois caminhos em simultâneo.
-let mpDeepLinkRegistrado = false;   // appUrlOpen já ligado
+let mpDeepLinkRegistrado = false;   // appUrlOpen confirmado como ligado
+let mpDeepLinkPromessa = null;      // registo a decorrer (evita registo duplo)
 let mpLaunchUrlConsultado = false;  // getLaunchUrl já consultado (arranque)
 let mpRetornoEmCurso = null;        // promessa do retorno OAuth a decorrer
+let mpRetornoEmCursoChave = null;   // qual retorno está a decorrer (code/token)
 
 // ---------- utilidades locais ----------
 function mpIsNative() {
@@ -259,20 +261,58 @@ async function mpProcessarRetornoOAuth(url) {
   return relatorio;
 }
 
-// Trata o retorno de ponta a ponta. Se já houver um retorno a decorrer, espera
-// por esse desfecho em vez de abrir um segundo caminho: um único link produz um
-// único processamento e uma única troca de código.
+// Identifica um retorno pelo que ele traz. Dois links com o MESMO código (ou os
+// mesmos tokens) são a mesma entrega; códigos diferentes são retornos distintos
+// e não podem partilhar resultado.
+function mpChaveDoRetorno(url) {
+  try {
+    const u = new URL(url);
+    const code = u.searchParams.get('code');
+    if (code) return 'code:' + code;
+    const h = new URLSearchParams((u.hash || '').replace(/^#/, ''));
+    const at = h.get('access_token');
+    if (at) return 'token:' + at;
+  } catch (_) { /* url inválida: cai no fallback */ }
+  return 'url:' + String(url || '');
+}
+
+// Trata o retorno de ponta a ponta, admitindo um só processamento de cada vez.
+//  - mesmo código a chegar outra vez: espera pelo que está a decorrer e recebe
+//    o desfecho desse (concorrente: true);
+//  - código DIFERENTE a chegar durante um processamento: não corre uma segunda
+//    troca em paralelo e NUNCA devolve o resultado do primeiro como se fosse o
+//    deste. Devolve um conflito explícito que o chamador pode distinguir.
 async function mpTratarRetornoOAuth(url) {
+  const chave = mpChaveDoRetorno(url);
   if (mpRetornoEmCurso) {
-    const r = await mpRetornoEmCurso;
-    logEvent('info', 'Retorno OAuth concorrente aguardou o processamento em curso');
-    return Object.assign({}, r, { concorrente: true });
+    if (chave === mpRetornoEmCursoChave) {
+      const r = await mpRetornoEmCurso;
+      logEvent('info', 'Entrega repetida do mesmo retorno aguardou o processamento em curso');
+      return Object.assign({}, r, { concorrente: true });
+    }
+    // Nada é trocado e nada é apresentado como sucesso: o retorno em curso é o
+    // dono exclusivo da sessão. O código novo não é marcado como usado, para
+    // poder ser tratado numa próxima tentativa.
+    logEvent('warn', 'Retorno OAuth diferente chegou durante um processamento em curso');
+    return {
+      ok: false,
+      modo: null,
+      motivo: 'outro retorno OAuth está a ser processado',
+      erro: 'aguarde a conclusão do login em curso e tente novamente',
+      duplicado: false,
+      conflito: true
+    };
   }
-  mpRetornoEmCurso = mpExecutarRetornoOAuth(url);
+  mpRetornoEmCursoChave = chave;
+  // A promessa é criada já a partir de uma chamada assíncrona: se
+  // mpExecutarRetornoOAuth lançasse de forma síncrona (antes do primeiro await),
+  // o `finally` limpava o estado e o chamador ficava com uma rejeição.
+  mpRetornoEmCurso = Promise.resolve().then(() => mpExecutarRetornoOAuth(url));
   try {
     return await mpRetornoEmCurso;
   } finally {
     mpRetornoEmCurso = null;
+    mpRetornoEmCursoChave = null;
   }
 }
 
@@ -305,23 +345,46 @@ async function mpExecutarRetornoOAuth(url) {
 }
 
 // Liga o listener do deep link UMA única vez durante a vida da aplicação.
-// Idempotente: chamadas repetidas (arranque + cada tentativa de login) não
-// acumulam callbacks. Só marca como registado depois de o addListener correr
-// sem erro — se o plugin falhar, uma chamada posterior ainda pode tentar.
+//
+// App.addListener devolve Promise<PluginListenerHandle> (@capacitor/app 8.x),
+// por isso o registo só conta como concluído quando a promessa resolve — marcar
+// antes disso esconderia uma falha de registo para sempre. Garantias:
+//  - chamadas simultâneas partilham a MESMA promessa: um único addListener;
+//  - rejeição assíncrona deixa a flag em false, para nova tentativa (login
+//    seguinte, ou o retorno de segurança antes de abrir o browser);
+//  - erro síncrono do plugin também não marca registado.
+// Devolve Promise<boolean>: true se ficou (ou já estava) ligado.
 function mpLigarListenerDeepLink(App) {
-  if (mpDeepLinkRegistrado) return false;
+  if (mpDeepLinkRegistrado) return Promise.resolve(true);
+  if (mpDeepLinkPromessa) return mpDeepLinkPromessa; // registo já a decorrer
+
+  let chamada;
   try {
-    App.addListener('appUrlOpen', ({ url }) => {
+    chamada = App.addListener('appUrlOpen', ({ url }) => {
       // Nunca logar o URL completo: contém códigos e/ou tokens.
       logEvent('info', 'Deep link OAuth recebido');
       mpTratarRetornoOAuth(url);
     });
-    mpDeepLinkRegistrado = true;
-    return true;
   } catch (e) {
     logEvent('warn', 'Não foi possível registar deep link', { message: e.message });
-    return false;
+    return Promise.resolve(false);
   }
+
+  mpDeepLinkPromessa = Promise.resolve(chamada).then(() => {
+    mpDeepLinkRegistrado = true;
+    return true;
+  }).catch((e) => {
+    // Registo falhou: fica por ligar e pode ser tentado outra vez.
+    mpDeepLinkRegistrado = false;
+    logEvent('warn', 'Registo do deep link falhou (nova tentativa no próximo login)', {
+      message: String((e && e.message) || e)
+    });
+    return false;
+  }).then((ok) => {
+    mpDeepLinkPromessa = null;
+    return ok;
+  });
+  return mpDeepLinkPromessa;
 }
 
 // Arranque a frio: se o app foi ABERTO pelo link, o evento appUrlOpen já passou
@@ -349,10 +412,12 @@ function mpConsultarLaunchUrl(App) {
 // abrir o browser). Ligar o listener e consultar o arranque são operações
 // distintas, cada uma com a sua guarda.
 function mpRegisterDeepLink() {
-  if (!mpIsNative() || !window.Capacitor || !Capacitor.Plugins || !Capacitor.Plugins.App) return;
+  if (!mpIsNative() || !window.Capacitor || !Capacitor.Plugins || !Capacitor.Plugins.App) {
+    return Promise.resolve(false);
+  }
   const App = Capacitor.Plugins.App;
-  mpLigarListenerDeepLink(App);
   mpConsultarLaunchUrl(App);
+  return mpLigarListenerDeepLink(App);
 }
 
 function mpApplySessionUI() {
@@ -410,8 +475,11 @@ async function mpLoginWithGoogle() {
   // Fica true enquanto o utilizador está no ecrã do Google: nesse estado o
   // botão NÃO deve voltar a "Entrar com Google" (o finally não o repõe).
   let aguardando = false;
-  // Garante o listener do retorno antes de sair para o navegador.
-  mpRegisterDeepLink();
+  // Garante o listener do retorno antes de sair para o navegador. O registo é
+  // assíncrono (@capacitor/app devolve Promise) — espera-se a confirmação para
+  // não sair do app com o listener por ligar. Uma falha não impede o login: o
+  // caminho de arranque a frio continua a apanhar o retorno.
+  await mpRegisterDeepLink();
   mpSetGoogleBusy(true, 'Abrindo Google…');
   try {
     const redirectTo = mpIsNative()
```

### `tests/boot-smoke.js`
```diff
diff --git a/tests/boot-smoke.js b/tests/boot-smoke.js
index f5f6284..b3f4eef 100644
--- a/tests/boot-smoke.js
+++ b/tests/boot-smoke.js
@@ -979,6 +979,165 @@ server.listen(0, '127.0.0.1', () => {
             wReg.__listeners === 1 && wReg.__callbacks.length === 1,
             wReg.__listeners + ' registo(s) / ' + wReg.__callbacks.length + ' callback(s)');
 
+          // ============================================================
+          // T11 — retornos OAuth DIFERENTES em simultâneo
+          // ============================================================
+          // Dois códigos distintos a chegar ao mesmo tempo: o segundo não pode
+          // correr outra troca nem herdar o sucesso do primeiro.
+          wReg.eval(`
+            localStorage.setItem('mp_sb_auth_v1-code-verifier', JSON.stringify('verificador-t11-0123456789ab'));
+            // o leque de verificadores foi consumido pela troca anterior
+            window.__pedidos.length = 0;
+          `);
+          const doisCodigos = await wReg.eval(`(async () => {
+            const [a, b] = await Promise.all([
+              mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-AAA'),
+              mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-BBB')
+            ]);
+            return [a, b];
+          })()`);
+          const trocasDois = (wReg.__pedidos || []).filter(p => p.url.includes('grant_type=pkce'));
+          check('T11: dois códigos diferentes em simultâneo produzem uma única troca',
+            trocasDois.length === 1, trocasDois.length + ' troca(s)');
+          check('T11: o segundo código único não devolve sucesso emprestado do primeiro',
+            doisCodigos[1].ok === false, 'ok=' + doisCodigos[1].ok);
+          check('T11: o conflito é explícito e identificável',
+            doisCodigos[1].conflito === true && /processado/.test(doisCodigos[1].motivo),
+            doisCodigos[1].motivo || '');
+          check('T11: o segundo retorno não é classificado como duplicado nem como sucesso',
+            doisCodigos[1].duplicado === false && doisCodigos[1].modo === null);
+          check('T11: a única troca enviada é a do primeiro código',
+            !!trocasDois[0] && JSON.parse(trocasDois[0].body).auth_code === 'CODIGO-AAA',
+            trocasDois[0] ? JSON.parse(trocasDois[0].body).auth_code : 'sem pedido');
+
+          // o código recusado por conflito NÃO foi marcado como usado: uma nova
+          // tentativa depois do conflito consegue processá-lo
+          wReg.eval(`localStorage.setItem('mp_sb_auth_v1-code-verifier', JSON.stringify('verificador-t11b-0123456789'))`);
+          const retryConflito = await wReg.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-BBB')`);
+          check('T11: o código posto de lado por conflito é processável depois',
+            retryConflito.ok === true && retryConflito.conflito === undefined,
+            'ok=' + retryConflito.ok);
+
+          // e o mesmo código continua a ser tratado como duplicado (não regrediu)
+          const antesMesmoCodigo = (wReg.__pedidos || []).length;
+          const mesmoCodigo = await wReg.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-AAA')`);
+          check('T11: a deduplicação por código continua a funcionar',
+            mesmoCodigo.duplicado === true &&
+            (wReg.__pedidos || []).length === antesMesmoCodigo,
+            'duplicado=' + mesmoCodigo.duplicado);
+
+          // ============================================================
+          // T12 — registo ASSÍNCRONO do listener (App.addListener devolve Promise)
+          // ============================================================
+          // Confirmado na versão instalada: @capacitor/app 8.1.2 declara
+          // addListener(...): Promise<PluginListenerHandle>.
+          const dtsApp = fs.readFileSync(path.join(path.join(__dirname, '..'), 'node_modules/@capacitor/app/dist/esm/definitions.d.ts'), 'utf8');
+          check('T12: a versão instalada documenta addListener como Promise',
+            /addListener\(eventName: 'appUrlOpen'[^)]*\): Promise<PluginListenerHandle>/.test(dtsApp),
+            JSON.stringify(String(dtsApp).length) + ' bytes de tipos');
+
+          // janela controlada: o addListener pode resolver, rejeitar (async) ou
+          // atirar (sync), e conta quantas vezes foi chamado.
+          function janelaRegisto(modo) {
+            const w = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>', {
+              url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true
+            }).window;
+            w.eval(`
+              window.__chamadasAddListener = 0;
+              window.__callbacks = [];
+              window.__modo = ${JSON.stringify(modo)};
+              window.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
+                json: async () => ({}), text: async () => '' });
+              window.Capacitor = { isNativePlatform: () => true, Plugins: {
+                Browser: { open: async () => {}, close: async () => {} },
+                App: {
+                  addListener: (evento, cb) => {
+                    window.__chamadasAddListener++;
+                    window.__callbacks.push(cb);
+                    if (window.__modo === 'sync-throw') throw new Error('plugin indisponível');
+                    if (window.__modo === 'async-reject') return Promise.reject(new Error('falha nativa simulada'));
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
+            w.eval(fs.readFileSync(path.join(WWW, 'js/auth.js'), 'utf8'));
+            return w;
+          }
+
+          // (a) sucesso — registo confirmado só depois de a promessa resolver
+          const wOk = janelaRegisto('resolve');
+          await new Promise(r => setTimeout(r, 60));
+          check('T12: registo bem-sucedido liga o listener uma vez',
+            wOk.__chamadasAddListener === 1 && (await wOk.eval(`mpRegisterDeepLink()`)) === true,
+            wOk.__chamadasAddListener + ' chamada(s)');
+          check('T12: chamadas simultâneas partilham um único addListener',
+            (await wOk.eval(`Promise.all([mpRegisterDeepLink(), mpRegisterDeepLink(), mpRegisterDeepLink()])`)).every(Boolean) &&
+            wOk.__chamadasAddListener === 1,
+            wOk.__chamadasAddListener + ' chamada(s) após 3 pedidos simultâneos');
+
+          // (b) rejeição assíncrona — não pode ficar marcado como registado
+          const wRej = janelaRegisto('async-reject');
+          await new Promise(r => setTimeout(r, 60));
+          check('T12: rejeição assíncrona não conta como registado',
+            (await wRej.eval(`mpRegisterDeepLink()`)) === false);
+          const tentativasRej = wRej.__chamadasAddListener;
+          await wRej.eval(`mpRegisterDeepLink()`);
+          check('T12: depois de falhar, uma nova tentativa volta a tentar registar',
+            wRej.__chamadasAddListener === tentativasRej + 1,
+            tentativasRej + ' → ' + wRej.__chamadasAddListener + ' chamada(s)');
+
+          // (c) erro síncrono do plugin — também permite nova tentativa
+          const wSync = janelaRegisto('sync-throw');
+          await new Promise(r => setTimeout(r, 60));
+          const antesSync = wSync.__chamadasAddListener;
+          const okSync = await wSync.eval(`mpRegisterDeepLink()`);
+          await wSync.eval(`mpRegisterDeepLink()`);
+          check('T12: erro síncrono não marca registado e permite nova tentativa',
+            okSync === false && wSync.__chamadasAddListener === antesSync + 2,
+            'resultado=' + okSync + ', ' + wSync.__chamadasAddListener + ' chamada(s)');
+
+          // (d) depois de recuperar, passa a ser idempotente
+          wSync.eval(`window.Capacitor.Plugins.App.addListener = (evento, cb) => {
+            window.__chamadasAddListener++; return Promise.resolve({ remove: async () => {} }); }`);
+          const recuperou = await wSync.eval(`mpRegisterDeepLink()`);
+          const chamadasAposRecuperar = wSync.__chamadasAddListener;
+          await wSync.eval(`mpRegisterDeepLink(); mpRegisterDeepLink();`);
+          check('T12: após recuperar o registo, deixa de haver novas chamadas ao plugin',
+            recuperou === true && wSync.__chamadasAddListener === chamadasAposRecuperar,
+            'recuperou=' + recuperou + ', ' + wSync.__chamadasAddListener + ' chamada(s)');
+
+          // (e) se o registo falhou no arranque, o login tem de o confirmar
+          // ANTES de abrir o browser (é a última rede antes de sair do app).
+          const wLogin = janelaRegisto('async-reject');
+          await new Promise(r => setTimeout(r, 80));
+          wLogin.eval(`
+            window.__ordem = [];
+            window.Capacitor.Plugins.App.addListener = (e, cb) => {
+              window.__ordem.push('addListener');
+              return new Promise(res => setTimeout(() => { window.__ordem.push('registado'); res({ remove: async () => {} }); }, 80));
+            };
+            window.Capacitor.Plugins.Browser.open = async () => { window.__ordem.push('browser'); };
+          `);
+          await wLogin.eval(`mpLoginWithGoogle()`);
+          check('T12: com o registo em falta, o login confirma-o antes de abrir o browser',
+            JSON.stringify(wLogin.__ordem) === JSON.stringify(['addListener', 'registado', 'browser']),
+            JSON.stringify(wLogin.__ordem));
+
+          // e quando o registo já está confirmado não há nova chamada ao plugin
+          wLogin.eval(`window.__ordem = [];`);
+          await wLogin.eval(`mpLoginWithGoogle()`);
+          check('T12: com o registo já confirmado o login não volta a registar',
+            JSON.stringify(wLogin.__ordem) === JSON.stringify(['browser']),
+            JSON.stringify(wLogin.__ordem));
+
           // ============================================================
           // T6 / T7 — o que NÃO podia mudar (regressões)
           // ============================================================
```
