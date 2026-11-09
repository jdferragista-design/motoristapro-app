# Auditoria Técnica Completa — Supabase / MotoristaPro

**Projeto:** `motoristapro-Project` · ref `xncxzczftetctpazzecu` · us-east-1 · PostgreSQL 17.11
**Repositório auditado:** branch `arena/a5269d1c-motoristapro-app` @ `c51856b`
**Data:** 2026-11-08 · **Modo:** auditoria somente-leitura
**Alterações ao projeto ou ao repositório:** **nenhuma** (`git status` limpo, nenhuma escrita SQL)

> **Nota de escopo:** todas as verificações de banco, políticas, RLS, privilégios, triggers e
> contagens foram feitas com consultas `SELECT` no catálogo do PostgreSQL. Nenhuma escrita foi
> executada. As chaves secretas que a API devolveu foram **ignoradas e não transcritas** neste
> relatório.

---

## A. Resumo executivo

O backend está **estruturalmente bem construído** e é compatível com o app: RLS ativa em 100% das
tabelas, políticas consistentes por `auth.uid()` com `WITH CHECK` em todas as escritas, `anon` sem
nenhum privilégio, trigger de `updated_at` no servidor, e o app usa exatamente **uma** tabela
(`user_states`) com colunas que coincidem com o schema (`user_id uuid PK`, `state jsonb`,
`updated_at timestamptz`).

O que **não** está pronto é a configuração de autenticação e de produção:

1. **`Site URL` = `http://localhost:8080`** — é a URL de desenvolvimento, não existe domínio de produção.
2. **Google OAuth foi habilitado desde a última verificação**, mas o `redirectTo` do app no Android
   aponta para um deep link que o GoTrue não usa como destino do `redirect_to` (o callback do Google
   é sempre `/auth/v1/callback`); há um usuário `google` já criado, o que sugere teste manual em
   outro cliente.
3. **Não existe fluxo de recuperação de senha no app** e `mailer_autoconfirm=false` com
   `rate_limit_email_sent = 2/hora`: quem se registar (inclusive via Google→email) pode ficar sem
   conseguir entrar e sem forma de recuperar.
4. **A nuvem tem histórico real (200 turnos, 32 despesas, 4 manutenções)** — ao contrário do que a
   auditoria anterior indicava (tabela vazia). Isso muda a prioridade: agora há dados de produção
   que podem ser perdidos por uma configuração errada.
5. **A tabela `public.users` não é usada pelo app** e tem um campo `password` (hash bcrypt) paralelo
   ao `auth.users` — duplicação herdada, sem sincronização. Risco de confusão e de dados obsoletos.

**Nenhum problema CRÍTICO de exposição de dados foi encontrado.** O isolamento entre usuários está
correto e não encontrei caminho para ler ou escrever dados de terceiros com as políticas atuais.

---

## B. Tabela de auditoria

