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

render();

calculateTripSim();

// Primeiro uso: sem dados salvos e nunca escolhido → perguntar se começa
// do zero (limpa a demo) ou mantém os dados de exemplo.
const MP_FIRST_USE_FLAG = 'mp_first_use_done_v8';
(function firstUseCheck() {
  try {
    if (localStorage.getItem('mp_html_state_v8')) return; // utilizador já tem dados
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
    saveState(); // persiste + re-render
  } else {
    // Dados de exemplo: guarda o defaultData para não perguntar de novo
    try { localStorage.setItem('mp_html_state_v8', JSON.stringify(state)); } catch (e) {}
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
