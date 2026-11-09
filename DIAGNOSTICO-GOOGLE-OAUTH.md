# Diagnóstico — Google OAuth no MotoristaPro (Android/Capacitor)

**Data:** 2026-11-08 · **HEAD no momento do diagnóstico:** `c51856b`
**Branch:** `arena/a5269d1c-motoristapro-app` · **Modo:** diagnóstico + proposta (**nenhuma alteração aplicada**)

---

## 1. Resumo

O login com Google falha num ponto específico e reproduzível: **o app espera um `?code=` no deep
link, mas o fluxo configurado (implicit, o padrão da biblioteca) devolve os tokens no fragmento
(`#access_token=…`)**. O bloco que troca o código pela sessão nunca executa.

Não é falha do Google, do Supabase nem das permissões do Android: a configuração está coerente em
todos esses pontos. É um defeito de código, confinado a `www/js/auth.js`.

---

## 2. Configuração verificada (Etapa 3)

| Item | Valor encontrado | Estado |
|---|---|---|
| URL do Supabase | `https://xncxzczftetctpazzecu.supabase.co` | ✔ |
| Chave pública | `sb_publishable_…` (do projeto atual) | ✔ |
| Google Provider | `external_google_enabled: true` | ✔ |
| Client ID / Secret | ambos presentes (valores não transcritos) | ✔ |
| Callback do Supabase | `…/auth/v1/callback` na `uri_allow_list` | ✔ |
| Redirect URLs | `com.pro.driver://oauth-callback`, `http://localhost:8080/*`, `…:3000/*` | ✔ |
| Deep link Android | `AndroidManifest`: scheme `com.pro.driver`, host `oauth-callback`, `BROWSABLE` | ✔ |
| Plugins registados no APK | `App`, `Browser`, `Filesystem`, `Share` | ✔ |
| Capacitor | core/android/cli 8.6.0 · `@capacitor/browser` 8.0.5 | ✔ |
| supabase-js (vendor) | 2.117.3 | ✔ |
| `flowType` no cliente | **ausente** → o vendor usa `implicit` | ✘ (causa) |

### Interface de login (Etapa 1)

- Dois pontos de entrada para o Google: ecrã `#mpLoginScreen` (botão `#mpBtnGoogle`) e
  **Configurações → Conta & Nuvem** (`#mpAccountActions`, botão gerado dinamicamente).
- O ecrã de login está `display:none` no arranque (`mpShowLoginScreen(false)`); só o segundo caminho
  é alcançável na prática.
- `mpSetLoginStatus()` escreve em `#mpLoginStatus` (dentro do ecrã oculto) **e** em
  `#mpAccountBoxStatus` (visível). O estado de carregamento desativa o botão
  (`mp-login-btn--busy`) mas, como o botão dos Configurações é recriado por `innerHTML`, o
  `getElementById('mpBtnGoogle')` devolve `null` nesse caminho — **não há feedback visual de
  carregamento** por ali.
- Sem sobreposições (`z-index` do ecrã de primeiro uso = 2010, superior ao login). Campos de
  email/senha são criados por `innerHTML` e não têm `for=` (labels associados só na secção de
  formulários do HTML estático).

---

## 3. Rastreio do fluxo (Etapa 2) e evidência

### O que o app faz hoje (`www/js/auth.js`)

```js
// mpInitSupabase() — l.80
mpSupabase = window.supabase.createClient(URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true,
          detectSessionInUrl: true, storageKey: 'mp_sb_auth_v1' }
  // ← sem flowType: fica no default 'implicit'
});

// mpLoginWithGoogle() — l.179
const redirectTo = mpIsNative() ? window.MP_OAUTH_REDIRECT_NATIVE   // com.pro.driver://oauth-callback
                                : (origin + pathname);
await mpSupabase.auth.signInWithOAuth({ provider:'google',
  options:{ redirectTo, skipBrowserRedirect: mpIsNative() } });

// mpRegisterDeepLink() — l.121
const u = new URL(url);
const code = u.searchParams.get('code');          // ← o fragmento NUNCA chega aqui
if (code && mpSupabase) { await mpSupabase.auth.exchangeCodeForSession(code); }
```

### Teste executado (vendor real, jsdom)

Reproduzi a sequência exata do app: cliente criado em `index.html` (**sem** código na URL), depois
`signInWithOAuth`, depois a chamada que o deep link faria.

| Fluxo | URL de autorização gerada | Corpo enviado a `/token?grant_type=pkce` |
|---|---|---|
| **implicit** (atual) | `…/authorize?provider=google&redirect_to=com.pro.driver%3A%2F%2Foauth-callback` | `{"auth_code":"CODIGO","code_verifier":""}` |
| pkce | `…&code_challenge=…&code_challenge_method=plain` | `{"auth_code":"CODIGO","code_verifier":"77674bc6…"}` |

Conclusões com evidência:

1. **No implicit o fragmento não é lido.** `new URL('com.pro.driver://oauth-callback#access_token=…')`
   expõe o fragmento em `hash`, não em `searchParams`; `searchParams.get('code')` devolve `null`.
   O `if (code && …)` é falso e nada acontece.
2. **`access_token` não é `auth_code`.** Mesmo que o valor fosse extraído, `exchangeCodeForSession`
   envia-o como `auth_code` ao GoTrue e seria rejeitado.
3. **Trocar só para PKCE não basta.** Com o cliente criado sem código na URL, o vendor procura o
   verificador por um `flow_id` derivado de `window.location` (`_exchangeCodeForSession`), obtém
   `null` e envia `code_verifier:""` — a troca falharia na mesma.
