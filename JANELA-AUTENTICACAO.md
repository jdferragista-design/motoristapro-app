# Janela de autenticação — v1.18.4 (versionCode 11804)

Implementação dos fluxos de conta do MotoristaPro sobre a base `f62606d`
(branch `arena/00e05b00`, trazida por fast-forward para a branch de trabalho).
**Nada foi alterado no Supabase, no Google Cloud, no banco, no RLS ou nos
usuários.** O histórico financeiro local não é tocado em nenhum ponto.

---

## 1. O que a janela faz

Uma única janela (`#mpLoginScreen`) com quatro vistas trocadas no mesmo lugar:

| Vista | Campos | Ação | Chamada Supabase |
|---|---|---|---|
| Entrar | e-mail, senha, olho para ver a senha | `mpLoginWithEmail()` | `signInWithPassword` |
| Entrar (Google) | — | `mpLoginWithGoogle()` (código existente) | `signInWithOAuth` + PKCE |
| Criar conta | nome (opcional), e-mail, senha, confirmar | `mpSignupWithEmail()` | `signUp` |
| Esqueci a senha | e-mail | `mpRequestPasswordReset()` | `resetPasswordForEmail` |
| Redefinir senha | nova senha, confirmar | `mpUpdatePassword()` | `updateUser({ password })` |

Porta de entrada: **Configurações → Conta & Nuvem → "Entrar ou criar conta"**.
Depois de autenticado: **"Alterar senha"** no mesmo cartão.
**Atualização da Fase 3:** o app deixou de abrir direto. A janela passou a ser
o portão de acesso — nenhuma tela financeira aparece antes de a sessão ser
validada. Ver `PORTAO-ACESSO-FASE3.md`.

## 2. Regras aplicadas em todas as ações

- **Trava de clique repetido** (`mpAuthEmCurso`): um segundo toque não abre
  outro pedido. Coberto pelos cenários A09, A16 e A18.
- **Política de senha igual à do projeto**: mínimo 8, uma minúscula, uma
  MAIÚSCULA e um número. Validada no aparelho *antes* de qualquer pedido, com
  checklist em tempo real e mensagem que diz exatamente o que falta.
- **Confirmação de e-mail obrigatória**: com `mailer_autoconfirm = false`, o
  `signUp` não devolve sessão. A janela explica que é preciso abrir o link e
  volta para "Entrar" com o e-mail já preenchido.
- **`redirectTo` sempre explícito**: o `site_url` do projeto é
  `http://localhost:8080`, por isso nunca se deixa o GoTrue escolher o destino.
  Nativo → `com.pro.driver://oauth-callback`; web → a própria página.
- **Sem enumeração de contas**: "Esqueci minha senha" responde sempre a mesma
  coisa, exista ou não a conta; e quando o `signUp` devolve utilizador com
  identidades vazias (e-mail já registado), a mensagem é neutra — não afirma
  que criou a conta.
- **Mensagens em pt-BR** para os erros do GoTrue (credenciais inválidas, e-mail
  não confirmado, senha fraca, limite de envios, rede, link expirado).
- **Sem segredos em log**: nunca se registra senha, código, token ou verificador.
- **Retorno de recuperação reconhecido**: a intenção (`mp_auth_intent_v1`) é
  gravada ao pedir o link e consumida no retorno, para abrir o ecrã de nova
  senha em vez de apenas "entrar".
- **Android**: `windowSoftInputMode="adjustResize"` para o teclado não esconder
  os campos; botão "voltar" fecha a janela (vista interna → "Entrar" → fecha) e
  mantém o comportamento antigo fora dela (sai do app).

## 3. O que mudou em ficheiros

| Ficheiro | Mudança |
|---|---|
| `www/index.html` | janela com 4 vistas (9 campos, 66 labels no total), `?v=29` nos assets |
| `www/css/style.css` | estilos `.mp-auth-*` (card com scroll, teclado, ecrãs baixos, checklist) |
| `www/js/auth.js` | +518 linhas: validação, políticas, mensagens, 4 ações, intenção de recuperação, botão voltar |
| `www/sw.js` | cache `v33` (descarta o HTML antigo do service worker) |
| `AndroidManifest.xml` | `adjustResize` |
| `tests/boot-smoke.js` | 23 cenários (A01–A23) + ajuste de 2 fixtures |
| `tests/lib/auth-fixtures.js` | novo: monta a janela real e simula o Supabase ao nível do `fetch` |
| `package.json` / `build.gradle` / `index.html` / `package-lock.json` | 1.18.4 / 11804 |

