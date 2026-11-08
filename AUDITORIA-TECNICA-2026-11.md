# Auditoria Técnica e Estratégica — MotoristaPro App

**Data:** 08/11/2026
**Repositório:** `jdferragista-design/motoristapro-app` (branch auditada: `main`, commit `9bad2ea`)
**Escopo:** `www/` (app completo), `android/` (shell nativo), `supabase/`, `tests/`, `.github/workflows/`, `package.json`
**Natureza:** auditoria de leitura. **Nenhum arquivo do projeto foi alterado.** Sondagens empíricas executadas em `/tmp` contra um servidor estático local dos próprios assets.

> **Nota metodológica sobre o `ANALISE_MOTORISTAPRO.md` já existente no repo:** aquele documento está **desatualizado** e descreve uma versão anterior do app (arquivo único `index.html` de 2.824 linhas, sem manifest, sem testes, sem plugins nativos, plugins = `[]`). O código atual tem 11 módulos JS, manifest, service worker, 2 plugins nativos, teste automatizado e módulo de autenticação. **Não usei aquele documento como fonte**; tudo abaixo foi verificado no código. Ele próprio é um item de dívida (documentação que contradiz o produto).

---

## 1. Resumo executivo

O MotoristaPro **não é um protótipo**. É um MVP funcional avançado, com um modelo de domínio financeiro que está **acima da média** dos apps de controle de ganhos para motorista de aplicativo: turnos multi-app com staging, R$/km, R$/h, custo por km, provisão de desgaste por km, paridade etanol×gasolina, km fora de serviço entre jornadas, meta mensal com projeção de ritmo, insights automáticos e fechamento formatado para WhatsApp. Aritmética monetária é feita em **centavos inteiros** — decisão de engenharia correta e raramente vista nesse tipo de app.

O problema não é "falta de funcionalidade". O problema é **confiabilidade dos dados** e **prontidão para lançamento comercial**:

1. **O motor de sincronização em nuvem pode destruir dados do usuário.** É *last-write-wins* sobre o estado inteiro em um único blob JSON, com um guard (`mpSyncBusy`) que **descarta silenciosamente** alterações concorrentes (`www/js/auth.js:214, 224-285`). Dois aparelhos = perda de dados. Isso é P0.
2. **O login Google no Android provavelmente não completa** — o código espera `?code=` e chama `exchangeCodeForSession`, mas o `supabase-js` embarcado usa `flowType: 'implicit'` por padrão, que devolve tokens no fragmento (`auth.js:117,181-190`). Confirmado no código; **não testado em device** (limitação declarada).
3. **Três bugs de regra de negócio que corrompem indicadores em silêncio**: máscara de centavos aplicada a **km e litros** (digitar "168" km grava `1,68`; digitar "40" litros grava `0,40` — verificado empiricamente); turno com duração 0 é salvo como **8 horas** (`ui.js:477,494`); campos de configuração **não aceitam zero** e o `calcFuel()` roda dentro do `render()`, reescrevendo o estado do usuário a cada render (`ui.js:732-735, 801-811`).
4. **Escala:** com 1.000 turnos, `render()` levou **2.637 ms** e `saveState()` **2.318 ms** no harness (jsdom). A causa é algorítmica, não do harness: `getKmFora()` recalcula e reordena todo o histórico **para cada turno**, e é chamado 3× por render → O(n² log n).
5. **Não está pronto para a Play Store**: sem exclusão de conta, sem política de privacidade/termos, `allowBackup="true"` expondo dados financeiros ao backup do Google, apenas APK **debug** com `versionCode 1` fixo, e o CI **não roda os testes**.

**Veredito em uma frase:** produto com domínio forte e engenharia de UI acima do esperado para o tamanho, mas com **fundação de dados frágil** — hoje ele é um "beta confiável para um único aparelho"; para virar produto comercial precisa de uma fase de consolidação de dados antes de qualquer feature nova.

**Maturidade geral: 5,0 / 10** (MVP avançado / beta comercializável com ressalvas).

---

## 2. Tecnologias e arquitetura identificadas

### 2.1 Stack (verificado)

| Camada | Tecnologia | Evidência |
|---|---|---|
| UI | HTML + CSS + **JavaScript vanilla (ES2020)**, sem framework, sem build step | `www/index.html` (1051 linhas), `www/css/style.css` (869), 11 arquivos em `www/js/` |
| Modularização | 11 scripts globais orquestrados por ordem de `<script>`; **sem ESM, sem bundler, sem TypeScript** | `www/index.html:1029-1039` |
| Empacotamento | **Capacitor 8.5.0** → Android nativo (`com.pro.driver`) | `package.json`, `capacitor.config.json` |
| Android | minSdk 24, compile/targetSdk **36**, Gradle **8.14.3**, Java 21 | `android/variables.gradle`, `android/app/capacitor.build.gradle` |
| Backend | **Supabase** (Auth Google + Postgres `jsonb`) | `www/js/auth.js`, `supabase/motoristapro-schema.sql` |
| Persistência local | `localStorage`, chave `mp_html_state_v8` | `www/js/data.js:134` |
| Offline | Service Worker (cache-first para assets, network-first para navegação) + manifest | `www/sw.js`, `www/manifest.json` |
| Gráficos | **SVG gerado à mão** (donut, área, sparkline, heatmap, barras) — sem biblioteca | `www/js/charts.js` (196 linhas) |
| Plugins nativos | `Filesystem`, `Share` (declarados), `Browser`, `App` (usados) | `android/app/src/main/assets/capacitor.plugins.json`, `auth.js:109` |
| Testes | 1 smoke test de boot em **jsdom** (12 asserções) | `tests/boot-smoke.js` |
| CI | GitHub Actions → `assembleDebug` → artefato APK | `.github/workflows/build.yml` |
| Observabilidade | Log local em `localStorage` (400 entradas) + export `.txt` | `www/js/utils.js:25-107` |
| Analytics / crash reporting | **Nenhum** (`grep` por sentry/firebase/analytics/crashlytics = 0) | — |
| iOS | **Não existe** pasta `ios/` | `ls` |

**Tamanho real do app:** 5.423 linhas em `www/` (excluindo vendor). Vendors: `vendor/supabase.js` 216 KB + `capacitor.js` 12 KB — **ambos *parseados* no boot, de forma bloqueante**.

### 2.2 Organização (a parte boa)

A separação em camadas, apesar de global, é **coerente e legível**:

```
utils.js   → utilitários puros: parseVal, toC/brlC (centavos), esc, datas, uid, logs
charts.js  → visualização SVG pura (sem estado)
data.js    → defaultData, state global, saveState, migrateState
domain.js  → regras: períodos, odômetro, totais de turno, combustível, agregações de gráficos, insights
ui.js      → interações, modais, CRUD, calculadoras
render.js  → renderização, relatórios, exportações, backup
init.js    → boot, PWA, primeiro uso, handlers globais de erro
auth.js    → Supabase, OAuth, sincronização, deep link
```

Isso é melhor do que a média de "app Capacitor feito por IA" e melhor do que a própria documentação antiga sugeria.

### 2.3 O que essa arquitetura **não** sustenta

