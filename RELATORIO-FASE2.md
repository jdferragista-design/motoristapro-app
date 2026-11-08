# Relatório — FASE 2: Correções Controladas

**Base da auditoria:** `97d89c8` — **Ponto de restauro:** tag `pre-fase2-97d89c8`
**Trabalho em:** branch `arena/a5269d1c-motoristapro-app` (sem PR, sem merge em `main`, sem APK publicado)
**Commits:** `226c740` · `f13b4e0` · `5c45ad4` · `5c08891` · HEAD `5c08891`
**Data:** 2026-11-08

Escopo executado: exatamente os 7 itens autorizados. Nada além disso foi alterado,
exceto duas correções que foram **necessárias para o C-02 funcionar** (registadas no
ponto 7, secção "extras").

---

## 1. Ficheiros modificados

### Novos

| Ficheiro | Para que serve |
|---|---|
| `www/js/backup.js` (271 linhas) | C-02 — 3 cópias rotativas, restauro verificado e reversível, painel de UI |
| `scripts/version-sync.js` (78 linhas) | A-05/M-09 — propaga a versão de `package.json` para o HTML e o Gradle |
| `android/app/src/main/res/xml/backup_rules.xml` | A-06 — regras de backup até Android 11 |
| `android/app/src/main/res/xml/data_extraction_rules.xml` | A-06 — regras Android 12+ (cloud + transferência) |
| `RELATORIO-FASE2.md` | este documento |

### Alterados (código do app)

| Ficheiro | Alteração |
|---|---|
| `www/js/data.js` | `normalizeMaintenanceItem()`/`normalizeMaintenance()`; `migrateState()` usa-as; `saveState()` devolve booleano, expõe `lastPersistError`, não agenda sync em falha, chama o backup; `mpLocalSet()` (ponto único de gravação); `saveStateOrWarn()` |
| `www/js/render.js` | `renderSafe()` + 9 blocos isolados; guards em `renderMaintenance()`; painel de backup no ciclo de render |
| `www/js/init.js` | Garante uma cópia de segurança no arranque se não existir nenhuma |
| `www/js/utils.js` | `APP_VERSION` deixa de ser literal — lê `<meta name="app-version">` |
| `www/index.html` | `<meta name="app-version">`; selo `#persistWarn`; painel "Cópias de Segurança"; 54 `label` com `for=`; `?v=28` |
| `www/sw.js` | `backup.js` na lista offline; cache `v31 → v32` |
| `tests/boot-smoke.js` | 34 asserções novas (53 → 87) |
| `package.json` / `package-lock.json` | versão 1.18.2; scripts `version:sync`/`version:check`; Capacitor atualizado; jsdom 31 |
| `android/app/build.gradle` | `versionCode 11802`, `versionName "1.18.2"` |
| `android/app/src/main/AndroidManifest.xml` | `fullBackupContent` + `dataExtractionRules` |
| `android/app/src/main/res/values/strings.xml` | nome sem versão ("MotoristaPro") |
| `capacitor.config.json` | `appName` sem versão |
| `android/app/src/main/assets/public/**` | sincronizado com `npx cap copy android` |

`AUDITORIA-COMPLETA-FASE1.md` (da fase anterior) e `.gitignore` (`.probe/`) foram
incluídos no commit.

---

## 2. Problemas corrigidos (por ID da auditoria)

### C-01 — Crash de render por manutenção não normalizada — **CORRIGIDO**

`renderMaintenance()` fazia `m.interval.toLocaleString()` sem guarda. Um único registo
sem `interval` lançava `TypeError` e abortava `render()` inteiro: as 7 views ficavam
congeladas. Duas defesas:

1. `migrateState()` passa a normalizar todos os registos (`interval` > 0, `lastKm` ≥ 0,
   `cost` ≥ 0, `name` string; registos não-objeto são descartados, não substituídos).
2. `renderSafe()` isola cada bloco — um bloco inválido falha sozinho, os outros continuam.

Robustez do `render()` a 11 mutações malformadas: **2/11 falhas → 0/11**.

### C-02 — Histórico só existia num aparelho — **CORRIGIDO**

`www/js/backup.js`, 3 slots rotativos em `localStorage` (a cópia 1 é sempre a mais
recente; a 3 sai), gatilho automático após gravação bem-sucedida, no máximo de 6 em 6 h
e só quando o número de registos mudou. No app nativo escreve também em
`DOCUMENTS/MotoristaPro/backups/`. Regras de segurança:

- **Nunca apaga nem substitui o estado atual** — só escreve cópias.
- Estado vazio não ocupa slot (não expulsa cópias boas).
- Restauro recusa cópia inexistente, ilegível ou sem nenhum registo.
- O estado atual é guardado antes do restauro → botão **"Desfazer último restauro"**.
- Falha de quota no restauro devolve erro visível, não deixa memória e disco divergentes.

### M-04 — UI anunciava sucesso sobre gravação falhada — **CORRIGIDO**

`saveState()` devolvia `undefined` e, em falha de gravação, mostrava o toast de erro,
chamava `render()` (a alteração parecia aplicada) e **agendava o sync para a nuvem** —
empurrando para a nuvem um estado que não estava no aparelho. Agora:

- devolve `true`/`false`; expõe `lastPersistError`;
- em falha: **não** agenda sync, mostra o toast e um selo persistente `#persistWarn`
  no topo do painel;
- `saveStateOrWarn(msg)` para fluxos que prometem sucesso.

### M-06 — 0/57 labels associados — **CORRIGIDO**

54 `<label class="form-label">` receberam `for=` a apontar para o id do campo (os outros 3
já envolvem o `<input>`, que é associação válida). **57/57**.

### M-07 — `<html>` sem `lang` — **JÁ ESTAVA CORRIGIDO no código auditado**

`<html lang="pt-BR">` existe desde o primeiro commit do repositório (`9bad2ea`, 12/10).
Não alterei nada e adicionei um teste que impede a regressão. A auditoria registou um
falso positivo neste ponto.

### A-05 / M-09 — 3 versões divergentes e `versionCode` fixo em 1 — **CORRIGIDO**

Antes: UI `v1.18.2`, `package.json` `1.18.1`, `build.gradle` `versionName "1.0"` e
`versionCode 1` — este último **impedia qualquer atualização por cima** na Play Store.

Agora `package.json` é a fonte única: `scripts/version-sync.js` propaga para o
`<meta name="app-version">` (que `utils.js` lê) e para o Gradle, com
`versionCode = major*10000 + minor*100 + patch` = **11802** para 1.18.2.
`npm run version:check` falha se dessincronizar. O nome do app deixou de carregar a
versão ("MotoristaPro v1.18" → "MotoristaPro").

### M-10 — `@capacitor/android` vulnerável — **CORRIGIDO**

`8.5.0` → **`8.6.0`** (GHSA-rvm3-566m-v7fv, CVSS 9.3, intervalo `>=8.5.0 <8.5.1`:
conteúdo remoto carregado na origem do app). `core`/`cli`/`filesystem`/`share`
alinhados na mesma minor para evitar mistura de versões nativas.

### A-06 — Backup Android exportava os dados pessoais — **CORRIGIDO**

`allowBackup="true"` sem regras: o Android enviava para o Google Drive **todo** o
diretório de dados do app, incluindo `app_webview` com o `localStorage` onde vive o
histórico financeiro (faturamento, parcelas, manutenções). **Não desliguei o backup**
(era perda de capacidade); restrinji-o: `backup_rules.xml` e `data_extraction_rules.xml`
excluem `app_webview`, `database` e `file`, e permitem apenas `sharedpref`.
O histórico passa a ser preservado pelo backup do próprio app (C-02).

---

## 3. Testes executados e resultados

`npm test` (jsdom, servidor HTTP local sobre `www/`, dados reais e base de demonstração):

```
87 asserções · 0 falhas · exit code 0
```

Distribuição das novas (34):

| Correção | Asserções |
|---|---|
| C-01 | 3 |
| C-02 | 10 |
| M-04 | 3 |
| M-06 | 3 |
| M-07 | 1 |
| A-05/M-09 | 5 |
| A-06 | 4 |
| M-10 | 2 |
| SW/assets (extra) | 3 |

Outros testes executados:

- **Sonda de robustez** (`/tmp/probe/robust.js`, 11 mutações de estado malformado):
  **0 falhas** (era 2/11).
- **Sonda de UI de backup** (`/tmp/probe/ui.js`, jsdom): painel vazio → criar cópia →
  `saveState` rotativo → restauro com confirmação → desfazer, todos com o resultado
  esperado.
- **`npm run version:check`**: `✔ versão sincronizada: 1.18.2 (versionCode 11802)`.
- **`npm audit`**: **0 vulnerabilidades** (eram 8, com 1 crítica).
- **`npx cap copy android`**: assets sincronizados; `diff -r` contra `www/` só mostra
  `cordova.js`/`cordova_plugins.js`, que o Capacitor gera.

