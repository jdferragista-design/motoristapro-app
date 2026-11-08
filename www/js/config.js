// MotoristaPro — configuração do Supabase (chaves públicas; RLS protege os dados)
//
// Projeto: motoristapro-Project (ref xncxzczftetctpazzecu, us-east-1)
// NUNCA colocar aqui a service_role / sb_secret_* — ela ignora o RLS.
// A publishable key abaixo é segura em repo público: sozinha ela não lê
// nada além do que o RLS autoriza para o utilizador autenticado.
window.MP_SUPABASE_URL = 'https://xncxzczftetctpazzecu.supabase.co';
window.MP_SUPABASE_ANON_KEY = 'sb_publishable_uawPr8B5Wk5Y1bSnAJ5bqg_XTolwMCM';

// Deep link de retorno do OAuth Google (nativo Android)
window.MP_OAUTH_REDIRECT_NATIVE = 'com.pro.driver://oauth-callback';
