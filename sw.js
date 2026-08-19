// @ts-check
/** @type {ServiceWorkerGlobalScope} */
const serviceWorker = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const CACHE_PREFIX = 'bug-snake-v';
const CACHE_VERSION = 3;
const CACHE_NAME = 'bug-snake-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './favicon.ico',
  './styles/main.css',
  './styles/daily-challenge.css',
  './styles/death-review.css',
  './scripts/main.js',
  './scripts/core/config.js',
  './scripts/core/daily-challenge.js',
  './scripts/core/daily-v1-algorithm.js',
  './scripts/core/daily-challenge-store.js',
  './scripts/core/death-review-recorder.js',
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
  './scripts/ui/daily-challenge-controller.js',
  './scripts/ui/death-review-controller.js',
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

serviceWorker.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS).then(() => {
        return Promise.allSettled(OPTIONAL_ASSETS.map((url) => cache.add(url))).then(() =>
          serviceWorker.skipWaiting()
        );
      });
    })
  );
});

serviceWorker.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === serviceWorker.location.origin;
  const isNavigation = isSameOrigin && event.request.mode === 'navigate';
  const isCoreAsset =
    isSameOrigin &&
    (isNavigation ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.json') ||
      url.pathname.endsWith('/'));
  const cacheKey = isNavigation ? getNavigationCacheKey(url) : event.request;

  event.respondWith(
    isCoreAsset
      ? handleCoreAssetRequest(event, cacheKey)
      : caches.match(event.request).then((response) => {
          return response || fetch(event.request);
        })
  );
});

/**
 * Keep network access independent of Cache Storage availability. Caching is
 * best-effort: a restricted, full, or corrupted cache must not turn an
 * otherwise successful online request into a failed response.
 * @param {FetchEvent} event
 * @param {Request | string} cacheKey
 * @returns {Promise<Response>}
 */
async function handleCoreAssetRequest(event, cacheKey) {
  const cachePromise = caches.open(CACHE_NAME).catch(() => null);

  try {
    const response = await fetch(event.request);
    if (response && response.ok) {
      const copy = response.clone();
      event.waitUntil(
        cachePromise
          .then((cache) => (cache ? cache.put(cacheKey, copy) : undefined))
          .catch(() => {})
      );
      return response;
    }

    const cache = await cachePromise;
    if (!cache) return response;
    const cached = await cache.match(cacheKey).catch(() => undefined);
    return cached || response;
  } catch {
    const cache = await cachePromise;
    if (!cache) return Response.error();
    const cached = await cache.match(cacheKey).catch(() => undefined);
    return cached || Response.error();
  }
}

serviceWorker.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      const staleOwnedCaches = cacheNames.filter((cacheName) => {
        const cacheVersion = getOwnedCacheVersion(cacheName);
        return cacheVersion !== null && cacheVersion < CACHE_VERSION;
      });
      return Promise.all(staleOwnedCaches.map((cacheName) => caches.delete(cacheName))).then(() =>
        serviceWorker.clients.claim()
      );
    })
  );
});

/**
 * Return the numeric version only for caches owned by this application. Cache
 * Storage is shared by every application on the same origin, including sibling
 * GitHub Pages projects. Older workers must also preserve newer cache versions
 * during rollback or activation races.
 * @param {string} cacheName
 * @returns {number | null}
 */
function getOwnedCacheVersion(cacheName) {
  if (!cacheName.startsWith(CACHE_PREFIX)) return null;
  const versionText = cacheName.slice(CACHE_PREFIX.length);
  if (!/^\d+$/.test(versionText)) return null;
  const version = Number(versionText);
  return Number.isSafeInteger(version) ? version : null;
}

/**
 * Keep navigation cache entries independent of share/query parameters while
 * leaving the actual network request untouched so page code can still read
 * location.search.
 * @param {URL} url
 * @returns {string}
 */
function getNavigationCacheKey(url) {
  const cacheUrl = new URL(url.href);
  cacheUrl.search = '';
  return cacheUrl.href;
}
