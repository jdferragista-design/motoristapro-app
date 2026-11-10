# Portão de acesso — Fase 3 (v1.18.4 / versionCode 11804)

Login obrigatório e proteção dos dados financeiros do MotoristaPro.
Base: `bab454a` (branch `arena/ed7603c1-motoristapro-app`).
**Nada foi alterado no Supabase** (projeto, tabelas, RLS, políticas, usuários,
configurações), nenhuma Edge Function, nenhum serviço pago. A frequência de
sincronização não aumentou — pelo contrário, passou a haver mais bloqueios.
`mpReconcile()`, backup, `mpMergeStates()` e o miolo do `mpPushCore` ficaram
como estavam: só lhes foi posta uma guarda de entrada (ver §4).

---

## 1. Como o app abre agora

```
<script> inline no <head>          →  html[data-mp-locked] antes do 1.º pixel
        │                             (header, nav, main, modais, FAB e ✕ ocultos)
        ▼
mpInitSupabase() → mpAvaliarAcesso()
        │
        ├── sessão válida (exp > agora+30 s) e dono do aparelho confere
        │        → 'liberado': remove data-mp-locked/inert, fecha a janela
        │
        ├── sessão guardada + rede falhou + validação ≤ 7 dias + mesma conta
        │        → 'liberado' SEM validação (nada sincroniza) + aviso na tela
        │
        ├── sessão guardada + rede falhou + validação > 7 dias
        │        → 'sem_conexao' (vista "Precisamos de internet…" + tentar de novo)
        │
        ├── sessão expirada/recusada com internet
        │        → 'login' (a janela abre na vista de entrar)
        │
        └── sessão válida de OUTRA conta, com dados reais no aparelho
                 → 'conta_diferente' (bloqueio + resumo + backup de emergência)
```

`html[data-mp-locked]` é posto por um `<script>` síncrono no `<head>`, antes de
o `<body>` existir. Não há um único instante em que a área financeira apareça
antes da decisão. Além do CSS, os mesmos blocos recebem `inert` (sem foco, sem
clique, fora da árvore de acessibilidade).

O antigo botão **"Continuar sem conta"** foi removido. `mpContinueOffline()`
continua a existir como no-op (um `index.html` antigo em cache não rebenta com
"função não definida"), mas já não libera nada.

## 2. Sessões: cada situação e o que o app faz

| # | Situação | Sessão guardada | Rede | Resultado | Sincroniza? | Dados locais |
|---|---|---|---|---|---|---|
| 1 | Sessão válida, online | sim, exp futura | ok | **libera** | sim | intactos |
| 2 | Sessão válida, offline | sim, exp futura | em baixo | **libera** (getSession lê do armazenamento) | não (não há rede) | intactos |
| 3 | Sessão expirada, online | sim | ok | renova e **libera** | sim | intactos |
| 4 | Sessão expirada, offline, validada há ≤ 7 dias | sim | em baixo | **libera por tolerância** + aviso | **não** (`mpAcessoSemValidacao`) | intactos |
| 5 | Sessão expirada, offline, validada há > 7 dias | sim | em baixo | **bloqueia** na vista de conexão | não | intactos |
| 6 | Sem sessão nenhuma | não | — | **login** | não | intactos |
| 7 | Sessão de outra conta (aparelho com dados) | sim | ok | **bloqueia**, oferece backup | não | intactos |
| 8 | Logout voluntário | — | — | volta ao **login** | não | intactos |
| 9 | Demo intacta / dados de exemplo | — | — | demo é **descartada** ao entrar | **nunca** | substituída por estado vazio de utilizador novo |
| 10 | Demo já editada pelo utilizador | — | — | só a marca cai; o histórico fica | passa a poder sincronizar | **preservados** |

Regras que saem da tabela:

- **Nunca se declara autenticado sem validação.** O caso 4 é o único que abre
  sem token utilizável e é explicitamente marcado (`mpAcessoSemValidacao`):
  `mpPodeSincronizar()` devolve `false`, portanto não há pull, push nem merge.
  O utilizador vê o aviso "Sem conexão: sessão não validada agora. Seus dados
  locais estão disponíveis."
- **Falta de internet nunca é logout.** Nenhum caso acima remove
  `mp_html_state_v8`, `mp_backup_v8_*`, a sessão guardada ou a chave de dono do
  aparelho. O `signOut()` só acontece quando o utilizador o pede.
- **A janela não se fecha enquanto o acesso está fechado.** O "✕" fica oculto e
  `mpAuthFechar()` recusa-se a fechar (explica em vez de deixar um ecrã vazio).
- **Demonstração editada é do utilizador.** O `init.js` grava uma cópia exata do
  exemplo em `mp_demo_snapshot_v1`. Ao entrar, se o estado guardado já não for
  igual a essa cópia, é porque o utilizador lançou coisas: apaga-se apenas a
  marca de demo e **não se toca no histórico**. Só a demonstração intacta é
  substituída por um espaço vazio.
- **O arranque não fica preso.** O cliente do Supabase repete a renovação do
  token ~4 vezes quando a rede morre (≈26 s). O portão corre `getSession()`
  contra um prazo de 6 s (`MP_AUTH_PRAZO_MS`) e, se `navigator.onLine` estiver
  em baixo, nem espera: decide logo pela tolerância. Cenário A32.

