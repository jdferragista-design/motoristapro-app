/* MotoristaPro Service Worker — suporte offline 100% (network-first p/ HTML + cache-first p/ assets) */
// Versão da cache: SUBIR SEMPRE que se altera qualquer ficheiro de código.
// Se não subir, o browser continua a servir a versão antiga do cache e o
// utilizador fica preso a um build anterior (foi o que aconteceu com o
// config.js a apontar para um projeto Supabase que já não existe).
const CACHE = 'motoristapro-v32';

// Código NUNCA pode vir do cache primeiro: uma correção publicada tem de
// chegar ao utilizador na visita seguinte. Antes era cache-first para tudo,
// então o JS antigo ganhava mesmo com o ficheiro novo no servidor.
const NETWORK_FIRST = /\/(js|css)\//;
const ASSETS = [
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'css/style.css',
  'js/vendor/supabase.js',
  'js/config.js',
  'js/capacitor.js',
  'js/utils.js',
  'js/charts.js',
  'js/data.js',
  'js/backup.js',
  'js/domain.js',
  'js/ui.js',
  'js/render.js',
  'js/init.js',
  'js/auth.js'
];

// Limpeza de emergência: apagar manualmente uma cache específica pelo
// nome, sem precisar de DevTools. Basta abrir sw.js?wipe=motoristapro-v28
// (a página HTML do sw.js não é interceptada, então qualquer URL que
// termine em sw.js cai aqui).
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'WIPE_CACHE' && d.name) {
    event.waitUntil(caches.delete(d.name));
  }
});

self.addEventListener('install', (event) => {
  // cache:'reload' obriga a ir à rede e ignorar o HTTP cache do browser.
  // Sem isto, o install de uma cache nova podia encher-se com os ficheiros
  // VELHOS que o browser tinha em disco — a cache mudava de nome mas não de
  // conteúdo (foi exactamente o que aconteceu na v29).
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(
        ASSETS.map(url =>
          fetch(new Request(url, { cache: 'reload' }))
            .then(res => { if (res && res.ok) return cache.put(url, res); })
            .catch(() => {})
        )
      ))
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

  const url = event.request.url;
  const ehCodigo = NETWORK_FIRST.test(url);

  // Código (JS/CSS): REDE primeiro, cache só como recurso quando offline.
  // IMPORTANTE: NÃO se faz cache.put aqui. Antes, cada visita reescrevia a
  // cache do próprio SW antigo, renovando o prazo do build errado. Sem
  // put, a única cópia é a do install (que carrega com cache:'reload').
  if (ehCodigo) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() =>
        caches.match(event.request, { ignoreSearch: true })
      )
    );
    return;
  }

  // Restantes assets (ícones, manifest): cache-first com refresh em background.
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
