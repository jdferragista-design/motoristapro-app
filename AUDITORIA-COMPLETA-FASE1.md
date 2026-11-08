# AUDITORIA TÉCNICA COMPLETA — MotoristaPro App
## Fase 1: SOMENTE AUDITORIA

**Data:** 2026-11-08
**Commit auditado:** `97d89c8` (branch `arena/a5269d1c-motoristapro-app`)
**Escopo:** repositório inteiro em HEAD, execução real dos testes, inspeção do banco Supabase em modo leitura
**Nenhum ficheiro do app foi alterado nesta fase.**

---

## A. RESUMO EXECUTIVO

### Estado geral

O app **funciona** para o núcleo do que se propõe: registrar turnos, calcular custos e mostrar resultado. Os cálculos financeiros principais foram corrigidos nas sessões anteriores e hoje têm cobertura de teste (53 asserções, todas verdes). O que **não** funciona é a camada de atualização/distribuição, e há dois defeitos de robustez que derrubam o app inteiro.

### Avaliação de qualidade: **5,6 / 10**

| Nota | Valor | Justificativa em uma linha |
|---|---|---|
| Arquitetura | 5,0 | 7 módulos com 116 globais, sem bundler, sem tipos, sem lint |
| Qualidade do código | 6,5 | Legível e comentado; sem lint/tipos, acoplamento ao `state` global |
| UX/UI | 6,0 | Contraste corrigido, mas 24 `alert()` nativos e densidade excessiva |
| Funcionalidades | 7,0 | Núcleo sólido e testado; login/nuvem inoperantes na prática |
| Segurança | 6,5 | Sem segredos expostos, RLS endurecido; falta CSP e `allowBackup` |
| Performance | 4,5 | `render()` 1.074 ms com 199 turnos — inviável em telemóvel médio |
| Escalabilidade | 4,0 | Estado completo reescrito a cada gravação; sem paginação |
| **Confiabilidade** | **4,0** | Um campo em falta numa manutenção derruba todo o `render()` |

### Contagem de problemas

| Gravidade | Qtd | IDs |
|---|---:|---|
| CRÍTICO | 2 | C-01, C-02 |
| ALTO | 7 | A-01 … A-07 |
| MÉDIO | 9 | M-01 … M-09 |
| BAIXO | 6 | B-01 … B-06 |
| INFORMATIVO | 5 | I-01 … I-05 |
| **Total** | **29** | |

### Os três principais riscos

1. **C-01 — `render()` quebra com dados malformados.** Um objeto em `state.maintenance` sem `interval` lança `TypeError` e **impede a renderização de toda a aplicação**. Reproduzido: 2 de 10 cenários de dados corrompidos derrubam o app. Como o estado vem de `localStorage` e da nuvem, um único registo corrompido deixa o utilizador com ecrã em branco.
2. **C-02 — Os 199 turnos não podem ser recuperados sem o aparelho.** Não existe cópia automática, nem exportação agendada. Se o telemóvel for perdido antes do primeiro sync bem-sucedido, os dados desaparecem.
3. **A-01 — `render()` leva ~1 s e corre a cada gravação.** Em telemóvel de gama baixa isso significa 2–4 s de bloqueio do ecrã a cada turno registado.

### Limitações desta auditoria

Declaradas explicitamente, conforme exigido:

- **Não foi possível testar o login/nuvem por HTTP.** O sandbox tem saída de rede apenas para `github.com`, `registry.npmjs.org`, `pypi.org`. `curl` para o Supabase falha com `SSL_ERROR_SYSCALL`. Validei o registo de utilizador por SQL e a lógica de sync com um cliente simulado, mas **não** o endpoint real.
- **Não houve teste em dispositivo Android real.** Toda a execução foi em `jsdom` (sem layout, sem GPU, sem restrições de memória de telemóvel).
- **Não houve teste manual no browser do utilizador.** Os problemas de cache da secção A-02 foram diagnosticados por evidência do servidor + sintomas relatados, não por observação direta do `ServiceWorkerRegistration`.
- **`npm audit` reflete o grafo instalado**, não um build de produção empacotado.