**Limitação declarada:** o jsdom não implementa a ativação de `<label>` (verifiquei
isoladamente: `click` num label com `for=` não move o foco). A asserção de M-06 é
estrutural — o `for=` é o id do primeiro campo a seguir ao label. Não houve teste em
browser real nem em dispositivo Android; a compilação do APK não foi executada.

---

## 4. Comparação dos cálculos financeiros antes/depois

Método: mesma sonda (`baseline2.js`), mesmo backup real (`motoristapro_backup_2026-11-08.json`,
**199 turnos, 32 despesas, 4 manutenções, 81,1 KB**), executada sobre um *git worktree*
limpo no commit `97d89c8` e sobre a branch atual.

| Indicador | Antes (`97d89c8`) | Depois (HEAD) |
|---|---|---|
| Faturamento bruto (tudo) | R$ 17.800,13 | **R$ 17.800,13** |
| Gastos (tudo) | R$ 12.224,78 | **R$ 12.224,78** |
| Líquido (tudo) | R$ 5.575,35 | **R$ 5.575,35** |
| R$/km · R$/h | R$ 2,60/km · R$ 34,22/h | **iguais** |
| Custo real/km (CPK) | R$ 1,78/km | **R$ 1,78/km** |
| Média por viagem | R$ 16,75 | **R$ 16,75** |
| Períodos 7 dias / mês / 30 dias / hoje | — | **idênticos, campo a campo** |
| `costParts` (17 campos, em centavos) | 1780013 · 1222478 · 557535 · … | **idênticos** |
| Competência mensal (bruto/líquido) | 08: 585306/446409 · 09: 507032/340375 · 10: 544158/371044 · 11: 143517/28282 | **idênticos** |
| Fechamento WhatsApp (bruto/líquido) | R$ 17.800,13 / R$ 5.575,35 | **iguais** |

**Diferenças encontradas: 0.** O `diff` recursivo de todo o JSON de saída não acusou
nenhum desvio. Nenhum valor histórico foi alterado; nenhum cálculo foi tocado.

Desempenho (A/B intercalado no mesmo processo, mediana de 3×5 execuções, dados reais):

| Operação | Antes | Depois |
|---|---|---|
| `render()` | 296,2 ms | 282,5 ms |
| `renderShiftsList()` | 265,2 ms | 291,3 ms |
| `saveState()` | 252,7 ms | 212,1 ms |
| `mpBackupRotate()` (puro) | — | 0,5–0,9 ms |
| `mpBackupMaybe()` (adiado por tempo) | — | 0,03 ms |

O ruído do sandbox é de ±10%, pelo que estes valores são equivalentes. Uma primeira
versão do painel de backup **causava** +18,6% em `render()` (parse de 3 cópias de 81 KB
a cada render); foi corrigida no commit `5c45ad4` com cache indexada pela assinatura do
conteúdo. **Nota:** os tempos absolutos (~280 ms) são inferiores aos 1.073 ms medidos na
Fase 1 porque esta medição é em jsdom com mediana de execuções aquecidas, não no arranque
a frio com o DOM a ser reconstruído — os dois números não são comparáveis entre si.

---

## 5. Backups: verificação de criação e restauro

| Cenário | Resultado |
|---|---|
| Rotação com 4 gravações | 3 cópias, slots `1,2,3` — a mais antiga sai ✔ |
| Cópia 1 é a mais recente | stats de 2 turnos na 1, 1 turno na 2 ✔ |
| Estado vazio | **não ocupa slot** (`ok:false`), lista continua vazia ✔ |
| Restauro recupera histórico | 0 → 3 turnos recuperados ✔ |
| Restauro é reversível | "Desfazer" devolve o estado anterior ✔ |
| Restauro de cópia vazia | recusado com motivo `cópia vazia` ✔ |
| Falha de quota no restauro | `ok:false`, motivo presente, memória não divergente ✔ |
| Backup não altera o estado atual | JSON do estado idêntico antes/depois ✔ |
| Painel reflete escrita/remoção externa | cache coerente ✔ |
| Cópia automática no `saveState` | criada; 2.ª tentativa adiada pelas 6 h ✔ |
| Cópia no arranque | criada só quando não existe nenhuma ✔ |
| Peso de uma cópia | ≈ 81 KB (igual ao estado), 3 cópias ≈ 243 KB de 5 MB disponíveis ✔ |