- **116 funções globais** + `state` mutável global + `onclick="fn()"` inline no HTML → qualquer módulo pode mutar qualquer coisa; impossível testar regra isoladamente.
- **`render()` é full re-render** de todas as 7 views a cada mutação (dashboard, listas, gráficos, WhatsApp, configurações) — inclusive quando o usuário está em outra aba.
- **Sem build step** → sem tree-shaking, sem minificação, sem cache-busting real (usa `?v=25` manual em 11 lugares), sem sourcemaps para produção, sem lint, sem type checking.
- **Versão duplicada em 5 fontes**: `package.json` (1.18.1), `utils.js:25` (`APP_VERSION`), `capacitor.config.json` ("MotoristaPro v1.18"), `strings.xml`, `index.html` (title/apple-meta) + `manifest.json`. O Android nativo declara `versionCode 1` / `versionName "1.0"` (`android/app/build.gradle:10-11`) — ou seja, **o APK se identifica como 1.0 enquanto o app diz v1.18.1**.

---

## 3. Funcionalidades existentes (levantamento verificado)

Legenda: **✅ implementada e verificada** · **⚠️ implementada com ressalva** · **🔶 parcial/simulada** · **❌ ausente**

### Núcleo financeiro
| Funcionalidade | Estado | Evidência / observação |
|---|---|---|
| Lançamento de turno com múltiplos apps (Uber, 99, InDrive, particular, iFood, Lalamove, custom) | ✅ | `ui.js:278-334` (staging), `ui.js:436-515` (save) |
| Cálculo de horas automático por hora início/fim | ✅ | `ui.js:344-373` (trata virada de meia-noite) |
| Bruto = ganhos + gorjetas por app, em centavos | ✅ | `domain.js:114-127` |
| R$/km e R$/h por turno e por período | ✅ | `domain.js:384-411`, `render.js:114-124` |
| Custo por km (CPK) e custo combustível automático por turno | ✅ | `ui.js:376-433` |
| Provisão de manutenção R$/km configurável | ⚠️ | Funciona, mas **não aceita 0** (`ui.js:732`) |
| Paridade etanol × gasolina + veredito | ⚠️ | `ui.js:801-828` — mas `calcFuel()` **grava no estado a cada render** e força defaults |
| Simulador "aceitar ou recusar corrida" | ✅ | `ui.js:743-798`, com veredito em 3 níveis |
| Despesas com categorias (7) e campos de abastecimento | ✅ | `ui.js:574-618` |
| Média real km/L entre os 2 últimos abastecimentos com odômetro | 🔶 | `render.js:502-519` — **parcial**: usa só 2 abastecimentos, ignora tanque parcial/cheio, não vira série histórica nem alimenta o CPK |
| Manutenção preventiva por odômetro (intervalo + custo) | ✅ | `render.js:523-561`, `ui.js:633-719` |
| Km "fora de serviço" entre jornadas | ⚠️ | `domain.js:43-92` — conceito bom, **implementação O(n²)** e com viés: só funciona quando existe `odoStart` no 1º turno do dia |
| Odômetro derivado de leituras reais (não do km do turno) | ✅ | `domain.js:94-111` (decisão correta e documentada) |
| Meta mensal + projeção de ritmo ("vou bater?") | ✅ | `domain.js:414-425`, `render.js:257-267` |
| Insights automáticos (melhor dia, turno mais rentável, etanol) | ✅ | `domain.js:448-488` — heurísticas sobre dados reais, best-effort |
| Fechamento consolidado para WhatsApp | ✅ | `render.js:786-849`; teste garante paridade painel ≡ WhatsApp |
| Períodos: hoje / 7 / 30 dias / mês / tudo | ✅ | `domain.js:15-36` |

### Dados e relatórios
| Funcionalidade | Estado | Observação |
|---|---|---|
| 7 tipos de gráfico (evolução, dia da semana, despesas, por app, R$/h semanal, heatmap horário, meta acumulada) | ✅ | `render.js:1001-1211`, SVG puro |
| Export CSV compatível com Excel BR (BOM, `;`, vírgula decimal) | ✅ | `render.js:676-705` |
| Backup/restauração JSON | ⚠️ | `render.js:672-674, 759-783` — restauração **substitui tudo** sem backup prévio e sem validação de schema profunda |
| "Salvar no Google Drive" | 🔶 | `render.js:707-751` — **não é integração**: é *share sheet* + download. O nome do botão promete mais do que entrega |
| Export de logs de diagnóstico | ✅ | `render.js:939-965` |
| Limpar dados operacionais | ⚠️ | `render.js:968-981` — irreversível, um `confirm()` |
| Backup/sync automático em nuvem | ⚠️ | `auth.js` — existe, mas ver §6.1 (perda de dados) |

### Conta e plataforma
| Funcionalidade | Estado | Observação |
|---|---|---|
| Login Google (web) | ⚠️ | Código presente, redireciona pelo supabase-js |
| Login Google (Android, deep link) | ⚠️ | Deep link + troca de código: **inconsistente com o flow padrão** (`auth.js:117`) |
| App funcional 100% offline sem conta | ✅ | Local-first real; teste garante que o login **não bloqueia** a abertura |
| Instalação PWA (`beforeinstallprompt`) | ✅ | `init.js:4-10`, banner existe (`index.html:132`) |
| Múltiplos veículos | ❌ | Um veículo por instalação |
| Exclusão de conta / exportação LGPD | ❌ | `grep` deleteAccount = 0 |
| Política de privacidade / termos | ❌ | `grep` privacidade/LGPD/termos = 0 |
| Notificações (lembrete de manutenção, fechamento do dia) | ❌ | Sem plugin de notificação |
| Importação de extratos Uber/99 (CSV/PDF) | ❌ | Não existe; entrada é sempre manual |
| Impostos / MEI / DAS / IRPF | ❌ | Não existe (grande oportunidade — ver §9) |
| Multiusuário / frota | ❌ | Não existe |
| i18n / multi-moeda | ❌ | `pt-BR`/BRL hardcoded |

**Conclusão da seção:** a cobertura do **núcleo operacional do motorista** é boa e honesta — nada do que aparece na tela é "fake" (a antiga acusação de gráfico com números hardcoded **não se aplica mais**: `grep` por arrays fixos = 0). O que falta é o **período pós-turno** (impostos, notas, importação) e o **pós-instalação** (notificação, backup automático, multi-veículo).

---

## 4. Pontos fortes (específicos, não genéricos)

1. **Aritmética monetária em centavos inteiros.** `toC()` converte na fronteira, `brlC()` centraliza a formatação (`utils.js:15-23`). Elimina `0.1+0.2` em um app onde o número exibido é o produto. Isso é decisão de engenheiro sênior.
2. **Modelo de domínio genuinamente pensado para o usuário.** "Km fora de serviço entre jornadas" (`domain.js:43-92`), provisão de desgaste por km, paridade de combustível e projeção de meta são features que apps genéricos de finanças não têm. Isso é o verdadeiro ativo do produto.
3. **Local-first de verdade.** Sem conta, o app é plenamente funcional e offline (SW + assets embarcados). O login é **opcional e não bloqueia** — e existe um teste que garante isso (`tests/boot-smoke.js`).
4. **Migração de schema defensiva.** `migrateState()` (`data.js:142-155`) faz merge com defaults e trata campos ausentes em restaurações antigas — evita a classe de bug "backup antigo quebra o app".
5. **Escape de HTML presente nos pontos críticos.** `esc()` (`utils.js:120`) é usado em nomes de app, títulos de despesa, notas, legendas de gráfico. Não é sistemático (ver §6.4), mas existe.
6. **Teste de boot automatizado.** 12 asserções em jsdom que cobrem boot, primeiro uso, paridade painel↔WhatsApp e odômetro zero. **Eu executei: 12/12 passam.** Ter teste em um projeto desse porte é sinal de maturidade.
7. **Identidade visual coerente.** Paleta escura consistente, hierarquia clara, gráficos SVG que não dependem de CDN (funcionam offline).
8. **RLS correta no banco.** `supabase/motoristapro-schema.sql` habilita RLS com policy por `auth.uid()`, sem policy para `anon`. A anon key no cliente é o modelo correto do Supabase — **não é vazamento** (ver §7).
9. **Diagnóstico embutido no produto.** `logEvent` + `exportLogs` dão suporte ao usuário sem analytics de terceiros — escolha defensável em privacidade.