---

## B. INVENTÁRIO TÉCNICO

### Tecnologias

| Camada | Tecnologia | Versão |
|---|---|---|
| Front-end | HTML/CSS/JS vanilla | — (**sem** framework, **sem** bundler, **sem** transpilação) |
| Empacotamento mobile | Capacitor | 8.5.0 |
| Backend | Supabase (Postgres 17 + GoTrue) | supabase-js 2.117.3 (vendorizado) |
| Persistência local | `localStorage['mp_html_state_v8']` | estado único, ~83 KB |
| Testes | jsdom + script próprio | 30.1.2 |
| CI | GitHub Actions | `assembleDebug` |

### Estrutura

```
www/                      7.302 linhas no total
├── index.html            1.344   (7 views, 12 modais, 201 style="" inline)
├── css/style.css           907
├── js/render.js          1.391   (toda a camada de apresentação)
├── js/ui.js                944   (handlers, modais, formulários)
├── js/data.js              804   (estado, migração, recorrentes, parceladas)
├── js/domain.js            653   (regras de negócio e cálculos)
├── js/auth.js              531   (Supabase, sync)
├── js/charts.js            196   (SVG desenhado à mão)
├── js/utils.js             173   (formatação, parse, máscara)
├── js/init.js              100   (arranque)
├── js/sw.js                119   (service worker)
└── js/vendor/supabase.js           (~10 linhas minificadas, build vendorizado)
tests/boot-smoke.js         ~260   (53 asserções)
android/                    shell Capacitor; minSdk 24, targetSdk 36, versionCode 1
```

### Pontos de entrada

- **Web/PWA:** `www/index.html` → 11 `<script>` em ordem fixa (sem módulos ES)
- **Android:** `MainActivity` do Capacitor → `www/index.html` em WebView
- **Arranque lógico:** `js/init.js`, que corre `syncRecurringExpenses()`, `syncInstallmentExpenses()`, `pruneOrphanGeneratedExpenses()` e depois `render()`

### Integrações

| Integração | Estado real |
|---|---|
| Supabase Auth (email/senha) | Configurado; utilizador criado; **não validado por HTTP** |
| Supabase Auth (Google OAuth) | `external_google_enabled: false` — **inoperante** |
| Supabase REST (`user_states`) | Tabela + RLS corretos; sync com lógica corrigida mas não testada em produção |
| Capacitor Filesystem / Share | Usados para backup JSON |
| WhatsApp (exportação de texto) | Implementado, `innerText` (sem risco de injeção) |

### Scripts disponíveis

```
npm test   → node tests/boot-smoke.js     (único script)
```

**Não existe:** `lint`, `typecheck`, `build`, `e2e`. Nem ESLint, nem TypeScript, nem `.editorconfig`.

### Dependências — `npm audit`

```
8 vulnerabilidades (6 moderate, 1 high, 1 critical)
```

A **crítica** é `@capacitor/android 8.5.0` — *GHSA-rvm3-566m-v7fv*: conteúdo remoto pode ser carregado na origem do app via proxy HTTP interno. Ou seja, **o app Android instalado está afetado**, e a versão instalada é exatamente a vulnerável. Correção disponível em `8.5.1+`.

---

## C. LISTA DETALHADA DE PROBLEMAS

### C-01 — `render()` aborta com dados malformados · **CRÍTICO**

