# 🚗 Análise Técnica — MotoristaPro

**Data:** 22/08/2026 · **Analista:** Arena Agent Mode
**Escopo:** `www/index.html` (app completo, 2.824 linhas / 120 KB), `capacitor.config.json`, shell Android (`android/`), CI (`.github/workflows/build.yml`) e estrutura do repositório.

---

## 1. Visão Geral da Arquitetura

| Aspecto | Situação atual |
|---|---|
| Stack | HTML/CSS/JS vanilla em **arquivo único** (`www/index.html`), sem build, sem framework |
| Empacotamento | Capacitor 8.5 → APK Android (`com.pro.driver`, minSdk 24, targetSdk 36) |
| Persistência | `localStorage` (chave `mp_html_state_v8`), estado global mutável em memória |
| Backup | Web Share / download de JSON ("Google Drive" via share sheet — **não é integração real**) |
| Plugins nativos | **Nenhum** (`capacitor.plugins.json` = `[]`) |
| CI | GitHub Actions gera APK debug a partir de um **zip de 18 MB commitado no repo** |
| Testes / Lint | Nenhum |

**O que o app faz bem (manter):** domínio financeiro bem modelado para o motorista de app (turnos multi-app com staging, R$/km, R$/h, CPK, provisão de desgaste R$/km, paridade etanol×gasolina, simulador "aceitar/recusar corrida", fechamento formatado para WhatsApp, manutenção preventiva por odômetro). A UX tem identidade visual consistente e o fluxo do modal de turno (1º apps → 2º km/horas → resumo ao vivo) é bem pensado.

---

## 2. 🐛 Bugs Críticos Encontrados (corrigir primeiro)

### B1 — HTML truncado na aba Relatórios (quebra o layout mobile) — **ALTA**
`www/index.html` linhas **1027–1030**: o botão `exportJSONBackup()` abre, contém só o SVG e o arquivo **salta direto** para `<!-- Mobile Bottom Nav -->`. Faltam:
- texto e `</button>` de fechamento;
- o restante do card "Outras Opções" (os botões de **Limpar dados** e **Restaurar demo**);
- fechamentos da `grid`, do card, do `viewReports`, do `<main>` — **não existe nenhum `</main>` no arquivo** (verificado por grep).

Consequência: o parser HTML aninha a `<nav class="mobile-nav">` **dentro do `<button>` não fechado** → a navegação inferior mobile renderiza dentro do card de relatórios, com comportamento de clique imprevisível. As funções `resetToDemo()` e `clearAllData()` (linhas 2802/2810) existem no JS, mas **não têm botão que as invoque** — funcionalidades mortas.

### B2 — PWA/offline quebrado: arquivos referenciados não existem — **ALTA**
- `<link rel="manifest" href="manifest.json">` (L10), `icon-192.png` (L11) e `navigator.serviceWorker.register('sw.js')` (L1679) apontam para arquivos que **não existem em `www/`** (a pasta contém apenas `index.html`).
- O handler de `beforeinstallprompt` referencia `pwaInstallBanner` (L1658/1667), elemento que **não existe no HTML** → o banner de instalação nunca aparece.
- O app só funciona offline porque o Capacitor embute os assets no APK; como PWA web, a promessa de "100% offline" não se sustenta.

### B3 — Gráfico de 7 dias usa dados fake — **MÉDIA/ALTA**
L2357: `const amounts = [410, 165, 370, 430, 395, 300, ...]` — barras hardcoded que **não refletem os turnos reais**. Para um app financeiro, exibir números inventados corrói a confiança. Deve somar os ganhos reais por dia a partir de `state.shifts`.

### B4 — Injeção de HTML/XSS via `innerHTML` — **MÉDIA**
Dados digitados pelo usuário (`s.notes`, `e.title`, nome de app customizado) são interpolados sem escape em `innerHTML` (`renderShiftsList` L2435, `renderExpensesList` L2494, `renderStagedApps` L1923). Um título como `<img src=x onerror=alert(1)>` executa; aspas simples quebram o layout. Usar `textContent` ou função `escapeHtml()`.

### B5 — Inconsistências de cálculo/estado
1. **Odômetro "drift" na edição:** criar turno soma `km` ao odômetro; **editar/excluir turno não ajusta** o odômetro de volta. Com o tempo o valor diverge do real.
2. **Limiares duplicados:** o simulador (L2596) usa metas hardcoded (`2.5`/`45`/`1.9`/`28`) enquanto o painel usa `state.vehicle.targetKmRate` (2.20) e `targetHourlyRate` (35). Deveriam ser a mesma fonte.
3. **`targetHourlyRate` não é editável** em Configurações (`saveSettings` não lê esse campo).
4. **`autoCalcPricePerLiter()`** altera `state.fuelSettings` *enquanto o usuário digita* — mesmo que ele cancele o modal, a mutação fica em memória e vaza para o próximo save.
5. **`recalcShiftLive()`** sobrescreve o campo "Gasto Combustível" sempre que o valor é apagado — o usuário não consegue limpar/corrigir manualmente.
6. **Badge "⭐ Último Abastecimento"** compara índice da lista *filtrada* com `findIndex` da lista *completa* (L2494+) — o selo some/aparece errado quando há busca ativa.
7. **`getLastFuelInfo()`** assume que `expenses[0..]` está ordenado por data (só `unshift` preserva isso; restaurar backup antigo ou editar quebra a ordem). Ordenar por data antes.