---

## 5. Diagnóstico do domínio: problemas de lógica e cálculo

> Todos os itens abaixo foram **confirmados por leitura de código**, e os marcados com 🧪 foram **confirmados empiricamente** por execução.

### 5.1 🧪 Máscara de centavos aplicada a grandezas que não são dinheiro — **crítico silencioso**

`ui.js:15-18`:
```js
const CENTS_MASK_IDS = ['appGrossInput', 'appTipsInput', 'shiftKmTotal', 'shiftFuelCost',
  'expAmount', 'expLitersInput', 'simOffer', 'simPickup', 'simTrip', ...
```
`maskCents()` (`utils.js:139-142`) interpreta **todos os dígitos como centavos**. Resultado medido:

| Campo | Usuário digita | Campo passa a valer | Efeito |
|---|---|---|---|
| `shiftKmTotal` (KM do turno) | `168` | **`1,68`** | R$/km **100× maior** |
| `expLitersInput` (litros) | `40` | **`0,40`** | R$/L **100× maior**, km/L absurdo |

O KM do turno alimenta **R$/km, CPK, provisão de manutenção, km fora de serviço, Heatmap, gráfico de evolução e o fechamento do WhatsApp**. Um usuário que digite "168" (o caso natural — o placeholder é `Ex: 168,40`) grava 1,68 km e vê o app inteiro errado sem nenhum aviso. **Isso é o bug mais grave do produto em impacto de confiança**, porque não gera erro: gera número plausível e errado.
- **Arquivos:** `www/js/ui.js:15-18`, `www/js/utils.js:139-142`.
- **Correção:** remover `shiftKmTotal`, `simPickup`, `simTrip`, `expLitersInput` da lista de máscara de centavos; usar `inputmode="decimal"` com parser `parseVal` (que já aceita vírgula) e máscara decimal própria (2 casas, sem deslocar a vírgula).

### 5.2 🧪 Turno com duração zero é gravado como 8 horas
`ui.js:477` e `ui.js:494`: `hours: hours > 0 ? hours : 8.0`. Confirmei que `timeStart === timeEnd` produz `finalHoursValue = 0.00` e o turno é salvo com `hours = 9` no teste (porque reaproveitou o default do formulário). Um turno sem horas informadas — ou de duração real 0 — **inventa 8 horas** e contamina R$/h, "horas trabalhadas" no WhatsApp e a média por hora do heatmap.
- **Correção:** `hours: hours > 0 ? hours : null` e tratar `null` como "não informado" nas agregações (não somar, não dividir), com aviso na UI.

### 5.3 🧪 Configurações rejeitam zero e o estado é reescrito a cada render
- `ui.js:732-735`: `|| 0.18`, `|| 7000`, `|| 2.20`, `|| 35.00`. Confirmei: salvar reserva `0,00`, meta `0` e meta/hora `0,00` resulta em **0,18 / 7000 / 35** — o usuário não consegue desligar a provisão de manutenção nem zerar metas (caso real: motorista que quer ver o bruto puro).
- `ui.js:801-811`: `calcFuel()` **grava** em `state.fuelSettings` (`gasP`, `gasKml`…), e `calcFuel()` é chamado de dentro de `render()` (`render.js:339`) sempre que nenhum dos 4 campos de combustível está focado. Ou seja: **o render escreve no estado do domínio**. Qualquer render pode sobrescrever preços/médias com defaults quando o campo estiver vazio ou 0 — e `render()` roda a cada `saveState()`. Isso viola o princípio "render é função pura do estado" e já produziu, no histórico do app, o bug de "dado que volta sozinho".

### 5.4 Edição de abastecimento reescreve o preço do combustível global sem avisar
`ui.js:587-593`: salvar qualquer despesa de combustível sobrescreve `state.fuelSettings.gasolinePrice|ethanolPrice` com `amount/liters`. Isso **recalcula retroativamente** o custo de combustível de todos os turnos já lançados (que usam `fuelSettings` ou o último abastecimento via `getLastFuelInfo()`), mudando números históricos fechados. Existe um snapshot/restore para o **cancelamento** (`ui.js:147-166`) — bom — mas não para o **efeito retroativo**.
- **Correção:** separar "preço de referência para projeção" de "custo realizado do turno" (armazenar `costPerKmAtLaunch` no turno, congelado) — ver §10 P1-4.

### 5.5 `getLastFuelInfo()` usa a média **digitada**, não a média **medida**
`domain.js:181-184`: `avgKml = state.fuelSettings.ethanolKmPerL || 8.2`. Mas o app **já calcula** a média real (`render.js:502-519`). O CPK, o custo automático do turno e o veredito do simulador usam a média digitada, não a observada. É uma inconsistência de produto: o app sabe o número certo e usa o número declarado.
- **Correção:** hierarquia `média real (≥2 tanques completos) → média do usuário → default`, com selo indicando a origem do número.

### 5.6 Odômetro: modelo correto, execução incompleta
`syncVehicleOdometer()` = `max(base manual, maior odômetro de despesa, maior (odoStart+km))` (`domain.js:108-111`). É um bom modelo, mas:
- **Não é monotônico em edição/exclusão** de turno ou despesa: excluir o registro que definia o máximo **faz o odômetro recuar**, e a manutenção preventiva "desmarca" sozinha (muda `lastKm` relativo).
- `odoStart` só aparece no 1º lançamento do dia (`ui.js:198-205`); se o usuário lançar o 2º turno antes do 1º, o campo não aparece e o dia inteiro fica sem base para "km fora de serviço".
- **Correção:** histórico de leituras de odômetro (append-only, com fonte: turno/abastecimento/manual), odômetro = última leitura por data; alertar se uma leitura for menor que a anterior.

### 5.7 Duas definições de "reserva" convivem
`render.js:80-82` calcula o "Fundo de Reserva" sobre **todo o histórico**, ignorando o período selecionado, enquanto o card de despesas ao lado respeita o período (`render.js:70`). Dois números com o mesmo nome semântico e escopos diferentes na mesma tela = confusão garantida. Documentado em comentário, mas não sinalizado na UI.

### 5.8 Perdas de contexto na exportação
- `buildCSVContent()` exporta turnos e despesas **sem filtro de período** (`render.js:684, 697`) — o usuário que selecionou "hoje" exporta tudo.
- `exportCSV`/`exportJSONBackup` não incluem `fuelSettings`/`vehicle` no CSV (o JSON inclui) → relatório do contador perde metas e parâmetros.

---

## 6. Análise de código, arquitetura e segurança

### 6.1 P0 — Sincronização em nuvem pode apagar dados do usuário

Modelo: um blob `state` inteiro por usuário em `public.user_states (user_id, state jsonb, updated_at)`, com comparação de `updated_at` vs `MP_SYNC_KEY` local.