| Campo | Conteúdo |
|---|---|
| **Ficheiro** | `www/js/render.js:626` e `:635` |
| **Descrição** | `renderMaintenance()` usa `m.interval.toLocaleString('pt-BR')` sem verificar que `interval` existe. `migrateState()` valida `vehicle`, `expenses`, `shifts`, `recurring` e `installments`, mas **não normaliza `maintenance`** (`data.js:205` apenas faz `Array.isArray ? valor : []`). |
| **Reproduzir** | `state.maintenance.push({id:9, name:"X"})` → `render()` |
| **Comportamento atual** | `TypeError: Cannot read properties of undefined (reading 'toLocaleString')`. A exceção sobe até `render()` e **nenhuma view é atualizada**. |
| **Esperado** | Item inválido ignorado ou exibido com valor por omissão; o resto do app renderiza. |
| **Impacto** | Ecrã em branco/estático para o utilizador. Como o estado vem de `localStorage` e da nuvem, um registo corrompido (ou um backup/restauro com esquema diferente) inutiliza o app sem forma de recuperação pela interface. |
| **Causa provável** | `migrateState` dá garantias fortes para as coleções novas e nenhuma para `maintenance`, que é a mais antiga. |
| **Correção recomendada** | Criar `normalizeMaintenance()` em `migrateState` com `interval: Number(x.interval) \|\| 0`, `lastKm: Number(x.lastKm) \|\| 0`, `name: String(x.name \|\| 'Manutenção')`; adicionalmente, envolver cada bloco de `render()` em `try/catch` para que uma view falhe sem derrubar as outras. |

**Evidência (execução real):**
```
FALHA  manutencao sem interval      -> QUEBRA: Cannot read properties of undefined (reading 'toLocaleString')
FALHA  manutencao com interval null -> QUEBRA: Cannot read properties of null (reading 'toLocaleString')
ok     turno sem apps / apps null / despesa sem amount / vehicle {} / fuelSettings {} / horas=0
```

---

### C-02 — Histórico só existe num aparelho · **CRÍTICO**

| Campo | Conteúdo |
|---|---|
| **Ficheiro** | `www/js/data.js` (persistência), `www/js/auth.js` (sync) |
| **Descrição** | Único mecanismo de durabilidade é `localStorage` + exportação manual de JSON. Não há cópia automática, nem agendamento, nem confirmação de primeiro sync bem-sucedido. |
| **Reprovação** | `localStorage` é apagado por: "limpar dados do site", modo privado, desinstalação, ou *Clear site data*. O auto-resgate que introduzi na sessão anterior **apaga as caches mas não o `localStorage`** — por isso não agrava, mas também não protege. |
| **Impacto** | Perda total de 199 turnos / 3,3 meses de histórico. |
| **Correção recomendada** | (a) exportação automática semanal para o Filesystem (Capacitor) com retenção de 3 cópias; (b) aviso persistente após 30 dias sem sync em nuvem; (c) bloqueio suave (modal) na primeira semana se nunca houve exportação. |

---

### A-01 — `render()` 1.074 ms com o histórico real · **ALTO**

| Campo | Conteúdo |
|---|---|
| **Ficheiro** | `www/js/render.js:400` `renderShiftsList()`; `www/js/data.js:151` (`render()` dentro de `saveState()`) |
| **Medição real** | `render()` **1.073,9 ms** · `saveState()` **1.032,9 ms** · `renderShiftsList()` **875,4 ms (81%)** · 199 turnos · estado 83.007 bytes |
| **Descrição** | `render()` reconstrói todas as 7 views a cada chamada, incluindo `renderShiftsList()`, que faz `innerHTML=''` e recria ~199 cartões completos; `saveState()` chama `render()` no fim. Resultado: **gravar um turno custa ~1 s de bloqueio da thread principal**, mesmo estando noutra aba. |
| **Comportamento esperado** | Renderizar só a view ativa e virtualizar/ paginar a lista de turnos. |
| **Impacto** | Em telemóvel de gama baixa (1/3 do desempenho do `jsdom`+Node em desktop), 2–4 s de interface congelada por gravação. Perceção de app "travado". |
| **Correção recomendada** | Render por view (flag de aba ativa); `renderShiftsList` com limite de 30 itens + "carregar mais"; separar `persist()` de `render()` em `saveState`. Ganho estimado: 85–90%. |

---

### A-02 — Atualização do app não chega ao utilizador · **ALTO**