4. **`crypto.subtle` ausente em contexto não seguro.** O próprio vendor avisa:
   `Code challenge method will default to use plain instead of sha256`. Em Android o WebView serve
   `https://localhost` (contexto seguro, OK); em `http://localhost` no browser de desenvolvimento
   degrada para `plain`.

### Histórico

`git log -S "access_token" -- www/js/auth.js` e `-S "appUrlOpen"` mostram que **nunca existiu** no
repositório tratamento de `access_token` vindo do deep link. O código sempre esperou `?code=`.
Consequência: a conta de provider `google` que existe na base foi criada no GoTrue (o Google
autentica bem), mas **o app nunca chegou a ter sessão** por esta via.

---

## 4. Causa identificada (Etapa 4)

| Verificação | Estado |
|---|---|
| Abertura do Google / do navegador | **PASSOU** — `signInWithOAuth` gera URL válida; `Browser.open` executa |
| Configuração OAuth (Supabase/Google) | **PASSOU** — provider, clientes, callbacks e redirects coerentes |
| Redirect compatível | **PASSOU** — `com.pro.driver://oauth-callback` está na lista autorizada |
| Deep link recebido no Android | **NÃO VERIFICADO** — `intent-filter` correto; entrega exige aparelho |
| Código OAuth extraído | **FALHOU** — procura `?code=`, recebe `#access_token` |
| `exchangeCodeForSession` | **FALHOU** — nunca é chamado (e receberia token, não code) |
| Persistência de sessão | **NÃO EXERCITADA** — sem sessão não há o que persistir |
| Atualização da UI | **FALHOU parcialmente** — sem sessão, o `Browser` fica aberto e o estado não muda |

**Causa raiz:** fluxo de retorno incompatível com o formato de resposta (`implicit` + parser de
`?code=`), agravado por um PKCE inexistente (sem `flowType`, sem verificador persistido, sem
tratamento de `access_token`).

---

## 5. Correção proposta (não aplicada)

Todos os cambios ficam em `www/js/auth.js`; `config.js`, `data.js`, `render.js`, `www/index.html`
e o schema não são tocados.

### C1 — `flowType: 'pkce'` (1 linha, em `mpInitSupabase`)

O retorno passa a trazer `?code=…`, que o app já sabe tratar; o token deixa de transitar pelo
WebView e a troca é feita servidor-a-servidor.

```diff
   auth: {
+    flowType: 'pkce',
     persistSession: true,
```

**Risco:** baixo. Só afeta OAuth; `signInWithPassword` é independente.

### C2 — `appUrlOpen` robusto (em `mpRegisterDeepLink`)

- ler `code` de `searchParams` **e** do fragmento (`#access_token=…`, compatibilidade);
- se vier `access_token`, usar `mpSupabase.auth.setSession({access_token, refresh_token})`;
- **fechar o `Browser` sempre** (sucesso e erro);
- escrever o erro em `#mpAccountBoxStatus` (o visível) e não só no div do ecrã oculto;
- guarda contra execução dupla (o Android pode entregar o link duas vezes).

### C3 — Listener registado antes do login + arranque a frio

`mpRegisterDeepLink()` é chamado no fim de `mpInitSupabase()`; se o app for **lançado pelo** deep
link, o evento pode chegar antes do listener. Acrescentar leitura de
`Capacitor.Plugins.App.getLaunchUrl()` no arranque.

### C4 (opcional) — Feedback de carregamento no botão dos Configurações

Guardar o botão em variável antes de renderizar, ou usar um estado textual ("a abrir Google…") em
`#mpAccountBoxStatus`, para o utilizador ver que algo está a acontecer.

---

## 6. Testes (planeados)

| # | Teste | Como | Requer aparelho |
|---|---|---|---|
| T1 | URL gerada inclui `code_challenge` e `code_challenge_method` | jsdom + vendor real | Não |
| T2 | deep link `?code=X` → `exchangeCodeForSession` chamado com verifier **não vazio** | jsdom + vendor real | Não |
| T3 | deep link `#access_token=…` → `setSession` e sessão criada | jsdom + vendor real | Não |
| T4 | sessão persistida em `localStorage.mp_sb_auth_v1` e recuperada após reabrir | jsdom | Não |
| T5 | `signOut` limpa a sessão e **não** apaga dados locais | jsdom | Não |
| T6 | **regressão:** `signInWithPassword` chamado 1× com os mesmos campos | jsdom | Não |
| T7 | entrega real de `com.pro.driver://oauth-callback` | Android | **Sim** |
| T8 | `npm test` (92 asserções) + `npm run android:verify` | CLI | Não |

**Critério de sucesso:** T1–T6 e T8 verdes **e** T7 confirmado em aparelho. Sem T7 o Google OAuth
não pode ser declarado funcional.

---

## 7. Pendências fora do código (só visualização, nada alterado)

1. **Google Cloud Console:** confirmar `Authorized redirect URI` =
   `https://xncxzczftetctpazzecu.supabase.co/auth/v1/callback` — o `CONECTAR-GOOGLE-SUPABASE.md`
   do repositório ainda mostra o projeto antigo (`ewmtphddypfcllewkgzl`), cujo guia induz erro.
2. **`Site URL` = `http://localhost:8080`:** não bloqueia o Android (o `redirect_to` é explícito),
   mas deve ser corrigido antes de qualquer versão web.
3. **Teste em aparelho** obrigatório para T7.

---

## 8. Garantias desta etapa

- Nenhuma alteração de código, dados, schema, RLS ou configuração do Supabase/Google Cloud.
- `www/js/auth.js` e todos os ficheiros do app: **intactos**.
- Nenhuma credencial transcrita (Client Secret, chaves `service_role`/`sb_secret` ignoradas).
- Login por e-mail e senha não foi tocado nem testado contra produção.