Falhas concretas (todas verificadas no código):

| # | Falha | Evidência | Consequência |
|---|---|---|---|
| a | `mpRunGuarded` **descarta** a execução se já houver sync em andamento; `scheduleCloudSync` agenda e o timer é o único caminho | `auth.js:206-221` | Alterações feitas durante um push são **silenciosamente perdidas** (não há fila nem re-tentativa) |
| b | Push grava o blob inteiro (`upsert`) | `auth.js:224-233` | Dois aparelhos = **last-write-wins destrutivo**; não há merge por registro nem tombstones de exclusão |
| c | Pull **substitui** `state` local inteiro | `auth.js:245-257` | Se o push anterior falhou (rede/RLS), a alteração local mais recente é **sobrescrita** sem aviso |
| d | Comparação `String(row.updated_at) > lastSync` com `lastSync` gravado **no relógio do aparelho** | `auth.js:231, 240` | Relógio adiantado no celular ⇒ o pull **nunca** vence ⇒ usuário fica preso em dados velhos; relógio atrasado ⇒ o push sempre vence e sobrescreve outro aparelho |
| e | `mpReconcile` é bloqueado por `mpSyncBusy` e não re-tenta | `auth.js:235-237` | Login pode terminar **sem pull** e sem aviso |
| f | Erros de push só geram log + status "offline" | `auth.js:277-281` | Usuário acredita estar sincronizado quando não está |

**Recomendação (P0):** trocar o modelo antes de qualquer feature nova —
1. Normalizar em tabelas (`shifts`, `shift_apps`, `expenses`, `maintenance_items`, `vehicles`, `settings`) com `id uuid`, `updated_at timestamptz` **do servidor**, `deleted_at` (tombstone) e `client_id`.
2. Sync incremental por registro, com fila persistente de operações (outbox em IndexedDB) e *retry* com *backoff*.
3. Resolução de conflito por registro (server-wins com detecção de divergência → notificar), não por blob.
4. Nunca bloquear a UI; exibir estado real ("N alterações pendentes").

### 6.2 P0/P1 — Login Google no Android inconsistente
`auth.js:181-190` define `skipBrowserRedirect` + abre o Browser; `auth.js:117` chama `mpSupabase.auth.exchangeCodeForSession(code)` esperando `?code=`. O `supabase-js` embarcado (`www/js/vendor/supabase.js`) tem `bn={autoRefreshToken:!0,persistSession:!0,detectSessionInUrl:!0,flowType:'implicit'}` — ou seja, **implicit** por padrão, que devolve `#access_token=...&refresh_token=...` no fragmento, e `exchangeCodeForSession` exige PKCE (verifier). Além disso, o handler lê `u.searchParams.get('code')` e ignora o fragmento.
**Não verificado:** se o projeto Supabase está configurado para PKCE por padrão (alguns projetos habilitam), e o comportamento real do WebView. **Não testei em device** — não há Android SDK neste ambiente. Mas a inconsistência entre o código do app e o default da lib é objetiva.
**Recomendação:** `flowType: 'pkce'` explícito em `createClient` + tratar fragmento **e** query no deep link + teste manual em device antes de comunicar a feature como pronta.

### 6.3 P1 — Riscos de perda de dados locais
- `data.js:133-136`: `localStorage.setItem` **sem try/catch**. `QuotaExceededError` (comum perto de 5 MB, e o app guarda 276 KB por 1.000 turnos) lança exceção dentro de `saveState()` → **nenhum aviso ao usuário, alteração perdida**, e o `render()` seguinte nem executa.
- Não há backup automático nem "última cópia" rotativa. O único backup é manual e o "Limpar dados" é irreversível (`render.js:968-981`).
- `migrateState()` protege campos, mas a restauração de JSON (`render.js:759-783`) só valida `imported.shifts || imported.vehicle` e substitui tudo — um arquivo de outro app com chave `vehicle` apaga o histórico.

### 6.4 Segurança — avaliação

**O que está correto:**
- Anon key + RLS no servidor é o padrão Supabase; a chave em `config.js` **não é segredo** (é pública por design) e a policy `auth.uid() = user_id` impede acesso cruzado. **Não é vulnerabilidade.**
- Nenhum `service_role`, token de longa duração ou senha no repositório (varredura por `service_role|secret|sk_live|eyJhbGci` = só texto de documentação).
- Sessão do Supabase persistida em `localStorage` (`storageKey: 'mp_sb_auth_v1'`) — aceitável para Capacitor WebView (não há cookie httpOnly; é o trade-off padrão da plataforma), mas significa que **fingerprint/root pode extrair o refresh token**.
- CSP: **ausente** (nenhum `<meta http-equiv="Content-Security-Policy">`). Em Capacitor o risco é menor (origem `capacitor://`), mas o app também roda como PWA web.
- `android:allowBackup="true"` (`AndroidManifest.xml:5`): dados financeiros entram no backup do Google/ADB **sem** `fullBackupContent` excluindo o WebView storage. Para um app financeiro isso é uma decisão de privacidade que precisa ser consciente (ou `allowBackup="false"`, ou regras de exclusão).
- Sem `FLAG_SECURE` (screenshot em app financeiro), sem certificate pinning, sem detecção de root — todos "nice to have", nenhum bloqueante.
- `esc()` cobre os pontos críticos; `badgeClass` é interpolado cru (`render.js:31, 238`) mas é campo controlado pelo app (risco baixo). **52 `innerHTML` para 16 usos de `esc()`** — o padrão de concatenação é o risco estrutural, não um XSS explorável hoje.

**LGPD / Play Store — bloqueantes comerciais reais:**
| Item | Estado | Impacto |
|---|---|---|
| Política de privacidade pública | ❌ | **Bloqueia publicação** |
| Termos de uso | ❌ | Bloqueia (e é proteção jurídica) |
| Exclusão de conta / dos dados na nuvem (art. 18 LGPD) | ❌ | **Obrigação legal** + exigência da Play Store |
| Exportação dos dados do titular | ⚠️ | Existe (JSON), mas não é apresentado como direito LGPD |
| Base legal / consentimento para sync | ❌ | Não há tela de consentimento |
| Data safety form (Play) | ❌ | Precisa declarar coleta de e-mail + dados financeiros |

### 6.5 Qualidade de código

**Positivo:** nomes claros, funções curtas na maioria, comentários que explicam **decisões** (ex.: "o km do turno NÃO soma no odômetro como leitura", `ui.js:504-507`), separação de camadas respeitada, ausência de `TODO/FIXME` (grep = 0 — código entregue é código "achado pronto").

**Negativo:**
- **Zero tipagem.** `parseVal` aceita `any` e retorna `0` para lixo — mascara erros de contrato (foi assim que `undefined` virou `0,00` em vários pontos).
- **28 `alert/confirm/prompt` nativos** — UX pobre e impossível de estilizar/testar.
- **Estado global mutável** + escrita de estado dentro de `render()` (§5.3) = acoplamento difícil de desfazer.
- **Duplicação de lógica de agregação** entre dashboard (`render.js:47-141`), WhatsApp (`render.js:786-849`) e gráficos (`domain.js:384-411`): o mesmo conceito "lucro líquido" é montado em 3 lugares com regras levemente diferentes; o teste de smoke existe **justamente porque já divergiram**.
- **Código morto confirmado:** `mpShowLoginScreen(true)` nunca é chamado (só `false` em `auth.js:127,139,202`) → a tela de login (`index.html:17-42`) e `mpContinueOffline`/`MP_OFFLINE_KEY` são inalcançáveis; `resetToDemo` foi removido mas `clearAllData` não restaura demo.
- **Dois caminhos para o mesmo dado:** `android/app/src/main/assets/public/` está **defasado** (sem `auth.js`/`config.js`, `index.html` 984 vs 1051 linhas). Quem compilar sem `npx cap sync` gera um APK **sem login e sem sync**.

