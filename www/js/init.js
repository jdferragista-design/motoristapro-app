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