---

## 3. 🧮 Melhorias de Produto (domínio financeiro / benchmark Drivvo·Uber·99)

1. **Filtro por período (dia/semana/mês).** Hoje o dashboard soma **todo o histórico**: "Progresso da Meta Mensal" compara o acumulado total contra a meta do mês — matematicamente errado a partir do 2º mês de uso. Tudo (dashboard, WhatsApp, gastos) deveria escopar por mês corrente com seletor.
2. **Km/L real por tanque (feature central do Drivvo).** Já existem litros + odômetro nos abastecimentos: calcular `Δodo ÷ litros` entre abastecimentos consecutivos, marcar "tanque cheio vs. parcial", e usar a **média real** no CPK em vez da média digitada nas configurações.
3. **Suporte a GNV.** Grande parte da categoria usa GNV; incluir na paridade (preço/m³ e média km/m³) e nos tipos de abastecimento.
4. **Google Drive de verdade.** Hoje "Salvar no Drive" é só `navigator.share`/download. Implementar Google Identity Services + Drive REST (`files.create` com `appDataFolder`) para backup automático silencioso a cada alteração e restauração por lista de snapshots — é o diferencial anunciado no título do app.
5. **Notificações de revisão vencida** com `@capacitor/local-notifications` (nenhum plugin nativo é usado hoje).
6. **Intervalo de almoço/pausa** no turno (hoje horas = fim − início, sem desconto de pausa).
7. **Fechamento mensal exportável (PDF/imagem)** para contabilidade/MEI, além do texto de WhatsApp.
8. **Separação pessoal × profissional:** "Alimentação" entra no cálculo de lucro líquido como custo do negócio — deveria ser categoria à parte, com toggle para incluir/excluir do resultado.
9. **Gamificação leve:** sequência de dias com meta batida, melhor dia da semana, horário mais lucrativo (heatmaps a partir dos horários já armazenados).
10. **Multi-veículo** (perfil por carro) e **importação de CSV** dos apps (Uber/InDrive permitem exportar), como o Drivvo faz.
11. **Foto de comprovantes** (recibo de posto/oficina) com `@capacitor/camera` + Filesystem.
12. **Bloqueio por PIN/biometria** — dados financeiros no aparelho.

---

## 4. 📱 Melhorias de UX / UI