---

## 7. Performance e escalabilidade

### 7.1 Medições (harness jsdom, assets reais, sem rede)

| Cenário | Resultado |
|---|---|
| Boot até `__MP_BOOTED` (5 turnos) | ~1,8 s no harness (inclui parse de 216 KB de supabase-js + 12 KB capacitor.js) |
| `render()` com 5 turnos | imperceptível |
| `render()` com **1.000 turnos** | **2.637 ms** |
| `saveState()` com 1.000 turnos | **2.318 ms** (276 KB serializados) |
| `buildCSVContent()` com 1.000 turnos | 6 ms (ok) |

> **Ressalva honesta:** jsdom é ~5–10× mais lento que WebView real, e o ambiente não tem GPU. Os valores absolutos **não** representam o aparelho do usuário. O que é transferível é a **causa**, que é algorítmica.

### 7.2 Causas confirmadas

1. **O(n² log n) no km fora de serviço.** `getKmFora(s)` (`domain.js:78-88`) chama `getWorkdayOdoSummaries()` — que percorre **todos** os turnos e **ordena** — e ainda faz `findIndex`. É chamado **para cada turno** em 3 lugares por render: `render.js:133` (pill do painel), `render.js:686` (CSV) e `render.js:814` (WhatsApp). Com 1.000 turnos: ~1.000 × (1.000 + n log n).
2. **Full re-render a cada mutação.** `saveState()` chama `render()` (`data.js:133-137`), que reconstrói dashboard, listas, 3 sparklines, gráfico ativo, WhatsApp e todos os campos de configuração. Salvar uma despesa re-renderiza 7 views.
3. **Persistência síncrona do blob inteiro** em cada mutação, sem debounce.
4. **Sync envia 100% do estado** a cada alteração (debounce 2,5 s) — com 1.000 turnos são 276 KB por clique. Em 3G, o usuário fica "Sincronizando…" e o guard descarta alterações (§6.1a).
5. **`localStorage` tem teto (~5 MB).** Estimativa: ~18.000 turnos ⇒ app para de salvar **sem aviso** (§6.3). Não há arquivamento/compactação.
6. **Parse bloqueante de 228 KB de vendor** no boot de cada abertura, em dispositivo low-end.

### 7.3 Escalabilidade

| Dimensão | Situação |
|---|---|
| Usuários simultâneos | Backend é só Auth + 1 tabela por usuário; **não escala em custo** (blob inteiro trafega a cada save), mas não cai |
| Crescimento do dado do usuário | **Degrada quadraticamente** (P2-1) e satura em ~18k turnos |
| Crescimento do código | 116 globais em 5,4k linhas: ainda navegável; em ~15k linhas vira ingovernável sem módulos |
| Multi-dispositivo | **Quebrado por design** (LWW sobre blob) |
| Multi-plataforma | Android + PWA; **sem iOS** |

---

## 8. Avaliação de UX/UI

### 8.1 O que funciona
- Identidade consistente (paleta, cards, badges), hierarquia clara no painel: bruto → despesas → líquido é a leitura certa para o público.
- **Fluxo do modal de turno é bem pensado**: apps → km/horas → resumo ao vivo (bruto, R$/km, R$/h, líquido). O "staging" (salvar app por app) evita o formulário gigante.
- Feedback em tempo real no simulador de corrida (veredito em 3 cores) — é a feature de maior "aha" do app.
- Rótulos em linguagem do motorista ("Fundo de Reserva", "Lucro Líquido Real", "KM fora de serviço").

### 8.2 Atritos concretos

| # | Problema | Evidência | Impacto |
|---|---|---|---|
| U1 | **7 abas** na navegação inferior/destacada em telas de 360 px | `index.html:88-112, 622-648` | Alvos pequenos, descoberta ruim; 7 itens é acima do máximo recomendado (5) |
| U2 | Tipografia de **10–11 px** em métricas, badges e legendas | `style.css` (≈15 ocorrências), `render.js` | Público que usa o app **dentro do carro, com sol no celular**; 10 px é hostil |
| U3 | **39 `<label>` sem `for=`**, 0 associações explícitas | `grep -c 'for="'` = 0 | Leitor de tela não anuncia campo; toque no rótulo não foca |
| U4 | **28 `alert/confirm/prompt`** nativos, inclusive para confirmar manutenção | `ui.js:700` (`prompt`), `render.js:869-871` | Quebra a linguagem visual, bloqueia thread, não é testável |
| U5 | Modais **sem Esc, sem focus trap, sem `role="dialog"/aria-modal`** | 0 `keydown/Escape` em `www/js` | Inacessível por teclado; botão físico "voltar" do Android **fecha o app** em vez de fechar o modal (nenhum `backButton` listener) |
| U6 | Só **tema escuro**, sem `prefers-reduced-motion` | `html class="dark"` fixo | Fora de qualquer critério WCAG AA para contraste em ambiente claro |
| U7 | Acentuação **mistura pt-BR e pt-PT** ("ecrã", "utilizador", "regista") | `init.js`, `auth.js` | Público brasileiro percebe como app "estrangeiro" |
| U8 | Botão **"Salvar no Google Drive"** não integra com Drive | `render.js:707-751` | Promessa quebrada → perda de confiança na feature mais sensível (backup) |
| U9 | Login **inatingível** pela UI | `auth.js:139` sempre `false` | Usuário não descobre o sync; feature existente é invisível |
| U10 | "Fundo de Reserva" com escopo diferente do card vizinho | §5.7 | Números que não fecham na mesma tela |
| U11 | Lançar turno = até **8 interações** (abrir modal, app, valor, viagens, salvar app, km, horas, salvar turno); repetir por app | `index.html:653-850` | Atrito alto no uso diário, que é **1–2× por dia, todo dia** |
| U12 | Sem estado vazio educativo nas abas (ex.: gráficos só dizem "nada aqui") | `render.js:1054-1059` | Usuário novo não sabe o que fazer |

### 8.3 Melhorias práticas de maior retorno
1. **"Lançar turno de hoje em 1 tela"**: form único com todos os apps visíveis (linha por app) + km/horas no rodapé + salvar. Elimina o staging para o caso comum (80% dos turnos são 1–2 apps).
2. **Reduzir para 5 abas**: Início · Lançamentos (turnos+despesas com segmented control) · Análises · Ferramentas (calculadoras) · Ajustes. Relatórios funde em Análises.
3. **Tipografia mínima 13 px / corpo 15 px** e modo claro opcional.
4. **Substituir `alert/confirm/prompt` por um `mpNotify` + modal de confirmação próprios** (o `mpNotify` já existe em `auth.js:18-33` — só não é usado fora do auth).
5. **Back button do Android**: fechar modal → voltar aba → sair (com confirmação).
6. **Onboarding de 3 telas** com meta + preço do combustível (é isso que faz a projeção funcionar).
7. **Renomear** "Salvar no Google Drive" → "Exportar backup (compartilhar/salvar)" até existir integração real.
8. **Tornar o login visível** numa faixa discreta no topo ("Faça backup na nuvem →") para quem não conectou.