**Não alterados:** `www/js/config.js` (já apontava para `xncxzczftetctpazzecu`),
`mpReconcile()` (corpo intacto), `mpPushCore`, `mpMergeStates`, backup,
`user_states`, RLS, políticas, SMTP, Google Cloud.

## 4. Testes

`npm test` → **225 verificações, 0 falhas** (linha de base era 159, com 2 falhas
pré-existentes de assets Android não copiados — resolvidas com `npx cap copy`).
`npm run version:check` → `1.18.4 (11804)`. `npm run android:verify` → assets e
projeto consistentes.

Os 23 cenários: abertura/fecho e troca de vistas, validação de e-mail e senha,
política de senha (4 regras), cadastro com e-mail já existente, limite de
envios, confirmação obrigatória, clique repetido (login, cadastro, recuperação),
recuperação com `redirectTo` explícito, redefinição sem sessão/fora da política,
redefinição concluída, retorno de deep link de recuperação, web vs. nativo,
olho da senha e checklist.

### O que cada tipo de prova cobre

| Tipo | O que está provado |
|---|---|
| **Mocks (jsdom + vendor real)** | markup real, ids, validação local, corpo e URL dos pedidos (`grant_type=password`, `redirect_to`, `password`), ausência de pedido quando a validação reprova, mensagens, travas, fluxo PKCE ponta a ponta com o verificador gerado pelo próprio app |
| **Supabase real (somente leitura)** | projeto `xncxzczftetctpazzecu`; 4 usuários (4 confirmados); 1 linha em `user_states` (última atualização 2026-11-10 12:41:35 — anterior a este trabalho); RLS ativo; regras de senha 8 + minúscula + MAIÚSCULA + dígito; signup permitido; confirmação obrigatória; Google ativo; allowlist com `com.pro.driver://oauth-callback` |
| **Android físico** | **não executado nesta fase** — exige aparelho. Ver secção 6 |

## 5. Pendências externas (não autorizadas / não alteradas)

1. **SMTP não configurado** (`smtp_*` nulos) e `rate_limit_email_sent = 2`.
   Consequência: e-mails de confirmação e de recuperação usam o remetente de
   teste do Supabase, **só entregam a endereços da equipa do projeto** e estão
   limitados a ~2 por hora. Sem SMTP, o cadastro e a recuperação não fecham o
   ciclo real com um e-mail qualquer — o código está pronto, a entrega não.
2. **`site_url = http://localhost:8080`**. Não bloqueia (todo o fluxo usa
   `redirectTo` explícito), mas é frágil para links abertos fora do app.
3. **Google Cloud Console** não verificável daqui; o provider está ativo no
   Supabase, mas o teste em Android real continua pendente.
4. **`security_update_password_require_current_password = false`**: "Alterar
   senha" com sessão ativa não pede a senha atual. É o comportamento do projeto;
   mudá-lo é decisão sua (alteração externa).

## 6. Teste em Android físico (sem risco para os dados)

1. **Antes de instalar**: exportar o JSON completo e validar em duas cópias
   (`npm run backup:verify -- <arquivo> --turnos 200 --despesas 32 --manutencoes 4`).
   Sem backup válido, não avançar.
2. Instalar o APK novo **por cima** do atual: mesmo `applicationId`
   (`com.pro.driver`) e `versionCode` 11804 > 11803 — atualização, não
   reinstalação. **Não desinstalar, não limpar dados.**
3. Roteiro: entrar com e-mail/senha → confirmar dados financeiros intactos →
   abrir "Alterar senha" → sair → recuperar senha (depende do SMTP) → Google.
4. Se algo falhar: não limpar dados; reportar com o log técnico.

## 7. Como conferir nesta branch

```bash
npm test                # 225 verificações
npm run version:check   # 1.18.4 / 11804
npm run android:verify  # assets batem com www/ e com o projeto certo
npm run preview         # abre o app; Configurações → Conta & Nuvem
```

Na pré-visualização web, para abrir a janela direto pelo console:
`mpAuthAbrir('login')`, `mpAuthAbrir('signup')`, `mpAuthAbrir('forgot')`.