| Área | Resultado | Gravidade | Evidência |
|---|---|---|---|
| Conexão / DNS | **PASSOU** (DNS) · **NÃO VERIFICADO** (HTTPS) | — | DNS resolve `104.18.38.10`, `172.64.149.246`; TLS cortado pelo sandbox (`SSL_ERROR_SYSCALL`), não pelo servidor |
| Disponibilidade dos serviços | **PASSOU** | — | `auth`, `db`, `pooler`, `rest`, `realtime`, `storage`, `pg_bouncer` = `ACTIVE_HEALTHY` |
| Configuração do projeto | **ATENÇÃO** | MÉDIO | Existe 1 projeto na conta e é o que o app usa; `Site URL` de dev |
| Autenticação email | **ATENÇÃO** | ALTO | Email ativo, signup aberto, `mailer_autoconfirm=false`, sem recuperação de senha no app |
| Google OAuth | **ATENÇÃO** | MÉDIO | Provider **habilitado** com Client ID/Secret; redirect nativo incompatível com o fluxo |
| Banco de dados | **PASSOU** | — | 8 tabelas, PK/FK/índices coerentes, `user_states` compatível com o app |
| RLS | **PASSOU** | — | 8/8 tabelas com RLS; 14 políticas; todas por `auth.uid()`; `WITH CHECK` em todas as escritas |
| API REST | **ATENÇÃO** | BAIXO | `anon` sem privilégios (bom); `authenticated` com `TRUNCATE`/`REFERENCES`/`TRIGGER` (excessivo) |
| Sincronização | **ATENÇÃO** | MÉDIO | Reconciliação por união + backup pré-pull é segura; falta tratamento de "nuvem vs. falha" e de conflito por id |
| Backup / recuperação | **NÃO VERIFICADO** | ALTO | Plano e retenção dependem do painel; não há API de leitura disponível aqui |
| Android / Capacitor | **ATENÇÃO** | MÉDIO | Config correta e assets sincronizados; compilação e teste em aparelho não executados |
| Integridade dos dados | **ATENÇÃO** | MÉDIO | 0 órfãos; 1 linha de `users` sem conta `auth`; 3 contas `auth` sem perfil; histórico na nuvem existe |

---

## C. Problemas encontrados

### SBX-01 — `Site URL` aponta para `localhost:8080` — **MÉDIO**

- **Evidência:** `site_url = "http://localhost:8080"` na configuração de Auth.
- **Impacto:** qualquer link de email (confirmação, convite, recuperação) e qualquer fluxo que use o
  `redirect_to` por omissão leva o utilizador para um endereço que só existe no PC do programador.
  No telemóvel é um erro de rede imediato. Não afeta o login por senha (que não usa redirect), mas
  afeta todo o resto.
- **Causa provável:** configuração inicial de desenvolvimento nunca substituída.

### SBX-02 — Fluxo Google incompatível com Capacitor (deep link como `redirect_to`) — **MÉDIO**

- **Evidência:** `external_google_enabled = true`, Client ID e Secret presentes.
  No app, `mpLoginWithGoogle()` usa `redirectTo = com.pro.driver://oauth-callback` quando nativo e
  `skipBrowserRedirect: true`, abrindo o URL do GoTrue em `@capacitor/browser`. O GoTrue enviará
  **sempre** o `redirect_uri` ao Google como `<projeto>/auth/v1/callback`; o valor de `redirect_to`
  só é usado **depois** do callback, no salto final (com `?code=…`).
- **Impacto:** o fluxo pode funcionar (o app troca o `code` no deep link), mas depende de o GoTrue
  aceitar `com.pro.driver://…` como destino final — está na lista de redirects, portanto deve
  aceitar. O que **não** está comprovado é que o Android entregue o `appUrlOpen` ao WebView, e o
  `exchangeCodeForSession(code)` exige que o código tenha sido emitido para esse fluxo. Também não há
  PKCE (`flowType: 'pkce'` não está configurado no cliente) — o que aumenta o risco de interceptação
  do `code` por outra app que registe o mesmo esquema.
- **Causa provável:** implementação OAuth "à mão" para nativo, sem PKCE e sem teste em aparelho.
- **Nota:** existe **1 conta de provider `google`** na base, criada em 2026-11-09. Foi criada por
  fora do app (outro cliente / teste manual) — o app não tem fluxo que a produza com sucesso
  comprovado.

### SBX-03 — Sem recuperação de senha e confirmação de email a bloquear — **ALTO** (risco de bloqueio de conta)

- **Evidência:** `mailer_autoconfirm = false`, `mailer_allow_unverified_email_sign_ins = false`,
  `rate_limit_email_sent = 2`; no código não existe `resetPasswordForEmail` nem qualquer ecrã de
  "esqueci a senha"; o `signUp` também não é usado (o app só faz login).
- **Impacto:** um utilizador que se registe por fora do app (ou via Google→email link) precisa de
  confirmar o email; se perder a senha, **não tem como recuperar**. Com limite de 2 emails/hora,
  tentativas repetidas esgotam o envio e o utilizador fica sem saída.
