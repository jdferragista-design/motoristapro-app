# MotoristaPro — Login Google + Supabase (passo a passo)

O código já está implementado no app:
- `www/js/vendor/supabase.js` + `www/js/config.js` + `www/js/auth.js`
- Ecrã de login overlay (`#mpLoginScreen`), conta nas Configurações
- Sync automático para a tabela `user_states` (last-write-wins)
- Android: `@capacitor/browser` + `@capacitor/app` + intent-filter `com.pro.driver://oauth-callback`

Falta configurar **3 lados**: Supabase (BD + Auth) e Google Cloud (OAuth).

## 1. Criar a tabela (Supabase → SQL Editor)

1. Dashboard Supabase → **SQL Editor** → **New query**
2. Cola o conteúdo de [`supabase/motoristapro-schema.sql`](./supabase/motoristapro-schema.sql)
3. **RUN**

## 2. Criar credenciais no Google Cloud

1. https://console.cloud.google.com → **Novo projeto** (ou usar um existente)
2. **APIs & Services → OAuth consent screen** → External → preencher → Save
   - Se a app ficar em *Testing*, em **Audience → Test users** adiciona o teu email
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Type: **Web application**
   - **Authorized redirect URIs** (só este campo leva caminho):
     ```
     https://ewmtphddypfcllewkgzl.supabase.co/auth/v1/callback
     ```
   - ⚠️ **Não** coloques nada com caminho em *Authorized JavaScript origins* —
     esse campo só aceita origens como `https://ewmtphddypfcllewkgzl.supabase.co`
4. **Create** → copia **Client ID** e **Client Secret**

## 3. Ativar o provider Google (Supabase → Authentication)

1. **Authentication → Sign In / Providers → Google** → **Enable**
2. Cola o **Client ID** e **Client Secret** do passo 2 → **Save**

4. **Authentication → URL Configuration**:
   - **Site URL**: `https://ewmtphddypfcllewkgzl.supabase.co` (ou o domínio do app web)
   - **Redirect URLs** → **Add**, adiciona:
     ```
     com.pro.driver://oauth-callback
     http://localhost:8091/*
     ```
     (o primeiro é o retorno no APK; o segundo permite testar no browser)

## 4. Testar

### No browser (dev)
```bash
cd motoristapro-app
python3 -m http.server 8091 --directory www
# abre http://localhost:8091 → ecrã de login → Entrar com Google
```

### APK
```bash
npx cap sync android && cd android && ./gradlew assembleDebug
```
Ou push para `main` → o GitHub Actions gera o APK automaticamente
(*Gerar APK do MotoristaPro*).

## Como funciona

| Momento | O que acontece |
|---|---|
| 1ª abertura | Ecrã de login (ou "Continuar sem conta" → modo local puro) |
| Login Google | Chrome Custom Tab → Google → redirect `com.pro.driver://oauth-callback` → app troca `code` por sessão |
| Qualquer alteração | `saveState()` agenda push (debounce 2,5 s) para `user_states` |
| Arranque/rede volta | Reconcile: nuvem mais nova ⇒ adota; local mais novo ⇒ envia |
| Sem internet | Tudo continua a funcionar no `localStorage`; sync quando voltar |

## Erros comuns

| Erro | Solução |
|---|---|
| `redirect_uri_mismatch` | A redirect URI no Google tem de ser exatamente `https://ewmtphddypfcllewkgzl.supabase.co/auth/v1/callback` |
| `Origem inválida` (no Google Cloud) | Estás a colar URL com caminho em *JavaScript origins* — usa só a origem, sem caminho |
| `access blocked` | App em Testing → adiciona o email em **Test users** |
| `Could not find the table public.user_states` | Falta correr o SQL (passo 1) |
| Login fecha mas não entra | Confirma Redirect URL `com.pro.driver://oauth-callback` no Supabase (passo 3.4) |
| Erro no ecrã de login | Vê `localStorage.mp_logs` / consola — `logEvent` guarda tudo |