---

## 9. Potencial comercial, monetização e evolução

### 9.1 Diferenciais competitivos reais (defensáveis)
1. **R$/h e R$/km ponderados por turno** com provision de desgaste — o motorista brasileiro pensa em "quanto sobrou por hora", não em faturamento bruto. Apps genéricos (Drivvo, iCarros) fazem manutenção; apps de corrida mostram bruto. O cruzamento é o diferencial.
2. **Fechamento multi-app para WhatsApp** — comportamento social já existente na categoria (grupos de motoristas). Vira canal de aquisição orgânico (cada print/post compartilhado carrega a marca).
3. **Simulador aceitar/recusar** com veredito imediato — feature de uso **durante** o trabalho (alto engajamento), não de "contabilidade de domingo".
4. **Local-first + login opcional** — barreira de entrada zero, o que é decisivo em público com dados caros e desconfiança de cadastro.

### 9.2 Lacunas que custam retenção hoje
| Lacuna | Por que dói | Complexidade |
|---|---|---|
| Sem lembrete/notificação de fechar o dia | O app depende de disciplina; 1 dia esquecido = série quebrada e insights piores | Baixa |
| Sem importação de extrato Uber/99 | Digitção manual diária é o principal motivo de abandono em apps desse tipo | Média-Alta |
| Sem visão de impostos (MEI/DAS/IRPF) | O motorista descobre o imposto no ano seguinte; quem resolve isso vira indispensável | Média |
| Sem multi-veículo / troca de carro | Motorista troca de carro com frequência; perde histórico ou duplica instalação | Média |
| Sem backup automático confiável | Se o celular é roubado/quebrado, perde tudo — e o app **promete** backup | Média |
| Sem comparação com "benchmark" | "Você está 12% abaixo da média de Uber em Uberlândia" é o tipo de frase que retém | Alta (dados) |

### 9.3 Modelo de monetização recomendado

**Gratuito (aquisição, sem limite de tempo, com limite de valor):**
- Turnos e despesas ilimitados; painel do mês; R$/km e R$/h; simulador (5/dia); fechamento WhatsApp (com marca); backup manual JSON.

**Premium — R$ 14,90/mês ou R$ 119/ano (2 meses grátis):**
| Feature premium | Justificativa de valor | Já existe base no código? |
|---|---|---|
| **Sync multi-dispositivo confiável + backup automático** | É a feature que o usuário paga para não perder | Base em `auth.js`, precisa reescrita (§6.1) |
| Relatório mensal em PDF + pacote para contador | Valor concreto em época de IRPF | CSV/JSON existem |
| **Módulo fiscal MEI/DAS/IRPF** (receita anual, % de imposto, reserva sugerida) | Dor real, alto valor percebido, baixa concorrência | `costPartsForRange` já tem a base |
| Importação de extratos (Uber/99 CSV) | Remove o atrito nº1 | Não existe |
| Multi-veículo + histórico por veículo | Troca de carro é frequente | Não existe |
| Insights avançados (meta semanal, projeção de 90 dias, alertas de manutenção) | `buildMonthPaceInfo` já faz metade | Parcial |
| Comparativo com benchmark regional (anonimizado, agregado) | Diferencial de retenção mais forte | Não existe (precisa backend + volume) |

**Não recomendado:** anúncios (AdMob) no app. Público de baixa renda + app financeiro + banner = destruição de confiança e da percepção de valor; o ARPU de ads seria menor que a conversão perdida.

**B2B (P3, receita subestimada):** plano para pequenas frotas/gestores (5–50 motoristas) com painel agregado, e **white-label** para cooperativas de transporte — o modelo de dados já suporta se `vehicles`/`drivers` forem normalizados.

### 9.4 Estratégia de retenção (ordenada por impacto/esforço)
1. **Notificação local diária às 21h** "Fechar o dia" com streak ("7 dias seguidos") — custo baixo, impacto alto.
2. **Meta semanal** além da mensal (a mensal demora 30 dias para dar feedback).
3. **Cartão-resumo compartilhável** (imagem gerada, não só texto) — aquisição orgânica.
4. **Comparação com o próprio histórico** ("seu melhor mês foi agosto; você está 8% abaixo") — já há todos os dados.
5. **Relatório de domingo** ("sua semana em 5 números") — cria ritual.

---

## 10. Plano de melhorias priorizado

> Critérios: **P0** compromete segurança/funcionamento/integridade dos dados · **P1** essencial para produto confiável · **P2** experiência/desempenho/funcionalidade · **P3** evolução/monetização.
> Complexidade: **B** = baixa (≤1 dia) · **M** = média (2–5 dias) · **A** = alta (1–3 semanas).

### P0 — Crítico (não lançar sem isto)

| # | Problema | Impacto | Solução | Cx | Arquivos |
|---|---|---|---|---|---|
| P0-1 | Sync LWW sobre blob pode **apagar dados**; guard descarta alterações | Perda permanente de histórico financeiro | Normalizar tabelas + sync incremental por registro com tombstones + outbox persistente + timestamp do servidor | **A** | `www/js/auth.js:206-285`, `supabase/motoristapro-schema.sql` |
| P0-2 | `localStorage.setItem` sem `try/catch`; quota estoura em silêncio | Alteração "salva" desaparece | `try/catch` + verificação de quota + aviso bloqueante + backup automático rotativo (últimas 3 cópias) | **B** | `www/js/data.js:133-137` |
| P0-3 | Máscara de centavos em **km e litros** | R$/km, CPK, km/L e insights **100× errados** (verificado) | Remover esses IDs da máscara; máscara decimal própria; validação de faixa (km ≤ 2.000/dia) | **B** | `www/js/ui.js:15-18`, `www/js/utils.js:139-142` |
| P0-4 | Turno com 0h vira **8h** | R$/h e horas trabalhadas falsos | `hours: null` + agregações ignoram; aviso na UI | **B** | `www/js/ui.js:477,494` |
| P0-5 | Sem política de privacidade, termos e **exclusão de conta** | Bloqueia Play Store e viola LGPD art. 18 | Telas + endpoint `delete-account` (Edge Function) + página pública | **M** | `www/index.html`, `www/js/auth.js`, Supabase |
| P0-6 | `calcFuel()` **escreve estado** dentro de `render()`; campos rejeitam 0 | Dado do usuário sobrescrito; metas inutilizáveis | Remover escrita do render; `??` em vez de `\|\|`; separar cálculo de exibição | **B** | `www/js/ui.js:801-811,732-735`, `www/js/render.js:339` |

### P1 — Alta prioridade (produto confiável)