- **Causa provável:** o fluxo de autenticação do app foi desenhado apenas para login, assumindo
  contas criadas no painel.

### SBX-04 — `public.users` duplica identidade e tem `password` próprio — **MÉDIO**

- **Evidência:** 18 colunas incluindo `password` (1 registo, hash `$2b…` bcrypt), `google_id`,
  `email UNIQUE`. Contagens: `auth.users` = 3, `public.users` = 1, **0 emails coincidentes**;
  `public.users` tem 1 linha **sem** conta em `auth.users`; `auth.users` tem 3 contas **sem** linha
  em `public.users`.
- **Impacto:** duas fontes de identidade. Nada no app lê ou escreve esta tabela. Se algum dia for
  usada, o `user_id` das outras tabelas aponta para `public.users` (FK `ON DELETE CASCADE`) e não
  para `auth.users` — apagar um perfil apagaria turnos/despesas **sem** apagar a conta de
  autenticação, e vice-versa.
- **Causa provável:** schema inicial (app Flutter/JS anterior) mantido por inércia.
- **Não é vulnerabilidade hoje:** a tabela só é legível pelo próprio (`auth.uid() = id`), e o hash
  bcrypt está protegido por RLS. Mas é dívida estrutural com risco de perda de dados.

### SBX-05 — `authenticated` tem `TRUNCATE` nas tabelas — **BAIXO**

- **Evidência:** `information_schema.role_table_grants` → `authenticated` com
  `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE` em todas as 8 tabelas.
- **Impacto:** RLS **não** se aplica a `TRUNCATE`. Um utilizador autenticado que consiga emitir
  `TRUNCATE` via PostgREST apagaria **todas** as linhas de todos os utilizadores. Na prática o
  PostgREST não expõe `TRUNCATE` por REST (só GET/POST/PATCH/DELETE), pelo que a exploração exige
  acesso SQL direto — daí BAIXO, não CRÍTICO. `REFERENCES` e `TRIGGER` também são desnecessários
  para o app.
- **Causa provável:** privilégios herdados do `GRANT ALL ON ALL TABLES` default do Supabase.

### SBX-06 — App não distingue "nuvem vazia" de "falha de rede" — **MÉDIO**

- **Evidência:** `mpReconcile()` trata qualquer exceção com `mpSetSyncStatus('offline')` e **não
  altera** o estado local (correto). Mas `mpTrySilentPull()` e o arranque sem sessão dependem de
  `MPS_NEEDS_PULL_KEY`; e `scheduleCloudSync` **não** é chamado quando `saveState()` falha (correção
  da Fase 2). O caso não coberto é o inverso: sessão válida + falha de rede no push → o utilizador vê
  "offline", o histórico local fica bem, mas o `MP_SYNC_KEY` não avança e o próximo pull pode
  adotar um estado remoto mais antigo **unindo** (não substituindo) — comportamento seguro.
- **Impacto:** não há perda de dados no caminho atual (a união por id só adiciona); o risco é de
  **duplicação** de registos com o mesmo id lógico mas ids diferentes (ver SBX-07).
- **Causa provável:** modelo "estado inteiro em JSONB" em vez de linhas por registo.

### SBX-07 — Conflito por id: união pode duplicar um turno editado em dois aparelhos — **MÉDIO**

- **Evidência:** `mpMergeLists()` usa `Map` por `String(x.id)`; em conflito, **a nuvem ganha** e o
  local é descartado desse id sem qualquer aviso (`recuperados` só conta os ids ausentes).
- **Impacto:** se o mesmo turno foi editado no telemóvel (offline) e noutro aparelho, a versão local
  é silenciosamente substituída pela remota. Não se perde o turno, mas perde-se a edição. A cópia
  pré-pull (`mp_state_backup_before_pull_v8`) permite recuperar, mas o utilizador tem de saber que
  existe.
