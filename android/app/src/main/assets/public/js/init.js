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
