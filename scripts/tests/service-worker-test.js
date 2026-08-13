// @ts-check
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const ORIGIN = 'https://example.test';
const CACHE_NAME = 'bug-snake-v2';

class FakeResponse {
  /**
   * @param {string} body
   * @param {boolean} [ok]
   */
  constructor(body, ok = true) {
    this.body = body;
    this.ok = ok;
  }

  clone() {
    return new FakeResponse(this.body, this.ok);
  }

  static error() {
    return new FakeResponse('', false);
  }
}

/**
 * @param {string | {url: string}} request
 * @returns {string}
 */
function keyOf(request) {
  return typeof request === 'string' ? request : request.url;
}

class FakeCache {
  constructor() {
    /** @type {Map<string, FakeResponse>} */
    this.entries = new Map();
  }

  /** @param {string | {url: string}} request */
  async match(request) {
    return this.entries.get(keyOf(request));
  }

  /** @param {string | {url: string}} request @param {FakeResponse} response */
  async put(request, response) {
    this.entries.set(keyOf(request), response.clone());
  }

  async add() {}

  async addAll() {}
}

class FakeCaches {
  /** @param {boolean} [failOpen] */
  constructor(failOpen = false) {
    /** @type {Map<string, FakeCache>} */
    this.named = new Map();
    this.failOpen = failOpen;
  }

  /** @param {string} name */
  async open(name) {
    if (this.failOpen) throw new Error('Cache Storage unavailable');
    let cache = this.named.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.named.set(name, cache);
    }
    return cache;
  }

  /** @param {string | {url: string}} request */
  async match(request) {
    for (const cache of this.named.values()) {
      const response = await cache.match(request);
      if (response) return response;
    }
    return undefined;
  }

  async keys() {
    return [...this.named.keys()];
  }

  /** @param {string} name */
  async delete(name) {
    return this.named.delete(name);
  }
}

/**
 * @typedef {{method: string, url: string, mode: string}} FakeRequest
 * @typedef {{
 *   caches: FakeCaches,
 *   dispatch: (request: FakeRequest) => Promise<FakeResponse>
 * }} Harness
 */

/**
 * @param {(request: FakeRequest) => Promise<FakeResponse>} fetchImpl
 * @param {{failCacheOpen?: boolean}} [options]
 * @returns {Promise<Harness>}
 */
async function createHarness(fetchImpl, { failCacheOpen = false } = {}) {
  /** @type {Map<string, Function>} */
  const listeners = new Map();
  const caches = new FakeCaches(failCacheOpen);
  const serviceWorker = {
    location: { origin: ORIGIN },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    /** @param {string} type @param {Function} handler */
    addEventListener(type, handler) {
      listeners.set(type, handler);
    }
  };

  const source = await readFile(new URL('../../sw.js', import.meta.url), 'utf8');
  runInNewContext(source, {
    self: serviceWorker,
    caches,
    fetch: fetchImpl,
    URL,
    Promise,
    Response: FakeResponse,
    console
  });

  const fetchHandler = listeners.get('fetch');
  if (!fetchHandler) throw new Error('Service worker fetch handler was not registered');

  return {
    caches,
    async dispatch(request) {
      /** @type {Promise<FakeResponse> | null} */
      let responsePromise = null;
      /** @type {Promise<unknown>[]} */
      const pending = [];
      fetchHandler({
        request,
        /** @param {Promise<FakeResponse> | FakeResponse} value */
        respondWith(value) {
          responsePromise = Promise.resolve(value);
        },
        /** @param {Promise<unknown>} value */
        waitUntil(value) {
          pending.push(Promise.resolve(value));
        }
      });

      if (!responsePromise) throw new Error('Fetch handler did not call respondWith');
      const response = await responsePromise;
      await Promise.all(pending);
      return response;
    }
  };
}

/**
 * @param {string} path
 * @param {string} [mode]
 * @returns {FakeRequest}
 */
function request(path, mode = 'navigate') {
  return { method: 'GET', url: `${ORIGIN}${path}`, mode };
}

let passed = 0;

/** @param {boolean} condition @param {string} message */
function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✅ PASS: ${message}`);
  passed++;
}

{
  const harness = await createHarness(async () => {
    throw new Error('offline');
  });
  const cache = await harness.caches.open(CACHE_NAME);
  await cache.put(`${ORIGIN}/`, new FakeResponse('cached-home'));

  const response = await harness.dispatch(request('/?c=NEVER_OPENED_TOKEN'));
  assert(response.body === 'cached-home', 'Offline shared navigation reuses cached home page');
}

{
  const harness = await createHarness(
    async (incoming) => new FakeResponse(`network:${incoming.url}`)
  );
  await harness.dispatch(request('/?c=TOKEN_A'));
  await harness.dispatch(request('/?c=TOKEN_B'));
  await harness.dispatch(request('/?c=TOKEN_C'));

  const cache = await harness.caches.open(CACHE_NAME);
  assert(cache.entries.size === 1, 'Different share tokens reuse one navigation cache entry');
  assert(cache.entries.has(`${ORIGIN}/`), 'Navigation cache key omits the query string');
}

{
  const harness = await createHarness(
    async (incoming) => new FakeResponse(`network:${incoming.url}`)
  );
  await harness.dispatch(request('/scripts/main.js?v=1', 'same-origin'));
  await harness.dispatch(request('/scripts/main.js?v=2', 'same-origin'));

  const cache = await harness.caches.open(CACHE_NAME);
  assert(cache.entries.size === 2, 'Non-navigation asset query strings remain distinct');
  assert(cache.entries.has(`${ORIGIN}/scripts/main.js?v=1`), 'First asset query is preserved');
  assert(cache.entries.has(`${ORIGIN}/scripts/main.js?v=2`), 'Second asset query is preserved');
}

{
  let fetchCalls = 0;
  const harness = await createHarness(
    async (incoming) => {
      fetchCalls++;
      return new FakeResponse(`network:${incoming.url}`);
    },
    { failCacheOpen: true }
  );

  const response = await harness.dispatch(request('/?c=CACHE_UNAVAILABLE'));
  assert(
    response.body === `network:${ORIGIN}/?c=CACHE_UNAVAILABLE` && fetchCalls === 1,
    'Cache open failure does not block a successful network response'
  );
}

{
  const harness = await createHarness(
    async () => {
      throw new Error('offline');
    },
    { failCacheOpen: true }
  );

  const response = await harness.dispatch(request('/?c=NO_CACHE_OR_NETWORK'));
  assert(
    response.ok === false,
    'Cache and network failure returns an error response without rejecting respondWith'
  );
}

console.log(`\nService worker tests: ${passed} passed`);