- **Causa provável:** estratégia last-write-wins ao nível do registo, sem versão por linha.

### SBX-08 — Sem histórico de backup verificável — **ALTO (potencial)**

- **Evidência:** `list_migrations` tem 1 entrada; **não há API** neste conector para ler plano,
  janela de PITR ou retenção. O projeto foi criado em 2026-10-23.
- **Impacto:** se for plano Free, **não há PITR** e os backups diários têm retenção curta (~7 dias);
  a recuperação depende de suporte. Com 200 turnos reais na nuvem, isto é o maior risco residual.
- **Causa provável:** plano contratado não documentado no repositório.

### SBX-09 — `login` sem `password_min_length` coerente com o app — **BAIXO**

- **Evidência:** `password_min_length = 8`, `password_required_characters` exige letras e dígitos,
  `password_hibp_enabled = false`.
- **Impacto:** o app não valida nada antes de enviar (o `signUp` nem existe); o utilizador descobre os
  requisitos apenas pelo erro do servidor, em inglês. Senhas vazadas não são bloqueadas.

### SBX-10 — Assets Android podem ficar congelados (mitigado, não eliminado) — **MÉDIO**

- **Evidência:** `android/app/src/main/assets/public` **não** é gerado no build; é uma cópia
  versionada. O workflow atual faz `npx cap sync`, mas **não** falha se a cópia estiver velha (foi o
  que produziu o APK a falar com o projeto eliminado).
- **Impacto:** já existe `scripts/verify-android-assets.js` (Fase anterior) que deteta isto, mas só
  corre se for invocado — no workflow atual não é.

---

## D. Plano de correção recomendado

Nada foi executado. Ordem por prioridade, com risco explícito.

### 1. Segurança e proteção dos dados

| # | Ação | Onde | Risco |
|---|---|---|---|
| 1.1 | `REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated` (e `anon`) | SQL Editor | Nulo para o app; `authenticated` mantém SELECT/INSERT/UPDATE/DELETE |
| 1.2 | Confirmar plano e retenção de backup; se Free, exportar `user_states` periodicamente para ficheiro (o app já tem backup local de 3 cópias) | Painel → Settings → Billing / Database → Backups | Nenhum |
| 1.3 | Considerar `password_hibp_enabled = true` | Auth → Settings | Bloqueia senhas vazadas; pode gerar reclamações |

### 2. Autenticação e login

| # | Ação | Onde | Risco |
|---|---|---|---|
| 2.1 | `Site URL` → domínio real de produção (ou `https://xncxzczftetctpazzecu.supabase.co` como provisório) | Auth → URL Configuration | Médio: links de email passam a apontar para o sítio certo |
| 2.2 | Decidir sobre `mailer_autoconfirm`: `true` enquanto não houver SMTP próprio (senão o registo fica bloqueado) | Auth → Settings | Baixo |
| 2.3 | Implementar "Esqueci a senha" no app (`resetPasswordForEmail`) **ou** manter as contas criadas apenas no painel e documentar | Código + painel | Médio: toca no fluxo de login, exige teste |
| 2.4 | Configurar SMTP próprio (Resend/SendGrid) para subir o limite de 2 emails/h | Auth → SMTP | Baixo |
| 2.5 | Para o Google no Android: adotar **PKCE** (`flowType: 'pkce'`) e validar o `appUrlOpen`; alternativa mais robusta é um plugin OAuth nativo (`@capacitor-community/generic-oauth` ou Google Sign-In) e `signInWithIdToken` | Código + Google Cloud | **Alto**: altera o fluxo de autenticação; precisa de teste em aparelho |
| 2.6 | Confirmar no Google Cloud o redirect `https://xncxzczftetctpazzecu.supabase.co/auth/v1/callback` (o guia do repo ainda diz o projeto antigo) | Google Cloud Console | Nenhum |

### 3. Conexão e sincronização