| Campo | Conteúdo |
|---|---|
| **Ficheiros** | `www/sw.js`, `www/index.html` |
| **Descrição** | Em três tentativas consecutivas o HTML atualizou e o JS não. Causa: o browser reutiliza o service worker antigo quando `sw.js` responde `304`, e o handler de assets antigo era cache-first com `ignoreSearch:true` — que **anula o cache-busting `?v=N`**. O auto-resgate atual resolve o sintoma; a fragilidade de origem mantém-se. |
| **Impacto** | Qualquer correção publicada pode não chegar. Para um app financeiro, "corrigi o cálculo mas o utilizador continua a ver o número errado" é grave. |
| **Correção recomendada** | Servir `sw.js` com `Cache-Control: no-cache` no hosting definitivo; nunca usar `ignoreSearch` em JS; estratégia `stale-while-revalidate` só para ícones; versão embutida no HTML e comparada com a do JS (já feito, `#brandVersion`). |

---

### A-03 — Sem CSP e sem `integrity` · **ALTO**

| Campo | Conteúdo |
|---|---|
| **Ficheiro** | `www/index.html` |
| **Descrição** | Nenhum `Content-Security-Policy`, nem `<meta>` nem por cabeçalho. 11 scripts locais e 11 templates `innerHTML` com dados do utilizador. O `js/vendor/supabase.js` não tem `integrity`. |
| **Impacto** | Não há segunda linha de defesa contra XSS. Hoje o `esc()` cobre os campos testados (payload em 6 campos → 0 execuções), mas uma futura interpolação esquecida passa direta. |
| **Correção recomendada** | `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://xncxzczftetctpazzecu.supabase.co; img-src 'self' data:">`. Eliminar os dois `<script>` inline (auto-resgate e SW update) movendo-os para ficheiro, para poder apertar `script-src`. |

---

### A-04 — Login Google inoperante · **ALTO**

| Campo | Conteúdo |
|---|---|
| **Ficheiro** | `www/js/auth.js:169`; configuração do projeto Supabase |
| **Descrição** | O botão "Entrar com Google" chama `signInWithGoogle()`, que usa `signInWithOAuth({provider:'google'})`. No projeto, `external_google_enabled = false` (client ID e secret presentes, provider desligado). |
| **Reproduzir** | Configurações → Conta & Nuvem → "Entrar com Google". |
| **Comportamento atual** | Erro do provider "not enabled". O utilizador vê falha sem causa clara. |
| **Impacto** | O caminho de login mais natural está morto. Mitigado por eu ter acrescentado email/senha, mas a interface continua a oferecer o botão Google em primeiro lugar. |
| **Correção recomendada** | Ligar o provider no painel Supabase **ou** esconder o botão enquanto `false`. Não é corrigível por código. |

---

### A-05 — Versão de build inconsistente · **ALTO**

| Campo | Conteúdo |
|---|---|
| **Ficheiros** | `package.json:3` (`1.18.1`), `www/js/utils.js:30` (`v1.18.2`), `android/app/build.gradle:10-11` (`versionCode 1`, `versionName "1.0"`) |
| **Descrição** | Três fontes de verdade diferentes. O `versionCode 1` é fatal para distribuição: **o Android recusa instalar um APK com o mesmo `versionCode`**, então nenhuma atualização substitui a anterior — o utilizador tem de desinstalar (perdendo o `localStorage`, ver C-02). |
| **Impacto** | Impossível atualizar o app instalado no telemóvel sem perder dados. |
| **Correção recomendada** | `versionCode` incremental por build (via CI, `github.run_number`); sincronizar `package.json` com `APP_VERSION`; teste que falha se divergirem. |

---

### A-06 — `allowBackup="true"` expõe o histórico · **ALTO**