| # | Problema | Impacto | Solução | Cx | Arquivos |
|---|---|---|---|---|---|
| P1-1 | Login Android inconsistente com `flowType` (implicit vs PKCE) | Login não completa; sync inacessível | `flowType:'pkce'` explícito, tratar query **e** fragmento, teste em device | **M** | `www/js/auth.js:117,181-190` |
| P1-2 | Login inatingível pela UI (`mpShowLoginScreen(true)` nunca chamado) | Feature invisível | Mostrar tela de login quando não autenticado (com "continuar sem conta"), ou remover a tela e expor em Ajustes | **B** | `www/js/auth.js:127,139,202`, `www/index.html:17-42` |
| P1-3 | `getKmFora()` O(n² log n) chamado 3×/render | Travamento a partir de ~300 turnos (≈1 ano de uso) | Calcular o resumo de odômetro **uma vez** por render e memoizar por `(stateVersion, period)` | **M** | `www/js/domain.js:43-92`, `render.js:133,686,814` |
| P1-4 | Custo do turno recalculado retroativamente quando muda preço/abastecimento | Histórico fechado muda sozinho | Congelar `costPerKmAtLaunch` e `fuelCost` no turno no momento do save | **B** | `www/js/ui.js:436-515`, `domain.js:151-193` |
| P1-5 | CI não roda testes; só APK **debug**; `versionCode 1` | Nenhuma garantia de regressão; impossível publicar/atualizar | `npm ci && npm test` no workflow, lint, `versionCode` de `GITHUB_RUN_NUMBER`, keystore via secrets, AAB release + Play Internal Testing | **M** | `.github/workflows/build.yml`, `android/app/build.gradle` |
| P1-6 | Artefatos nativos defasados em `android/app/src/main/assets/public` | Build manual gera APK sem login/sync | Remover do versionamento (é gerado por `cap sync`) + `.gitignore` | **B** | `android/app/src/main/assets/public/**` |
| P1-7 | Backup/restauração frágil; "Google Drive" não integra | Promessa quebrada em feature de segurança | Validação de schema (Zod), backup pré-restauração automático, renomear botão, ou integração real via Drive API | **M** | `www/js/render.js:672-783` |
| P1-8 | Sem `backButton`, modais sem Esc/focus trap/`role=dialog` | App fecha ao voltar; inacessível | Listener `App.backButton`, gestão de foco, `aria-modal` | **M** | `www/js/ui.js`, `www/index.html` |
| P1-9 | `allowBackup="true"` sem regras | Dados financeiros no backup do Google | `allowBackup=false` ou `fullBackupContent` excluindo WebView storage | **B** | `AndroidManifest.xml:5` |
| P1-10 | Duplicação da regra "lucro líquido" em 3 lugares | Divergência de números (já ocorreu) | Extrair `computePeriodSummary(period)` único e usar em dashboard/WhatsApp/gráficos | **M** | `render.js:47-141,786-849`, `domain.js:384-411` |

### P2 — Média prioridade (experiência e desempenho)

| # | Problema | Impacto | Solução | Cx | Arquivos |
|---|---|---|---|---|---|
| P2-1 | `render()` full em toda mutação (2,6 s/1.000 turnos) | App lento e "piscando" | Render por view (`renderDashboard`, `renderLists`…), só a view ativa; debounce no save | **A** | `render.js`, `data.js:133` |
| P2-2 | 7 abas, alvos pequenos | Descoberta e navegação | Consolidar em 5; Lançamentos com segmented control | **M** | `index.html:88-112,622-648`, `ui.js:87-105` |
| P2-3 | Tipografia 10–11 px | Legibilidade no carro/sol | Tokens de tipografia (mín. 13 px), escala 1.25 | **M** | `css/style.css` |
| P2-4 | 28 `alert/confirm/prompt` | UX inconsistente, não testável | `mpNotify` + `mpConfirm` próprios com Promise | **M** | `ui.js`, `render.js` |
| P2-5 | 39 labels sem `for`; sem ARIA de modal | Acessibilidade (e Play Store quality) | `for`/`id` em todos, `aria-*`, contraste AA, `prefers-reduced-motion` | **M** | `index.html`, `style.css` |
| P2-6 | km/L real usa só 2 abastecimentos e não alimenta CPK | Feature central subutilizada | Tanque cheio/parcial, série histórica, média móvel usada em `getLastFuelInfo` | **A** | `render.js:502-519`, `domain.js:151-193` |
| P2-7 | CSV ignora período e configurações | Relatório incompleto | Escopo por período + aba de configurações | **B** | `render.js:676-705` |
| P2-8 | Mistura pt-BR/pt-PT ("ecrã", "utilizador") | Percepção de produto estrangeiro | Revisão de copy; extrair string table (prepara i18n) | **B** | `init.js`, `auth.js`, `index.html` |
| P2-9 | Sem log de erros remoto | Suporte cego | Sentry (opt-in, com consentimento) ou export de logs já existente + botão "enviar diagnóstico" | **B** | `utils.js:52-107` |
| P2-10 | Vendor 228 KB parseado no boot | Boot lento em low-end | Carregar supabase-js sob demanda (`import()` só quando o usuário toca em "Entrar") | **B** | `index.html:1029`, `auth.js` |
| P2-11 | Documentação desatualizada (`ANALISE_MOTORISTAPRO.md`) | Decisões baseadas em premissa falsa | Reescrever/arquivar; adotar `CHANGELOG.md` | **B** | `ANALISE_MOTORISTAPRO.md` |

### P3 — Evolução e monetização

| # | Iniciativa | Valor | Cx |
|---|---|---|---|
| P3-1 | Notificação diária "fechar o dia" + streak | Retenção (maior ROI do roadmap) | M |
| P3-2 | Lançamento rápido de turno (1 tela, sem staging) | Atrito diário nº1 | M |
| P3-3 | Importação de extratos Uber/99 (CSV) | Elimina digitação manual | A |
| P3-4 | Módulo fiscal MEI/DAS/IRPF + PDF para contador | Premium com dor real | A |
| P3-5 | Multi-veículo e histórico por veículo | Caso de uso frequente | M |
| P3-6 | Cartão-resumo como **imagem** compartilhável | Aquisição orgânica | B |
| P3-7 | Benchmark regional anonimizado | Diferencial de retenção | A |
| P3-8 | iOS (Capacitor já suporta; falta pasta e CI macOS) | +40% de mercado potencial no segmento | M |
| P3-9 | Painel B2B para frotas / cooperativas | Nova linha de receita | A |
| P3-10 | Migração para stack com build (ver §11) | Sustentabilidade de longo prazo | A |

---

## 11. Caminho técnico recomendado (o que eu faria, na ordem)

**Fase 0 — Estabilização (1–2 semanas).** Fechar P0-2…P0-6 e P1-2, P1-4, P1-6, P1-9. São correções pequenas, de baixo risco, que eliminam a classe "número errado em silêncio" e "dado perdido". **Publicar como 1.19 antes de qualquer feature nova.**

**Fase 1 — Confiabilidade dos dados (3–4 semanas).** Reescrever a camada de dados (P0-1): tabelas normalizadas + outbox + sync por registro + resolução de conflito com timestamp de servidor + exportação/exclusão LGPD. Aqui entra também P1-3 (memoização) porque a nova camada já resolve o custo.

**Fase 2 — Experiência (3–4 semanas).** P2-1 (render por view), P2-2 (5 abas), P2-3/4/5 (tipografia, diálogos próprios, acessibilidade), P1-8 (back button), lançamento rápido (P3-2). É a fase que transforma "funciona" em "dá gosto de usar".

**Fase 3 — Monetização (contínuo).** P3-1 (notificação), P3-4 (fiscal), P3-5 (multi-veículo), P3-3 (importação). Fee de premium só depois de a base de dados ser confiável — cobrar por um sync que perde dados destrói a marca de forma irreversível.

**Sobre a stack (recomendação, não urgência):** o trio "vanilla + sem build + globais" ainda é sustentável neste tamanho e tem um benefício real (zero build, zero dependência, offline trivial). **Não recomendo reescrever agora.** O gatilho para migrar deve ser objetivo: quando o número de globais passar de ~200 ou as linhas de `www/js` passarem de ~12k. Nesse momento, a migração de menor risco é **Vite + TypeScript + módulos ESM mantendo a arquitetura de camadas atual** (sem trocar para framework), e persistência em **SQLite via Capacitor** com a camada de sync já desenhada na Fase 1. Trocar de framework antes disso é custo sem retorno.

