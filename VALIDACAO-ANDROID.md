# Etapa Android — Validação da nova versão (APK de teste)

**Branch:** `arena/a5269d1c-motoristapro-app` · **HEAD:** `35c14e2` · **Base do pedido:** `302dc02`
**Tag de restauro:** `pre-fase2-97d89c8` · **Data:** 2026-11-08

---

## 1. Estado inicial confirmado (antes de qualquer alteração)

| Verificação | Resultado |
|---|---|
| Branch | `arena/a5269d1c-motoristapro-app` ✔ (autorizada) |
| Commit | `1815b0a` (árvore limpa, igual a `origin`) |
| Tag de restauro | `pre-fase2-97d89c8` → commit `97d89c8` ✔ existe |
| `main` | continua em `9bad2ea` — **sem merge**, como pedido |

---

## 2. Consistência do código e dos ficheiros Android

| Verificação | Resultado |
|---|---|
| `www/js/config.js` | `https://xncxzczftetctpazzecu.supabase.co` ✔ |
| `assets/public/js/config.js` (o que vai no APK) | mesma URL ✔ |
| Chave | `sb_publishable_…` (pública, do projeto atual) ✔ |
| Referências ao projeto antigo em `www/` + `android/` | **1** (ver ponto 3 — era a página de emergência) |
| `diff -r www` ↔ `assets/public` | idêntico ✔ |
| `webDir` | `www` ✔ (o APK é feito de `assets/public`, não de `www`) |
| Capacitor | android/core/cli 8.6.0, app 8.1.2, browser 8.0.5, filesystem 8.1.5, share 8.0.3 |

---

## 3. Alterações feitas (e o que ficou de fora)

### 3.1 `www/atualizar.html` — última referência ao projeto antigo

A página de emergência disparava o aviso *se* o `config.js` do servidor contivesse
`ewmtphddypfcllewkgzl`. Isso mantinha a string dentro do APK **sem função útil**: se o
projeto foi apagado, comparar com um ref morto nunca ajuda. Passou a fazer o que
interessa — testa `MP_SUPABASE_URL + /auth/v1/health` com timeout de 6 s e diz
“o endereço configurado não responde”. Resultado: **zero referências ao projeto antigo
no app**.

### 3.2 `scripts/verify-android-assets.js` (novo)

Verifica o que o Gradle empacota: URL/ref/chave nos assets, ausência do projeto antigo,
assets iguais a `www/`, versão e `versionCode` derivados, deep link == `appId`.
Falha o build se algo divergir. Integrado no `npm test` (`npm run android:verify`).

### 3.3 `scripts/verify-apk.js` (novo)

Abre o **APK compilado** como ZIP, lê o `AndroidManifest.xml` binário (AXML: string
pool, resource map, atributos) e extrai `package`, **`versionCode`** e **`versionName`
realmente gravados**. Lê o `assets/public/js/config.js` de dentro do pacote e reprova:
projeto antigo, chave que não seja `sb_publishable_`, qualquer `sb_secret`/`service_role`.

Validado com 4 fixtures (ZIP + AXML sintéticos, em `tests/lib/axml-fixture.js`):

| Fixture | Resultado |
|---|---|
| APK correto | **aprovado** |
| `versionCode 1` / `versionName "1.0"` | **reprovado** (o cenário do APK atual) |
| URL do projeto antigo | **reprovado** |
| `sb_secret` no lugar da publishable | **reprovado** |

### 3.4 CI — **não alterado** (limitação de permissões, explicada)

O pedido incluía “corrigir o workflow para compilar a partir da branch”. Tentei e **não
foi possível**:

```
! [remote rejected] (refusing to allow a GitHub App to create or update workflow
  `.github/workflows/build.yml` without `workflows` permission)
could not create workflow dispatch event: HTTP 403: Resource not accessible by integration
```

O token desta sessão não tem as permissões `workflows` nem `actions:write`. Portanto:
- **`.github/workflows/build.yml` está intacto** (`git diff` = 0 linhas);
- a proposta está em `ci/build-workflow.proposta.yml`, com as instruções de aplicação
  no cabeçalho. Ela corrige os três problemas reais do workflow atual:
  1. `on: push` só em `main`/`master` → **nenhum APK foi gerado depois da troca de URL**;
  2. `npx cap sync` sem verificação → o APK podia levar assets congelados;
  3. nenhuma validação do APK e nenhum `npm test` antes de compilar.

---

## 4. Compilação do APK — **não foi possível neste ambiente**

Não há como compilar aqui, e não improvisei alternativas fora do escopo:

| Requisito | Estado |
|---|---|
| JDK 21 | ausente (`java: command not found`; nenhum JRE no sistema) |
| Android SDK (`sdkmanager`, platform 36) | ausente |
| `dl.google.com` (SDK) | **bloqueado** (SSL_ERROR_SYSCALL) |
| `objects.githubusercontent.com` (artefactos) | **bloqueado** |
| `nodejs.org`, `download.java.net`, `api.sdkman.io` | **bloqueados** |
| `registry.npmjs.org` | acessível (npm ci funciona) |

**Conclusão honesta:** o APK **não foi gerado nesta sessão**. Não há binário para
entregar; qualquer ficheiro que eu produzisse seria simulado, e isso seria pior do que
não entregar.

O que **foi** executado, na ordem exata do CI, até ao limite do ambiente:

```
✔ npm ci                     138 pacotes, exit 0
✔ npm run version:check      versão sincronizada: 1.18.2 (versionCode 11802)
✔ npm test                   92 asserções, 0 falhas, exit 0
✔ npx cap sync android       plugins + assets + configuração, sem alterar ficheiros
✔ npm run android:verify     assets consistentes, URL correta
✘ ./gradlew assembleDebug    impossível (sem JDK/SDK)
```

O único passo não exercitado é exatamente o que precisa de JDK + Android SDK.

---

## 5. `versionCode` e `versionName` (verificados no código)

| Onde | `versionName` | `versionCode` |
|---|---|---|
| `package.json` (fonte única) | `1.18.2` | — |
| `<meta name="app-version">` | `1.18.2` | — |
| `android/app/build.gradle` | `1.18.2` | **11802** (= 1×10000 + 18×100 + 2) |
| APK instalado hoje (inferido) | `1.0` | `1` |

`versionCode 11802 > 1` → o Android aceita instalar por cima como **atualização**
(mantém dados e sessão); não é necessário desinstalar. O `versionName` do instalado
(`1.0`) é a forma mais rápida de confirmar, no aparelho, que o APK é antigo.

---

## 6. Testes executados

| Teste | Resultado |
|---|---|
| `npm test` (jsdom, servidor local) | **92 asserções, 0 falhas** |
| `npm run version:check` | sincronizado (1.18.2 / 11802) |
| `npm run android:verify` | assets corretos, sem projeto antigo |
| Fixtures AXML/ZIP do verificador de APK | 4/4 cenários com o resultado esperado |
| `npm ci` limpo (como no CI) | exit 0 |
| Cálculos financeiros | **não tocados** (nenhum ficheiro de cálculo alterado nesta etapa) |
| Dados do utilizador | **não tocados** (sem migração, sem limpeza, sem reinstalação) |

---

## 7. O que falta para ter o APK na mão

Duas vias, ambas sem tocar em `main`:

**A. Aplicar a proposta de CI (recomendado, permanente)**
Precisa de um token/pessoa com permissão `workflows`:
```
cp ci/build-workflow.proposta.yml .github/workflows/build.yml
git add .github/workflows/build.yml
git commit -m "ci: gerar APK em main e arena/** e validar o pacote"
git push
```
Depois: Actions → *Gerar APK do MotoristaPro* → artefacto `MotoristaPro-APK-de-teste`
(14 dias). Com a proposta, o build falha de propósito se o APK não contiver o projeto
correto ou a versão certa.

**B. Sem alterar o workflow (imediato, mas frágil)**
Actions → *Gerar APK do MotoristaPro* → **Run workflow** → escolher a branch
`arena/a5269d1c-motoristapro-app`. O workflow atual já faz `npm ci` + `npx cap sync` +
`assembleDebug`, por isso deve gerar um APK correto; a diferença é que **não** verifica
o resultado nem corre os testes antes — o artefacto chama-se
`MotoristaPro-Instalador-Android`.
Nota: eu não consegui disparar isto (`workflow_dispatch` deu 403); tem de ser clicado
no GitHub por si.

Depois de qualquer das vias, o APK passa no verificador local:
```
node scripts/verify-apk.js <caminho>/app-debug.apk
```

---

## 8. Garantias do que **não** foi feito

- Sem merge em `main` (continua `9bad2ea`); sem PR.
- Sem alteração de configuração do Supabase (só leitura: projeto, auth, tabelas).
- Google OAuth **continua desligado** (`external_google_enabled: false`).
- Sem publicação, sem loja, sem deploy.
- Sem alteração de dados, histórico ou cálculos financeiros; sem instalação limpa.
- Nenhum segredo exposto: as chaves tratadas são publishable (públicas por desenho);
  a `service_role`/`sb_secret` nunca foi copiada para nenhum ficheiro.
- `.github/workflows/build.yml` intacto (apenas repropussado em `ci/`).

**Aguardo autorização para a etapa de instalação e testes no aparelho** — e, se quiser
o APK por CI, diga qual das vias (A ou B) prefere.