| Campo | Conteúdo |
|---|---|
| **Ficheiro** | `android/app/src/main/AndroidManifest.xml:5` |
| **Descrição** | Com `allowBackup` ligado, o `localStorage` do WebView entra no backup do Android (`adb backup`, Google Auto Backup). O histórico financeiro completo fica incluído, sem encriptação própria. |
| **Impacto** | Dados financeiros pessoais extraíveis de um backup do dispositivo. |
| **Correção recomendada** | `allowBackup="false"` (o app já tem exportação JSON manual) ou `dataExtractionRules` a excluir `app_webview/`. |

---

### A-07 — `escape` aplicado a 19 de 68 pontos de `innerHTML` · **ALTO**

| Campo | Conteúdo |
|---|---|
| **Ficheiros** | `www/js/render.js` (68 `innerHTML`, 19 `esc()`) |
| **Descrição** | A maioria dos pontos usa `esc()`, e o teste de injeção falhou em 6 campos — **não encontrei XSS explorável hoje**. Mas a superfície é grande e a disciplina é manual. Os 3 casos sem `esc` são numéricos (`toFixed`), portanto seguros. |
| **Risco** | Não é um bug atual: é a **condição que permite** um bug futuro. Classificado ALTO pela natureza dos dados (financeiros) e pela ausência de CSP. |
| **Correção recomendada** | Função `h\`...\`` (tagged template que escapa por omissão) ou migrar para `textContent`; teste de regressão que injeta payload em **todos** os campos persistidos. |

---

### M-01 — Sem lint, sem tipos, sem build · **MÉDIO**

`package.json` tem 1 script (`test`). Não há ESLint/Prettier/TypeScript/.editorconfig. 116 declarações globais de topo em 4 ficheiros. Consequência observada nesta própria sessão: um `\d` dentro de template literal virou `d` e passou despercebido até um teste falhar — um lint com regra de regex teria apanhado.

### M-02 — 24 `alert()`, 8 `confirm()`, 3 `prompt()` nativos · **MÉDIO**

Bloqueiam a thread, não são estilizáveis, e no Android WebView aparecem com o domínio do app. Em particular `confirm()` no meio de fluxos financeiros (excluir despesa, excluir compra parcelada) não permite desfazer.

### M-03 — Sem desfazer em exclusões · **MÉDIO**

`deleteExpense`, `deleteShift`, `deleteInstallment` apagam direto após `confirm`. Não há *undo*, nem lixeira. Num registo que o utilizador constrói manualmente há meses, um toque errado apaga dados irreversíveis.

### M-04 — `saveState()` engole falhas de quota parcialmente · **MÉDIO**

`data.js:145-155` já tem `try/catch` e avisa. Mas continua a chamar `render()` e `scheduleCloudSync()` mesmo quando a gravação falhou — o utilizador vê a interface atualizada com dados que **não** foram persistidos.

### M-05 — Sem paginação nem limite de histórico · **MÉDIO**

`renderShiftsList()` itera `state.shifts` completo. Com 199 turnos: 875 ms. Com 1.000 (≈1 ano de uso intenso, o cenário mais provável): estimativa linear ≈4,4 s.

### M-06 — `labels` sem associação · **MÉDIO**

0 de 57 `<label>` têm `for=`. Cada campo é envolvido pelo `<label>` nalguns casos, mas não em todos; leitores de ecrã anunciam "campo de edição" sem nome. Há 3 `aria-label` em todo o app.

### M-07 — `<html>` sem `lang` · **MÉDIO**

`index.html:1` não tem `lang`. Prejudica leitores de ecrã (pronúncia) e tradução automática. Custo de correção: 1 atributo.

### M-08 — Ecrã de login inalcançável · **MÉDIO**

`mpShowLoginScreen(true)` **nunca é chamado**; `#mpLoginScreen` está `display:none` e nenhum fluxo o abre. O código do ecrã (com o botão Google e "continuar offline") é morto. O login real acontece no modal de Configurações.

### M-09 — `versionName`/`versionCode` sem relação com o app · **MÉDIO**

`versionName "1.0"` contra `v1.18.2`. Confunde o utilizador e o suporte ("estou na 1.0" quando corre a 1.18).

