// MotoristaPro — boot: PWA, listeners e inicialização


// PWA Install Prompt Listener
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPWAEvent = e;
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.style.display = 'flex';
});


// Dropdown custom app handler
document.addEventListener('DOMContentLoaded', () => {
  const appSelect = document.getElementById('currentAppSelect');
  if (appSelect) {
    appSelect.addEventListener('change', (e) => {
      const isCustom = e.target.value === 'custom';
      document.getElementById('customAppNameBox').style.display = isCustom ? 'block' : 'none';
    });
  }
});


// Initialize
wireCentsMasks();

// Materializa as despesas fixas do mês (idempotente: nunca duplica).
// Sem isto o utilizador tem de lembrar de lançar prestação/seguro/MEI todo mês
// — e nos dados reais ele esqueceu: R$ 609,14/mês fora do histórico.
syncRecurringExpenses();

// Mesma lógica para compras parceladas: uma parcela por mês até hoje.
syncInstallmentExpenses();

// Remove lançamentos cuja origem (fixa/parcelada) foi excluída.
pruneOrphanGeneratedExpenses();

// C-02: garante que existe pelo menos uma cópia antes de o utilizador
// continuar a trabalhar. `force` só quando não há nenhuma.
if (typeof mpBackupMaybe === 'function') {
  try {
    if (mpBackupList().length === 0) mpBackupMaybe(true);
  } catch (e) { logEvent('warn', 'Backup de arranque falhou', { message: e && e.message }); }
}

// Versão real, vinda de utils.js. É o único indicador fiável de qual build
// está a correr: o texto do cabeçalho era hardcoded e nunca mudava.
(function stampVersion() {
  const el = document.getElementById('brandVersion');
  if (el) el.textContent = APP_VERSION;
})();

render();

calculateTripSim();

// Primeiro uso: sem dados salvos e nunca escolhido → perguntar se começa
// do zero (limpa a demo) ou mantém os dados de exemplo.
const MP_FIRST_USE_FLAG = 'mp_first_use_done_v8';
// Chave partilhada com o auth.js: marca que o estado em memória é a
// DEMONSTRAÇÃO (defaultData), não o histórico do utilizador. Tudo o que é
// demonstração fica proibido de subir para a nuvem e é descartado ao entrar.
const MP_DEMO_KEY = 'mp_demo_data_v1';
(function firstUseCheck() {
  try {
    if (localStorage.getItem('mp_html_state_v8')) return; // utilizador já tem dados
    // Sem estado guardado, o que está em memória é a demonstração.
    localStorage.setItem(MP_DEMO_KEY, '1');
    if (localStorage.getItem(MP_FIRST_USE_FLAG)) return;
    const el = document.getElementById('mpFirstUseScreen');
    if (el) el.style.display = 'flex';
  } catch (e) { /* sem localStorage: segue normal */ }
})();

function mpFirstUse(mode) {
  if (mode === 'zero') {
    // Estado vazio: sem turnos/despesas/manutenção e sem carro de demonstração
    state = migrateState({
      vehicle: Object.assign({}, defaultData.vehicle, {
        model: '',
        plate: '',
        odometer: 0,
        manualOdometerBase: 0
      }),
      fuelSettings: defaultData.fuelSettings,
      shifts: [],
      expenses: [],
      maintenance: []
    });
    syncVehicleOdometer();
    try { localStorage.removeItem(MP_DEMO_KEY); } catch (e) { /* nada */ }
    saveState(); // persiste + re-render
  } else {
    // Dados de exemplo: guarda o defaultData para não perguntar de novo.
    // A marca de demonstração impede que subam para a conta do utilizador.
    try {
      const exemplo = JSON.stringify(state);
      localStorage.setItem('mp_html_state_v8', exemplo);
      localStorage.setItem(MP_DEMO_KEY, '1');
      // Cópia da demonstração tal como foi gravada: se o utilizador a editar,
      // o auth.js percebe (ao entrar) que já são dados dele e não apaga nada.
      localStorage.setItem('mp_demo_snapshot_v1', exemplo);
    } catch (e) {}
    render();
  }
  try { localStorage.setItem(MP_FIRST_USE_FLAG, '1'); } catch (e) {}
  const el = document.getElementById('mpFirstUseScreen');
  if (el) el.style.display = 'none';
}

// Sinaliza boot concluído (usado pelo banner de diagnóstico do index.html)
window.__MP_BOOTED = true;
logEvent('info', 'Boot concluído', { version: APP_VERSION });
window.addEventListener('error', function (e) {
  logEvent('error', 'Erro global em runtime', { message: e.message, source: e.filename, line: e.lineno, col: e.colno });
  var b = document.getElementById('bootErrorBanner');
  if (b && e.message) b.style.display = 'flex';
});
window.addEventListener('unhandledrejection', function (e) {
  var reason = e && e.reason;
  logEvent('error', 'Promise rejeitada sem tratamento', reason && reason.message ? { message: reason.message, stack: reason.stack } : reason);
});