**Não testado** (limitações do ambiente): escrita em `DOCUMENTS/MotoristaPro/backups/`
via Filesystem — depende do plugin nativo e não existe em jsdom; execução do backup em
Android real; comportamento sob quota realmente esgotada (simulei a exceção, não o
armazenamento cheio a sério).

---

## 6. Dependências atualizadas e vulnerabilidades restantes

| Pacote | Antes | Depois |
|---|---|---|
| `@capacitor/android` | 8.5.0 | **8.6.0** (corrige a crítica) |
| `@capacitor/core` | 8.5.0 | **8.6.0** |
| `@capacitor/cli` | 8.5.0 | **8.6.0** |
| `@capacitor/filesystem` | 8.1.3 | **8.1.5** |
| `@capacitor/share` | 8.0.1 | **8.0.3** |
| `jsdom` (dev) | 30.1.2 | **31.0.0** |

`npm audit`: **8 vulnerabilidades (1 crítica, 2 altas, 5 moderadas) → 0**. Nenhuma é de
produção no cliente web: `undici` (dev, jsdom), `brace-expansion`/`glob`/`minimatch`/
`rimraf` (cadeia do `@capacitor/cli`, ferramenta de build), `uuid`/`xcode` (idem).
Nada disto é enviado no APK, mas a cadeia de build ficou limpa.

---

## 7. Problemas que ainda exigem intervenção manual

1. **Compilar e instalar o APK** — não executei `gradlew` (sem Android SDK neste
   ambiente) nem publiquei nada. O CI (`.github/workflows/build.yml`) só corre em
   `main`/`master`, e esta branch não foi fundida. É preciso compilar para confirmar que
   as novas regras XML de backup são aceites pelo `aapt2`.
2. **`versionCode` tem de ser incrementado a cada envio** — `npm run version:sync` faz
   isso a partir do `package.json`; o processo passa a ser *subir a versão, sincronizar,
   compilar*. Sem isso, a Play Store recusa a atualização (era o problema original).
3. **Supabase — A-04 continua aberto** (`external_google_enabled: false`): o login
   Google não funciona; só pode ser ativado no painel do Supabase, com credenciais, e
   estava fora do escopo autorizado. Nada foi tocado em produção.
4. **Primeiro uso em dispositivo real** — o backup nativo escreve em
   `DOCUMENTS/MotoristaPro/backups/`; verificar em Android 11 e 14 as permissões de
   armazenamento (o plugin pode exigir configuração de `Directory.Documents`).
5. **Restaurar dados reais antes de usar** — as cópias só passam a existir a partir da
   primeira gravação após esta versão. Enquanto não houver cópia, o histórico continua
   com um único ponto de falha: exportar um ficheiro manual ("☁️ Exportar ficheiro" no
   painel novo) antes de qualquer limpeza de dados do browser.
6. **Problemas de escopo não tocados** (continuam como na auditoria): A-01 (`render()`
   ~1 s no arranque real), A-02 (SW 304 em servidores que não controlam cache), A-03
   (sem CSP), A-07 (68 `innerHTML` vs 19 `esc()`), M-01 (sem lint/tipos), M-02
   (`alert`/`confirm`), M-03 (sem desfazer em geral), M-05 (sem paginação), M-08
   (`mpShowLoginScreen(true)` nunca chamado).
7. **Dois extras não pedidos, mas necessários** — declarados para transparência:
   `backup.js` teve de entrar na lista offline do `sw.js` (senão, em modo avião, o
   script não carrega e as funções de backup desaparecem sem aviso) e a versão da cache
   subiu para `v32` com `?v=28` nos assets, para as alterações chegarem ao utilizador.
   Nenhum deles altera comportamento funcional além de servir os ficheiros certos.

---

## Estado final

- Branch `arena/a526d1c-motoristapro-app` @ `5c08891` · árvore limpa · **sem PR**, **sem merge**, **sem APK**.
- Ponto de restauro: `git tag pre-fase2-97d89c8` (ou `git reset --hard pre-fase2-97d89c8` para reverter tudo).
- `npm test`: **87/87**. `npm audit`: **0**. `npm run version:check`: **sincronizado**.
- Cálculos financeiros: **0 diferenças** face a `97d89c8` em todos os indicadores e períodos.

**Aguardo autorização antes de qualquer segunda ronda.**