### B-01 — 201 atributos `style=""` inline · **BAIXO**
Impede CSP estrita em `style-src` e dificulta temas. Já mitigado parcialmente por `.card + .card`.

### B-02 — 116 globais no `window` · **BAIXO**
Colisões acidentais; sem tree-shaking possível.

### B-03 — Dois `<script>` inline · **BAIXO**
O auto-resgate e o `serviceWorker.update()` inline impedem `script-src 'self'` sem `'unsafe-inline'`.

### B-04 — Densidade do painel · **BAIXO**
1.187 px de conteúdo num ecrã útil de ~710 px; 13 valores monetários simultâneos, sem hierarquia.

### B-05 — Recorrência de cálculo no `input` · **BAIXO**
`recalcShiftLive()` corre a cada tecla em 5 campos do modal, via `CALC_AFTER_MASK`. Custo baixo hoje, mas sem `debounce`.

### B-06 — `chart.js` sem `try/catch` · **BAIXO**
`charts.js` tem 0 `try/catch` em 196 linhas que manipulam SVG e dados. Uma série vazia pode quebrar a aba Gráficos.

### I-01 — Documentação desatualizada · **INFORMATIVO**
`CONECTAR-GOOGLE-SUPABASE.md` referencia o projeto `ewmtphddypfcllewkgzl` (4 ocorrências), que **não existe na conta** e já não é o configurado. Seguir este guia cria configuração errada. Não há `README.md`.

### I-02 — `ANALISE_MOTORISTAPRO.md` obsoleto · **INFORMATIVO**
Análise de 22/08/2026, anterior a todas as correções P0. Contradiz o estado atual.

### I-03 — Sem testes de domínio isolados · **INFORMATIVO**
As 53 asserções vivem num único `boot-smoke.js` que sobe o app inteiro em `jsdom`. Não há testes unitários de `domain.js` (cálculos), que é justamente o código com maior risco financeiro.

### I-04 — Sem i18n · **INFORMATIVO**
Strings pt-BR fixas no código. Relevante só se houver expansão.

### I-05 — Sem teste de acessibilidade automatizado · **INFORMATIVO**
Nenhuma verificação de contraste/labels no CI (as correções anteriores foram manuais).

---

## D. SEGURANÇA

### O que está correto (verificado)

- **`www/js/config.js`** contém apenas a *publishable key* (`sb_publishable_...`), que é pública por desenho. **Nenhum** `service_role`, `sb_secret`, token admin ou senha no front-end.
- `www/js/vendor/supabase.js` contém `sb_secret` apenas como **literal de deteção** interno da biblioteca (`e.startsWith('sb_secret_')`), não como chave.
- **XSS: testado e não explorável hoje.** Payload `<img src=x onerror=...>` injetado em 6 campos persistidos (`expense.title`, `shift.period`, `shift.notes`, `app.name`, `maintenance.name`, `vehicle.model`) → `window.__XSS` não executou, 0 `<img>` no DOM, dados preservados intactos.
- **RLS da base** (auditado por SQL na sessão anterior e endurecido em `supabase/migrations/20261108_01_hardening_rls.sql`): `anon` sem privilégio, `with_check` em todas as políticas `FOR ALL` (antes permitia escrever na linha de outro utilizador), catálogos separados por comando.

### Vulnerabilidades e riscos

| ID | Gravidade | Natureza | Evidência |
|---|---|---|---|
| A-03 | ALTO | Ausência de CSP | 0 ocorrências de `Content-Security-Policy` |
| A-06 | ALTO | Backup Android expõe histórico | `allowBackup="true"` na linha 5 |
| A-07 | ALTO | Superfície de `innerHTML` sem política de escape | 68 vs 19 |
| M-10 | MÉDIO | Dependência com CVE crítica | `@capacitor/android@8.5.0` — GHSA-rvm3-566m-v7fv |
| I-06 | INFORMATIVO | Sem `integrity` no vendor | sim |