- **Substituir `alert()`/`confirm()`/`prompt()`** (12 ocorrências) por toasts e modais próprios — já existe sistema de modal; `prompt()` para confirmar manutenção (L ~2010) é especialmente datado.
- **Undo em ações destrutivas** (excluir turno/despesa hoje é irreversível com um `confirm`).
- **Acessibilidade:** remover `maximum-scale=1.0, user-scalable=no` (L5 — bloqueia zoom, violação WCAG); fontes de 10–11 px são pequenas para leitura ao volante; faltam `aria-label` em botões-ícone, focus trap nos modais e fechamento com ESC/backdrop; contraste de `--text-dim` (#64748b) sobre fundo escuro é limítrofe.
- **Inputs monetários:** aceitar máscara brasileira (`285,50`) de forma consistente; hoje `parseVal` aceita vírgula, mas os placeholders mostram `285.50` (ponto), confundindo o público-alvo.
- **Busca de turnos** não procura por nome de app nem por valor; busca por data só funciona digitando `AAAA-MM-DD`, não `DD/MM`.
- **Empty states e onboarding:** primeiro uso já abre com 5 turnos e 6 despesas de demonstração — o usuário real não percebe onde terminam os dados fake. Oferecer "começar do zero vs. ver exemplo".
- Tema claro opcional (dirigir de dia com tela escura ofusca menos; muitos motoristas preferem light mode diurno).

---

## 5. ⚙️ Melhorias de Engenharia

1. **Validação de schema no restore:** `handleRestoreFile` aceita qualquer JSON com `shifts` ou `vehicle`; backup antigo sem `fuelSettings` ou com formato legado quebra funções silenciosamente. Implementar migração versionada (`schemaVersion`) + merge com defaults.
2. **IDs com `crypto.randomUUID()`** em vez de `Date.now()` (colisão ao criar 2 registros no mesmo ms — ex.: `executeMaintenance`).
3. **CSV correto para Excel BR:** hoje usa data-URI com `encodeURI` (quebra acentos), sem BOM UTF-8, vírgula decimal e colunas desalinhadas entre turnos e despesas (categoria vai na coluna "Periodo", odômetro na coluna "KM"). Usar `Blob` + `\uFEFF`, `;` como separador e duas planilhas/seções bem definidas.
4. **CSP mínima** (`meta http-equiv`) — o arquivo hoje depende de `onclick` inline; ao menos adicionar escape sistemático (ver B4).
5. **Extração do núcleo de cálculo** (parseVal, agregações, CPK, paridade) para funções puras testáveis — mesmo mantendo arquivo único, é possível testar via Vitest importando um módulo extraído no build, ou validar o HTML no CI (um simples `npx html-validate` teria pego o bug B1).
6. **Render incremental:** `render()` reescreve o DOM inteiro a cada save — ok para dezenas de registros, mas o histórico de um motorista ativo chega a milhares; paginar/virtualizar listas.
7. **Backup automático local** (Filesystem plugin grava JSON periódico) — limpar dados do WebView (comum em celular de motorista com pouco armazenamento) apaga tudo hoje.
8. **Service Worker real** para uso como PWA (cache-first do index), ou remover as referências mortas (B2).

---

## 6. 📦 Repositório & CI (alto impacto, baixo esforço)

| Problema | Recomendação |
|---|---|
| `motoristapro-app.zip` de **18 MB commitado no Git** | Eliminar o zip: commitar o projeto-fonte direto no repo. Git não é lugar para binário mutável; cada novo zip infla o histórico permanentemente. |
| O zip contém **`node_modules` (28 MB, 1.976 arquivos)** e um **`.git` aninhado (16 MB)** | Nunca versionar `node_modules` (o CI já roda `npm install`) nem repositório `.git` dentro de artefato. Adicionar `.gitignore` (node_modules, .gradle, build, *.zip). |
| Zip inclui cache `android/.gradle` e builds intermediários | Remover; o Gradle regenera. |
| Workflow descompacta zip e roda `npm install` por cima do node_modules embutido | Redundante: simplificar para `npm ci` + cache de npm/Gradle (`actions/setup-node@v4` com `cache: npm` e `gradle/actions/setup-gradle`). |
| Só APK **debug**, `versionCode` 1 fixo | Adicionar assinatura de release via secrets, gerar AAB para Play Store, e versionamento automático (`versionCode` derivado de `GITHUB_RUN_NUMBER`). |
| `applicationId = com.pro.driver` | ID genérico com risco de conflito/rejeição na Play Store — usar algo único (ex.: `com.motoristapro.app`). |
| Nenhuma validação no CI | Adicionar passo de lint/validação de HTML + smoke test do JS antes do build. |

---

## 7. 🗺️ Roadmap Sugerido (prioridade)

**P0 — Correções imediatas (1–2 dias)**
1. Reconstruir o trecho truncado do HTML (B1) — restaurar botões de export/limpar/reset e fechar as tags.
2. Gráfico de 7 dias com dados reais (B3).
3. Escapar entrada do usuário no render (B4).
4. Criar `manifest.json`, `sw.js` e ícones **ou** remover as referências (B2).
5. Tirar zip/node_modules/.git do repositório + `.gitignore` (seção 6).

**P1 — Correção de produto (1 sprint)**
6. Filtro de período mensal em dashboard/gastos/WhatsApp; meta mensal escopada ao mês.
7. Corrigir odômetro na edição/exclusão de turno; ordenar despesas por data; unificar metas do simulador com as configurações.
8. Validação + migração de schema no restore; `randomUUID()`; CSV Excel-BR correto.
9. Substituir `alert/confirm/prompt` por toasts/modais; undo de exclusão.

**P2 — Diferenciais competitivos (2–4 sprints)**
10. Integração real com Google Drive (GIS + REST) com auto-backup.
11. Km/L real por tanque + suporte GNV.
12. Notificações locais de revisão; foto de comprovantes; PIN/biometria.
13. Exportação PDF do fechamento mensal; multi-veículo; importação de CSV dos apps.

---

## 8. ✅ Implementado nesta branch (22/08/2026)

Decisões do proprietário aplicadas: **odômetro é alimentado apenas por abastecimentos e manutenções** — o km do turno pertence à jornada de trabalho e não soma no odômetro (removido o `odometer += km` de `saveFinalShift`; abastecimento agora atualiza o odômetro também na edição, mantendo monotonicidade). **O modo de lançamento (fluxo dos modais) permanece idêntico.**

Correções P0 entregues:

| # | Item | Onde |
|---|---|---|
| 1 | HTML truncado reconstruído (fechamento do botão de backup JSON, card "Zona de Perigo" com `resetToDemo`/`clearAllData`, `</main>` presente; validado por verificador de balanceamento de tags) | `www/index.html` ~L1027–1063 |
| 2 | Gráfico de 7 dias agora soma ganhos reais dos turnos por dia (antes: valores hardcoded) | `render()` |
| 3 | `esc()` aplicado a toda entrada do usuário renderizada (XSS armazenado) | renders de listas/staging/breakdown |
| 4 | PWA real: `manifest.json`, `sw.js` (cache-first), `icon-192/512.png` e banner `pwaInstallBanner` (referenciado pelo JS e antes inexistente) | `www/` |
| 5 | "Último abastecimento" determinado por data, não por posição no array | `getLastFuelInfo()`, `renderExpensesList()` |
| 6 | Repo sem zip de 18 MB: fonte commitado direto (`www/`, `android/`, `package*.json`, `capacitor.config.json`), `.gitignore` (node_modules, .gradle, zips), CI reescrito para `npm ci` + `cap sync` + Gradle direto do repo, `android/assets/public` ressincronizado | raiz + `.github/workflows/build.yml` |
| 7 | **Novo visual** seguindo dashboard de referência do proprietário: paleta dark-violet (#0a0a14 + gradientes violeta→ciano), KPIs com sparklines reais e pills de tendência semanal, divisão por app em donut chart, gráfico 7 dias em área-chart suave (Bruto × Líquido), ícones regenerados. Fluxo de lançamento inalterado | `www/index.html`, `www/icon-*.png` |

Permanecem em aberto (P1/P2 das seções 2–5): filtro por período/mês, validação de schema no restore, CSV Excel-BR, toasts no lugar de `alert()`, Drive real, km/L por tanque, GNV etc.

---

## 9. 🔬 Análise: Precisão de Cálculos Monetários com Ponto Flutuante (22/08/2026)

**Conclusão da análise:** o risco apontado era **real, porém latente** — todo valor exibido passava por `Intl.NumberFormat`/`toFixed(2)`, que arredondam na saída e mascaravam o erro. Mas as *agregações* (lucro líquido, margem, R$/km, CPK, totais por app/dia, fechamento WhatsApp, CSV) somavam floats crus: com centenas de turnos, o acúmulo de ruído binário (~1e-13 por operação) podia (a) deslocar arredondamentos de borda em 1 centavo, (b) produzir totais com frações inexistentes no mundo real e (c) propagar para métricas derivadas (margem %, metas). Exemplo medido: `300 × 0.1` em float = `30.000000000000156`.

**Solução implementada — aritmética 100% em centavos inteiros, sem dependências externas** (decimal.js/big.js violariam a restrição de arquivo único + offline + sem build do projeto):

- `toC(v)` = fronteira de entrada: qualquer valor (float/string) → centavos `Math.round(v*100)`;
- `brlC(cents)` = único ponto de formatação centavos → "R$ x,xx";
- Todas as somas/subtrações monetárias (painel, Resumo do Dia, 7 dias, tendências, donut por app, listas de turnos/despesas, staging do modal, resumo ao vivo, simulador, WhatsApp, meta mensal, fundo de reserva) agora operam em `int`; divisões (R$/km, R$/h, km/L, paridade) partem de centavos e só viram float no display;
- A máscara de input já digitava em centavos — sinergia natural com o novo modelo;
- Dados gravados (localStorage/backup) permanecem em reais com 2 casas (compatibilidade total com backups existentes); a conversão ocorre na leitura.

**Regressões encontradas durante a análise e corrigidas junto:**
1. *Fundo de Reserva (Saúde do Carro)* estava escopado ao **período do painel** (regressão do filtro de período) → voltou a usar **todo o histórico** (`reserveAllC`);
2. *Meta Mensal* comparava a meta com o bruto do **período selecionado** → agora sempre com o bruto do **mês corrente** (`monthGrossC`), independente do filtro ativo.

**Verificação:** `node --check` + execução do script com DOM simulado + prova de acurácia (float vs centavos) incluída no commit.

---

## 10. Veredito

O MotoristaPro tem **produto bem concebido** — o modelo mental (turno multi-app → eficiência R$/km·R$/h → provisão de desgaste → fechamento WhatsApp) é exatamente o fluxo de trabalho real do motorista de aplicativo, superior a muitos concorrentes em objetividade. Porém, a execução atual carrega um **defeito estrutural grave (HTML truncado)**, uma **camada PWA fictícia**, **dados de demonstração misturados com dados reais** e um **repositório com 18 MB de zip contendo node_modules/.git** — itens que devem ser tratados antes de qualquer distribuição pública. Com as correções P0/P1 (estimativa: 1 sprint de um desenvolvedor), o app passa de protótipo promissor a produto confiável.
