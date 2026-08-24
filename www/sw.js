/* MotoristaPro Service Worker — suporte offline 100% (network-first p/ HTML + cache-first p/ assets) */
const CACHE = 'motoristapro-v9';
const ASSETS = [
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'css/style.css',
  'js/utils.js',
  'js/charts.js',
  'js/data.js',
  'js/domain.js',
  'js/ui.js',
  'js/render.js',
  'js/init.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // O próprio Service Worker nunca pode ser servido do cache (impediria updates)
  if (event.request.url.endsWith('sw.js')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // HTML/navegação: prioriza rede para evitar ficar preso em build antigo
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put('index.html', clone));
        }
        return response;
      }).catch(() => caches.match('index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      // Assets: cache-first com atualização em background
      return cached || network;
    })
  );
});