**Nota sobre M-10:** é a única vulnerabilidade **crítica** do `npm audit` e afeta **exatamente a versão instalada** do shell Android. Não é teórica para este projeto.

### Dados pessoais (LGPD)

- Não há política de privacidade, nem ecrã de consentimento, nem `deleteAccount`. O app processa dados financeiros pessoais e (com login) email.
- O sync envia o **estado completo** (83 KB, com todos os turnos e despesas) para a nuvem. É o mínimo necessário para o modelo atual, mas não há aviso ao utilizador sobre o que é enviado.
- Backups JSON exportados pelo utilizador ficam **sem encriptação** onde ele os guardar.

---

## E. UX/UI

### Corrigido em sessões anteriores (verificado por medição)

- Contraste: `--text-dim` `#8b8bab` → **5,63:1** (AA). Todos os pares testados passam: `muted` 7,29:1 · `warning` 11,11:1 · `danger` 5,05:1 · `info` 8,66:1.
- Alvos de toque: `.btn-sm` de ~23 px → 34 px.
- Botão flutuante de ação primária; versão real no cabeçalho.

### Problemas em aberto

| ID | Problema | Evidência |
|---|---|---|
| M-02 | Diálogos nativos bloqueantes | 24 `alert`, 8 `confirm`, 3 `prompt` |
| M-03 | Sem desfazer | 3 funções de exclusão definitiva |
| M-06 | 57 labels, 0 com `for=` | contagem |
| M-07 | `<html>` sem `lang` | linha 1 |
| M-08 | Ecrã de login morto | `mpShowLoginScreen(true)` = 0 chamadas |
| B-04 | Painel com 1.187 px e 13 números | medição de blocos |
| — | 6 abas + 12 modais numa app de uso no carro | estrutura |
| — | Estados vazios inconsistentes: uns têm texto explicativo, outros ficam em branco | inspeção de `render*` |

**Elementos que aparentam ser clicáveis e não funcionam:** nenhum botão órfão. 47 funções chamadas no HTML, **todas** definidas. O botão "Entrar com Google" responde, mas falha por configuração (A-04).

---

## F. PERFORMANCE

| Métrica (199 turnos reais) | Valor |
|---|---|
| `render()` | **1.073,9 ms** |
| `renderShiftsList()` | **875,4 ms** (81%) |
| `saveState()` | **1.032,9 ms** |
| `buildSobraReal()` | 0,1 ms |
| Estado serializado | 83.007 bytes |
| Elementos no DOM | 4.616 |
| Elementos recriados por `render()` | **4.616 (100%)** |

**Gargalos, por ordem de impacto:**

1. **Re-render total a cada gravação** (A-01). `saveState()` → `render()` → 7 views, incluindo a lista completa de turnos, mesmo estando noutra aba.
2. **Sem virtualização** (M-05). Custo linear: ~4,4 s estimados com 1.000 turnos.
3. **`innerHTML=''` + reconstrução** de 199 cartões — sem diff, sem reciclagem de nós.
4. **`localStorage` síncrono** com 83 KB a cada gravação (~petos de 10–20 ms), além de `JSON.stringify` da árvore inteira.
5. **Sem `debounce`** em `recalcShiftLive()` (5 campos × cada tecla).

**Não encontrei:** vazamentos de memória (o padrão é substituir `innerHTML`, que liberta os nós antigos), chamadas de API redundantes (o sync é agendado com `setTimeout`), nem carregamento excessivo de recursos (16 ficheiros locais, sem rede).

---

## G. TESTES

### Executados

| Comando | Resultado |
|---|---|
| `npm ci` / `npm ls` | 146 pacotes, árvore íntegra |
| `npm test` | **53 asserções, 53 ✅, 0 ❌, exit code 0** |
| `npm audit` | 8 vulnerabilidades (1 crítica, 1 alta, 6 moderadas) |
| Harness jsdom — robustez | 10 cenários de dados malformados → **2 falham** (C-01) |
| Harness jsdom — XSS | 6 campos com payload → **0 execuções** |
| Harness jsdom — sync | 6 cenários de conflito → **todos corretos** |
| Harness jsdom — performance | medições da tabela F |
| Verificação de funções órfãs | 47 chamadas no HTML, **0 sem definição** |