| # | Ação | Onde | Risco |
|---|---|---|---|
| 3.1 | Distinguir no app "sem dados na nuvem" de "não consegui contactar a nuvem" (mensagem + não marcar `synced`) | `www/js/auth.js` | Baixo |
| 3.2 | Guardar na UI a hora do último sync bem-sucedido e mostrar o resultado do último erro | `render.js` | Baixo |
| 3.3 | Garantir que o workflow corre `npm run android:verify` antes de compilar (proposta em `ci/build-workflow.proposta.yml`) | CI | Nenhum |

### 4. Integridade do banco

| # | Ação | Onde | Risco |
|---|---|---|---|
| 4.1 | Documentar `public.users` como legado e **não** usar; no futuro, migrar FKs para `auth.users` numa janela controlada | Painel/SQL | Alto se feito sem plano: `ON DELETE CASCADE` apagaria dados |
| 4.2 | Desativar (ou remover) a coluna `password` de `public.users` quando a tabela for aposentada | SQL | Médio |
| 4.3 | As tabelas `shifts`, `expenses`, `fuel_logs`, `maintenance_logs`, `fixed_expenses` estão **vazias** e não são usadas: não apagar sem decidir o modelo (o app usa `user_states`) | — | Decisão de produto |

### 5. Backup e recuperação

| # | Ação | Onde | Risco |
|---|---|---|---|
| 5.1 | Registar no repositório (sem segredos) qual o plano e a retenção | README | Nenhum |
| 5.2 | Testar **uma** recuperação de `user_states` a partir de uma cópia exportada, em ambiente separado | Local | Nenhum no projeto |

### 6. Melhorias operacionais

| # | Ação | Onde | Risco |
|---|---|---|---|
| 6.1 | Remover `oauth_server_enabled`/`dynamic_registration` se não forem usados (hoje `true`) | Auth → Settings | Baixo |
| 6.2 | `webauthn_rp_id = localhost` e `rp_origins = http://localhost:8081` — resíduos de dev | Auth | Baixo |
| 6.3 | Documentar o fluxo de identidade: **só** `auth.users` + `user_states` | README | Nenhum |

---

## E. Testes pendentes (não comprováveis aqui)

| Verificação | Por que não foi possível |
|---|---|
| `GET /auth/v1/health` e `/rest/v1/` por HTTPS | TLS cortado pelo sandbox (`SSL_ERROR_SYSCALL` em saída); o painel reporta os serviços `ACTIVE_HEALTHY` |
| Chamada REST autenticada real (SELECT/UPDATE em `user_states`) | Proibido escrever; e o sandbox não alcança `*.supabase.co` |
| Login real de um utilizador (email e Google) | Sem dispositivo/browser; exigiria credenciais de produção |
| Entrega do deep link `com.pro.driver://oauth-callback` no Android | Precisa de aparelho/emulador |
| Persistência de sessão após fechar/abrir o app | Precisa de aparelho |
| Plano, PITR, retenção de backup, logs de Auth | Sem API neste conector; só no painel |
| CORS do projeto | O painel do Supabase não expõe CORS configurável; o GoTrue responde `*` por omissão, mas não foi possível observar o header |
| Teste de RLS "como outro utilizador" | Proibido aceder a dados de terceiros; análise foi estática |
| Compilação e instalação do APK | Sem JDK/SDK e sem permissão `workflows` no GitHub (ver `VALIDACAO-ANDROID.md`) |

---

## F. Parecer final

**1. O Supabase está corretamente configurado?**
Parcialmente. Banco e RLS: sim. Auth/produção: não — `Site URL` de desenvolvimento, sem recuperação
de senha, limites de email baixos. **Não pronto para produção.**

**2. O login por e-mail funciona conforme a configuração?**
Funciona para **contas já confirmadas**: email ativo, `mailer_autoconfirm=false` e
`mailer_allow_unverified_email_sign_ins=false` — quem não confirmou não entra. Existem 2 contas de
email confirmadas. Teste real de login não executado (sem dispositivo).

