const CACHE_NAME = 'bug-snake-v0';
const CORE_ASSETS = [
  './',
  './index.html',
  './favicon.ico',
  './styles/main.css',
  './scripts/main.js',
  './scripts/core/config.js',
  './scripts/core/game.js',
  './scripts/core/game-loop.js',
  './scripts/core/grid.js',
  './scripts/core/item-manager.js',
  './scripts/core/score-manager.js',
  './scripts/core/time-manager.js',
  './scripts/core/random.js',
  './scripts/core/snake.js',
  './scripts/core/state-machine.js',
  './scripts/render/renderer.js',
  './scripts/render/particles.js',
  './scripts/audio/audio-engine.js',
  './scripts/input/input-manager.js',
  './scripts/maps/map-generator.js',
  './scripts/i18n/i18n.js',
  './scripts/ai/ai-pilot.js',
  './scripts/ui/panel-manager.js',
  './scripts/utils/dom.js',
  './scripts/utils/keyboard-hint.js',
  './scripts/utils/keyboard-shortcut.js',
  './scripts/utils/min-heap.js',
  './i18n/index.json',
  './i18n/en-US.json',
  './i18n/zh-TW.json',
  './i18n/zh-CN.json',
  './i18n/ja-JP.json',
  './i18n/ko-KR.json',
  './i18n/fr-FR.json',
  './i18n/de-DE.json',
  './i18n/es-ES.json',
  './i18n/it-IT.json',
  './i18n/nl-NL.json',
  './i18n/pl-PL.json',
  './i18n/pt-BR.json',
  './i18n/ru-RU.json',
  './i18n/tr-TR.json',
  './i18n/vi-VN.json',
  './i18n/th-TH.json',
  './i18n/id-ID.json',
  './i18n/ar-SA.json',
  './i18n/fa-IR.json',
  './i18n/hi-IN.json',
  './i18n/bn-BD.json',
  './i18n/ur-PK.json'
];

const OPTIONAL_ASSETS = ['https://cdn.jsdelivr.net/npm/lil-gui@0.18.0/dist/lil-gui.esm.min.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS).then(() => {
        return Promise.allSettled(OPTIONAL_ASSETS.map((url) => cache.add(url))).then(() =>
          self.skipWaiting()
        );
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCoreAsset =
    isSameOrigin &&
    (url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.json') ||
      url.pathname.endsWith('/'));

  event.respondWith(
    isCoreAsset
      ? fetch(event.request)
          .then(async (response) => {
            if (response && response.ok) {
              const copy = response.clone();
              event.waitUntil(
                caches
                  .open(CACHE_NAME)
                  .then((cache) => cache.put(event.request, copy))
                  .catch(() => {})
              );
              return response;
            }

            const cached = await caches.match(event.request);
            return cached || response;
          })
          .catch(() => caches.match(event.request).then((r) => r || Response.error()))
      : caches.match(event.request).then((response) => {
          return response || fetch(event.request);
        })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      ).then(() => self.clients.claim());
    })
  );
});