---

## 12. Notas (0–10)

| Dimensão | Nota | Justificativa (evidência) |
|---|---:|---|
| **Arquitetura** | **5,0** | Camadas claras e respeitadas, mas 116 globais, sem build/módulos, estado mutável global e **escrita de estado dentro do render**; sync em blob único é arquitetura que não suporta o próprio produto (§2.3, §6.1) |
| **Qualidade do código** | **5,5** | Legível, comentado, sem `TODO`, com boas decisões (centavos); penalizado por zero tipagem, 3 bugs de regra confirmados (`ui.js:15,477,732`), duplicação de agregação e código morto |
| **UX/UI** | **6,0** | Identidade e fluxo de turno acima da média; penalizado por 7 abas, 10–11 px, 28 diálogos nativos, sem acessibilidade, promessa de "Google Drive" não cumprida e login invisível |
| **Funcionalidades** | **7,5** | Cobertura do núcleo operacional forte e **honesta** (nada simulado); falta pós-turno (impostos), importação, notificação, multi-veículo |
| **Segurança** | **5,5** | RLS e anon key corretas, sem segredos no repo, `esc()` nos pontos críticos; mas sem CSP, `allowBackup=true`, sessão em `localStorage`, e **zero** conformidade LGPD/Play Store |
| **Performance** | **5,0** | OK no uso normal (centenas de turnos), mas render/save de 2,6 s com 1.000 turnos por causa de O(n²), full re-render e blob síncrono |
| **Escalabilidade** | **3,5** | Multi-dispositivo quebrado por design, sync que cresce linearmente em tráfego, localStorage com teto silencioso, sem iOS |
| **Potencial comercial** | **7,0** | Diferencial real (R$/h + desgaste + multi-app + WhatsApp), público grande e mal atendido, caminho de premium claro; limitado por falta de confiabilidade e de conformidade para publicar |

### **Maturidade geral: 5,0 / 10 — "MVP avançado / beta comercializável com ressalvas"**

- **Estágio real:** entre *protótipo funcional* e *beta privado*. Não é "alpha" (as features funcionam e há teste), não é "release candidate" (dados e conformidade não sustentam).
- **Pronto para:** uso pessoal intenso em **um** aparelho; testes com 20–50 motoristas reais; coleta de feedback.
- **Não pronto para:** loja pública, cobrança, uso multi-dispositivo, e qualquer promessa de "backup garantido".

---

## 13. Limitações desta auditoria (declaradas)

1. **Não compilei o APK nem rodei em device** — não há Android SDK/Gradle neste ambiente. Tudo sobre Android vem de leitura de configuração (`AndroidManifest.xml`, `build.gradle`, `variables.gradle`, `capacitor.build.gradle`).
2. **Não testei o fluxo OAuth de ponta a ponta** — depende do projeto Supabase (provider Google habilitado, URL de redirect, flow configurado) e de device. A inconsistência PKCE/implicit é **inferida do código + do default da lib embarcada**, não observada em execução.
3. **Não verifiquei o estado do projeto Supabase** (`ewmtphddypfcllewkgzl`): se a tabela `user_states` existe, se a RLS está aplicada em produção, e se `MP_SYNC_KEY` está coerente. Sem credenciais, é inverificável por leitura.
4. **Medições de performance em jsdom**, não em WebView. Os valores absolutos são pessimistas; a **causa algorítmica** (O(n²) em `getKmFora`) é transferível e foi identificada por leitura.
5. **Não avaliei segurança de dependências por CVE** — `npm audit` exigiria consulta à API do registry, indisponível no ambiente; `npm outdated` mostrou apenas *minor/patch* atrás (Capacitor 8.5.0→8.6.0, supabase-js 2.117.3→2.119.0, jsdom 30→31). **Nenhuma dependência gravemente desatualizada.**
6. **Não avaliei acessibilidade com leitor de tela real** — as conclusões (labels sem `for`, sem `aria-modal`, contraste) vêm de inspeção de markup/CSS.
7. **Não há pasta `ios/`** — o suporte a iPhone hoje é apenas PWA.
8. **Escopo estático:** não avaliei estabilidade sob rede instável em device, consumo de bateria/memória real, nem comportamento em aparelhos low-end.

---

## Anexo A — Evidências executadas

| Verificação | Resultado |
|---|---|
| `npm test` (após `npm install`) | **12/12 checks passam**, sem erros de runtime |
| Sondagem de máscara de centavos | `"168"` → `1,68` km; `"40"` → `0,40` L (confirmado) |
| Sondagem de horas | `timeStart == timeEnd` → `finalHoursValue = 0.00` |
| Sondagem de configurações | reserva `0,00`→`0,18`, meta `0`→`7000`, meta/hora `0,00`→`35` (confirmado) |
| Sondagem de tela de login | `mpLoginScreen.display` permanece `none` (código morto confirmado) |
| Perf `render()` @1.000 turnos | 2.637 ms |
| Perf `saveState()` @1.000 turnos | 2.318 ms / 276.318 bytes |
| `buildCSVContent()` @1.000 turnos | 6 ms / 74.669 bytes |
| `npm outdated` | 6 pacotes com *minor/patch* atrás; nenhum major |
| Varredura de segredos | nenhum `service_role`/token/senha no repo |
| Varredura de analytics/crash | **zero** ocorrências |
| Varredura LGPD/privacidade/termos | **zero** ocorrências |
| `android/app/src/main/assets/public` vs `www` | defasado: sem `auth.js`/`config.js`; `index.html` 984 vs 1051 linhas |
| `git status` no fim | limpo (nenhum arquivo do projeto alterado) |

## Anexo B — Mapa de arquivos por risco

| Arquivo | Linhas | Risco | Observação |
|---|---:|---|---|
| `www/js/auth.js` | 281 | **P0** | Sync destrutivo; fluxo OAuth inconsistente; login morto na UI |
| `www/js/ui.js` | 829 | **P0/P1** | Máscara em km/litros; horas→8; campos com `\|\|` default; `calcFuel` escrevendo no render |
| `www/js/data.js` | 155 | **P0** | `setItem` sem try/catch; single source de verdade em blob |
| `www/js/domain.js` | 488 | P1 | `getKmFora` O(n²); `getLastFuelInfo` ignora média medida |
| `www/js/render.js` | 1211 | P1/P2 | Full re-render; backup/restore frágil; "Google Drive" nominal |
| `www/index.html` | 1051 | P2 | Sem `for`/ARIA; 7 abas; vendor 216 KB bloqueante |
| `www/css/style.css` | 869 | P2 | Tipografia 10–11 px; só tema escuro |
| `supabase/motoristapro-schema.sql` | 26 | — | RLS correta; modelo precisa normalização (P0-1) |
| `.github/workflows/build.yml` | 51 | P1 | Só debug APK; não roda testes; sem assinatura |
| `android/app/build.gradle` | 54 | P1 | `versionCode 1` fixo; sem keystore release |
| `android/app/src/main/AndroidManifest.xml` | 49 | P1 | `allowBackup="true"`; sem `FLAG_SECURE` |
| `ANALISE_MOTORISTAPRO.md` | 197 | P2 | **Desatualizado** — contradiz o código atual |