### Não executados (e porquê)

| Alvo | Motivo |
|---|---|
| Login/nuvem ponta a ponta | sandbox sem saída de rede para `*.supabase.co` (`SSL_ERROR_SYSCALL`) |
| Build Android (`assembleDebug`) | exige SDK/Gradle; não disponível no sandbox |
| Teste em dispositivo real | indisponível |
| E2E de browser | sem Playwright/Puppeteer no ambiente |
| Lint / typecheck | **não existem** no projeto |

### Lacunas de cobertura

- `domain.js` (653 linhas, todos os cálculos financeiros) **não tem teste unitário**; é exercitado indiretamente.
- Nenhum teste de `charts.js`.
- Nenhum teste de acessibilidade.
- Nenhum teste de migração com backups de versões anteriores reais (só o backup atual).

---

## H. PLANO DE CORREÇÃO

Ordenado por gravidade, dependências e risco de regressão.

### Bloco 1 — Estabilidade (fazer primeiro, risco baixo)

| # | Item | Ficheiro | Risco | Depende de |
|---|---|---|---|---|
| 1 | **C-01** normalizar `maintenance` em `migrateState` + `try/catch` por bloco de `render()` | `data.js`, `render.js` | Baixo | — |
| 2 | **C-02** backup automático no Filesystem, 3 cópias | `data.js`, `init.js` | Médio | — |
| 3 | **M-04** não atualizar UI quando a persistência falha | `data.js` | Baixo | — |
| 4 | **M-07 + M-06** `lang="pt-BR"` e `for=` nos labels | `index.html` | Muito baixo | — |

### Bloco 2 — Performance (risco médio, exige teste visual)

| # | Item | Ficheiro | Risco | Depende de |
|---|---|---|---|---|
| 5 | **A-01** renderizar só a aba ativa | `render.js`, `ui.js` | Médio | — |
| 6 | **A-01/M-05** limite de 30 turnos + "carregar mais" | `render.js` | Médio | 5 |
| 7 | **B-05** `debounce` de 120 ms no `recalcShiftLive` | `ui.js` | Baixo | — |

### Bloco 3 — Distribuição e segurança

| # | Item | Ficheiro | Risco | Depende de |
|---|---|---|---|---|
| 8 | **A-05/M-09** `versionCode` incremental + versão única | `build.gradle`, CI | Baixo | — |
| 9 | **M-10** `@capacitor/android` → 8.5.1+ | `package.json` | Baixo | 8 |
| 10 | **A-06** `allowBackup="false"` | `AndroidManifest.xml` | Baixo | — |
| 11 | **A-03/B-03** CSP + extrair os 2 scripts inline | `index.html` | **Médio-alto** | 4 |

### Bloco 4 — Produto e UX (depois do resto estável)

| # | Item | Risco |
|---|---|---|
| 12 | **A-04** ligar Google OAuth no painel (config, não código) | — |
| 13 | **M-02** substituir `confirm`/`alert` por modais próprios | Médio |
| 14 | **M-03** desfazer em exclusões | Médio |
| 15 | **B-04** hierarquia do painel | Médio (decisão de produto) |
| 16 | **I-01/I-02** atualizar/recolher documentação obsoleta | Muito baixo |

**Dependência crítica:** o item 8 (`versionCode`) precede qualquer entrega em APK — sem ele, nenhuma correção chega a um telemóvel já com o app instalado, porque o Android recusa a substituição.

---

## Aguardando autorização para a Fase 2.

Nenhum ficheiro do repositório, do banco de dados ou de configuração foi alterado durante esta auditoria. Os únicos ficheiros criados foram harnesses temporários em `/tmp/probe/`, fora do repositório.