## 3. Proteção contra a conta errada

`mpVerificarDono(uid)` compara o utilizador autenticado com
`mp_device_owner_v1`:

- chave vazia → **a primeira conta que autentica fica registada como dona**
  (gravada mesmo sem dados, para não haver dois "donos" possíveis);
- mesma conta → segue;
- conta diferente **e** dados reais no aparelho → bloqueio
  (`mpBloquearPorContaDiferente()`): a janela mostra o resumo do que está em
  risco ("1 turnos · 1 despesas · 0 manutenções salvos neste aparelho"), um
  botão **Exportar backup agora** e **Sair desta conta**. Nada é juntado,
  enviado, migrado ou apagado — decisão explícita do utilizador, tomada nesta
  fase.

## 4. Onde entra a guarda de sincronização (sem mexer no algoritmo)

- `mpPodeSincronizar()` = `liberado` **e** com validação **e** com `mpSession`
  **e** sem demo. É a única porta.
- `mpPushCore()` e `scheduleCloudSync()` recusam-se a avançar sem ela.
- `mpTrySilentPull()` também.
- As 4 chamadas a `mpReconcile()` passaram a `mpReconcileSePuder()`, que só
  delega quando `mpPodeSincronizar()` é verdadeiro.
- `mpMergeStates()`, `mpReconcile()`, `mpPushCore()`, backups, restauro e o
  last-write-wins **não foram reescritos**. Se algum dia precisarem de mudar,
  é proposta à parte.

## 5. Ficheiros tocados

| Ficheiro | O que mudou |
|---|---|
| `www/index.html` | `<script>` do `data-mp-locked` no `<head>`; botão "continuar sem conta" removido (substituído por nota); 3 vistas de sistema (`checking`, `offline`, `blocked`) antes de `#mpLoginStatus`; `?v=30` nos 13 assets |
| `www/css/style.css` | bloco "PORTÃO DE ACESSO (Fase 3)": oculta header/nav/main/modais/FAB/✕ e o ecrã de primeiro uso enquanto trancado; estilos `.mp-auth-spinner`, `.mp-auth-aviso`, `.mp-auth-blocked-dados`, `.mp-auth-submit--secundario`, `.mp-auth-foot--nota` |
| `www/js/auth.js` | secção PORTÃO DE ACESSO (`mpAvaliarAcesso`, `mpVerificarDono`, `mpAplicarPortao`, `mpMostrarAcesso`, `mpComPrazo`, tolerância de 7 dias, demo, backup de emergência); arranque reescrito; `onAuthStateChange` com verificação de dono; logout sem atalho offline; `mpAuthMostrarVista` aceita as vistas de sistema e não limpa mensagens do portão; `mpAuthFechar` bloqueado |
| `www/js/init.js` | marca de demonstração (`mp_demo_data_v1`) no primeiro uso |
| `www/sw.js` | cache `motoristapro-v34` |
| `tests/boot-smoke.js` | arranque passa a exigir portão fechado; T6 sem atalho offline; A02 com sessão válida; **A24–A32** novos |
| `tests/lib/auth-fixtures.js` | `criarJanelaPortao()`, `sessaoGuardada()`, `respostaRefresh()` |

## 6. Provas (npm test → 272 ✅, 0 ❌)

| Cenário | O que verifica |
|---|---|
| A24 | sem sessão: `data-mp-locked`, `main[inert]`, janela na vista de entrar, `mpPushCore()` à força não gera pedido, "continuar sem conta" não existe |
| A24b | com o portão fechado o "✕" não fecha (e explica) |
| A25 | sessão válida: área liberada, janela fechada, sync permitido, dono e data de validação gravados, dados intactos; "✕" volta a funcionar |
| A26 | expirada + offline + validação de 2 dias: abre, **não sincroniza**, avisa, nada apagado, nada confundido com logout |
| A27 | validação de 8 dias: fica bloqueado na vista de conexão, dados intactos |
| A28 | volta a rede + "Tentar novamente": renova a sessão e libera |
| A29 | conta diferente: bloqueio, resumo do risco, 0 escritas, dados e dono inalterados |
| A30 | demo marcada: descartada ao entrar, 0 envios, conta registada como dona |
| A30b | demo já editada: histórico preservado (2 turnos), marca removida, 0 envios |
| A31 | logout: portão fecha, sessão encerrada, histórico preservado, 0 DELETE, sem atalho |
| A32 | rede pendurada (fetch morre com `onLine` true): decide em ~6 s e não em 26 s |

Cenários de fases anteriores (PKCE, OAuth, deep links, login, cadastro,
recuperação, backup e sync) continuam a passar sem alterações.

## 7. Fora do escopo (por decisão explícita)

- Sem migração, exclusão, sobrescrita ou associação automática de dados
  financeiros.
- Sem mudanças no Supabase (RLS, tabelas, políticas, usuários, configurações).
- Sem merge na `main`, sem publicar/distribuir APK.
- `www/js/ui.js` continua a carregar `mp_html_state_v8` para memória no
  arranque, sem verificação de dono. Isso só é seguro porque **nada é
  renderizado nem exibido antes de o portão liberar** (CSS + `inert`) e porque
  o push está trancado. Mover essa leitura para depois da autenticação é uma
  alteração de boot que ficou fora desta fase.