**3. O Google OAuth está pronto para funcionar?**
**Não comprovado.** O provider está habilitado, com Client ID e Secret; o `com.pro.driver://oauth-callback`
está na lista de redirects. Mas o fluxo nativo não usa PKCE, não foi testado em aparelho, e o único
utilizador Google existente foi criado por fora do app.

**4. O banco está preparado para receber os dados do MotoristaPro?**
Sim. `user_states(user_id uuid PK → auth.users, state jsonb, updated_at com trigger)` cobre 100% do
que o app envia. Há **200 turnos / 32 despesas / 4 manutenções já sincronizados** (92 598 bytes de
JSON, 17 562 bytes em disco).

**5. As políticas RLS protegem corretamente os dados?**
**Sim.** 8/8 tabelas com RLS; 14 políticas todas baseadas em `auth.uid()`; `WITH CHECK` presente em
todas as escritas; `anon` sem privilégios. Não encontrei caminho de leitura/escrita cruzada.
Excesso residual: `TRUNCATE`/`REFERENCES`/`TRIGGER` para `authenticated` (não expostos por REST).

**6. A sincronização pode funcionar sem comprometer o histórico local?**
**Sim, com ressalvas.** A reconciliação é por **união** (nunca remove), guarda o estado local antes
de adotar a nuvem, e nunca substitui local por nuvem vazia. As ressalvas são a resolução de conflito
por id (a nuvem ganha silenciosamente) e a falta de distinção explícita entre "nuvem vazia" e "falha
de rede" na UI.

**7. O aplicativo Android está apontando para o projeto correto?**
**No código, sim:** `www/js/config.js` e os assets Android apontam para `xncxzczftetctpazzecu` com a
chave publishable correta, sem referências ao projeto antigo. **No aparelho, não comprovado** — o APK
instalado é anterior à troca e não houve compilação nova.

**8. O ambiente está pronto para produção?**
**Não.** Faltam: domínio de produção no `Site URL`, fluxo de recuperação de conta, SMTP próprio ou
autoconfirm, validação do OAuth em aparelho, confirmação de backup/PITR e um APK compilado a partir
do código atual.

### Nota técnica: **6,0 / 10**

- **Banco, schema e RLS (9/10):** bem modelado, isolamento correto, trigger de versão no servidor,
  sem órfãos. Descontos: duplicação `public.users` vs `auth.users`, tabelas legadas vazias,
  privilégios excessivos de `TRUNCATE`.
- **Configuração de Auth (4/10):** `Site URL` de dev, sem recuperação de senha, limite de 2 emails/h,
  resíduos de dev no WebAuthn, OAuth habilitado mas não validado ponta a ponta.
- **Sincronização do app (7/10):** reconciliação conservadora e reversível, mas sem PKCE, sem
  resolução de conflito por linha e sem mensagens que distingam falha de ausência.
- **Operação e entrega (4/10):** backup não confirmado, nenhum APK compilado desde a troca de URL,
  CI bloqueado por permissões, guia de configuração no repo ainda com o projeto antigo.
- **Integridade dos dados financeiros (8/10):** os dados estão na nuvem **e** no aparelho com backup
  triplo local; o risco maior é a ausência de PITR comprovada, não o código.

---

## Garantias desta auditoria

- Nenhuma escrita SQL, nenhuma migration, nenhuma alteração de RLS, tabela, coluna, índice, trigger
  ou função.
- Nenhum provedor de autenticação ativado/desativado; Google OAuth **não** foi tocado (já estava
  habilitado antes desta auditoria).
- Nenhum utilizador criado, alterado ou removido; nenhum registo lido em detalhe (apenas contagens e
  estrutura).
- Nenhum segredo transcrito: as chaves `service_role`/`sb_secret` devolvidas pela API foram ignoradas.
- Repositório sem alterações (`git status` limpo, HEAD `c51856b`); `npm test` 92/92 como verificação
  de que nada regrediu.
