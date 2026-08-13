// @ts-check
import { DailyChallengeStore, MAX_EVENTS_PER_CHALLENGE } from '../core/daily-challenge-store.js';
import {
  createDailyChallenge,
  decodeDailyShare,
  encodeDailyShare
} from '../core/daily-challenge.js';
import { SeededRandom, gameplayRng, rng, visualRng } from '../core/random.js';
import { ScoreManager } from '../core/score-manager.js';

const DAY_ZERO_UTC = Date.UTC(2020, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;
const SHARE_PEPPER = 'serpentos-bug-buster-daily-share-v1';
const MASK_DOMAIN = 'bug-snake/share/mask/v1';
const HMAC_DOMAIN = 'bug-snake/share/hmac/v1';
const encoder = new TextEncoder();

/** @returns {Promise<void>} */
async function runDailyChallengeTests() {
  console.log('--- Running Daily Challenge Tests ---');
  let passed = 0;
  let failed = 0;
  /**
   * @param {boolean} condition
   * @param {string} message
   * @returns {void}
   */
  const assert = (condition, message) => {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  };

  const first = createDailyChallenge('2026-08-10');
  const second = createDailyChallenge('2026-08-10');
  const nextDay = createDailyChallenge('2026-08-11');
  assert(
    JSON.stringify(first) === JSON.stringify(second),
    'Same date produces identical challenge'
  );
  assert(first.seed !== nextDay.seed, 'Different dates produce different gameplay seeds');
  assert(first.challengeId === 'daily-v1-2026-08-10', 'Challenge ID includes version and date');

  assert(rng === gameplayRng, 'Legacy rng export aliases gameplay RNG');
  gameplayRng.setSeed('daily-test-gameplay');
  const expectedGameplay = new SeededRandom('daily-test-gameplay');
  visualRng.setSeed('daily-test-visual');
  visualRng.next();
  visualRng.next();
  assert(
    gameplayRng.next() === expectedGameplay.next(),
    'Visual RNG consumption does not change gameplay RNG sequence'
  );

  const token = await encodeDailyShare('2026-08-10', 148);
  assert(token.length === 32, 'Share token is compact fixed-length Base64URL');
  const decoded = await decodeDailyShare(token);
  assert(decoded?.score === 148, 'Share token preserves score');
  assert(decoded?.challenge.dateKey === '2026-08-10', 'Share token preserves challenge date');

  const negativeToken = await encodeDailyShare('2026-08-10', -35);
  const negativeDecoded = await decodeDailyShare(negativeToken);
  assert(negativeDecoded?.score === -35, 'Share token preserves negative final scores');

  const changedTag = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
  assert((await decodeDailyShare(changedTag)) === null, 'Tampered share tag is rejected');
  const changedPayload = mutateTokenByte(token, 6);
  assert((await decodeDailyShare(changedPayload)) === null, 'Tampered share payload is rejected');
  assert(
    (await decodeDailyShare('not-a-valid-token')) === null,
    'Malformed share token is rejected'
  );

  const validDayIndex = Math.floor((Date.UTC(2026, 7, 10) - DAY_ZERO_UTC) / DAY_MS);
  const mismatchedVersion = await createPublicFormatShareToken(validDayIndex, 100, 2);
  assert(
    (await decodeDailyShare(mismatchedVersion)) === null,
    'Share token with a mismatched challenge version is rejected'
  );

  const unsupportedFutureDate = await createPublicFormatShareToken(0xffffff, 100, 1);
  assert(
    (await decodeDailyShare(unsupportedFutureDate)) === null,
    'Share token outside the supported four-digit year range is rejected'
  );

  const maxDateToken = await encodeDailyShare('9999-12-31', 1);
  assert(
    (await decodeDailyShare(maxDateToken))?.challenge.dateKey === '9999-12-31',
    'Maximum supported share date round-trips'
  );

  const { storage } = createMemoryStorage();
  const store = new DailyChallengeStore(storage);
  const stored = store.recordResult(first.challengeId, 100);
  store.recordResult(first.challengeId, 80);
  assert(stored.isNewBest, 'First result is a new daily best');
  assert(store.getRecord(first.challengeId).bestScore === 100, 'Daily best does not regress');
  assert(store.getRecord(first.challengeId).attempts === 2, 'Daily attempts increment');
  assert(
    !new DailyChallengeStore(createMemoryStorage().storage).recordResult(first.challengeId, 0)
      .isNewBest,
    'A zero score does not claim a new daily best over the zero baseline'
  );

  const storeA = new DailyChallengeStore(storage);
  const storeB = new DailyChallengeStore(storage);
  storeA.recordResult(nextDay.challengeId, 25);
  storeB.recordResult(nextDay.challengeId, 60);
  storeA.recordResult(nextDay.challengeId, 40);
  const mergedRecord = storeB.getRecord(nextDay.challengeId);
  assert(mergedRecord.attempts === 3, 'Separate tabs preserve every recorded attempt');
  assert(mergedRecord.bestScore === 60, 'Separate tabs preserve the highest daily score');

  const concurrent = createMemoryStorage();
  let injectedConcurrentBest = false;
  const hookedStorage = wrapStorageWithSetHook(concurrent.storage, () => {
    if (injectedConcurrentBest) return;
    injectedConcurrentBest = true;
    concurrent.storage.setItem(
      `bugbuster_daily_result_v1:${first.challengeId}:concurrent-higher`,
      JSON.stringify({ score: 500, playedAt: new Date().toISOString() })
    );
  });
  const concurrentResult = new DailyChallengeStore(hookedStorage).recordResult(
    first.challengeId,
    250
  );
  assert(
    concurrentResult.record.bestScore === 500,
    'Result recording observes a concurrently written higher score'
  );
  assert(
    !concurrentResult.isNewBest,
    'A lower concurrent result does not claim the daily-best announcement'
  );

  const fallbackStore = new DailyChallengeStore(null);
  fallbackStore.recordResult(first.challengeId, -20);
  fallbackStore.recordResult(first.challengeId, -10);
  const fallbackRecord = fallbackStore.getRecord(first.challengeId);
  assert(fallbackRecord.attempts === 2, 'Unavailable storage keeps same-session attempts');
  assert(
    fallbackRecord.bestScore === 0,
    'Unavailable storage keeps a zero baseline when every attempt is negative'
  );

  const negativeBestManager = new ScoreManager();
  negativeBestManager.setHighScoreOverride(fallbackRecord.bestScore);
  assert(
    negativeBestManager.highScore === 0,
    'A negative first completion never becomes the visible daily best score'
  );

  const throwingStore = new DailyChallengeStore(createThrowingStorage());
  throwingStore.recordResult(first.challengeId, 12);
  throwingStore.recordResult(first.challengeId, 18);
  const throwingRecord = throwingStore.getRecord(first.challengeId);
  assert(throwingRecord.attempts === 2, 'Failing storage keeps same-session attempts');
  assert(throwingRecord.bestScore === 18, 'Failing storage keeps same-session best score');

  const retention = createMemoryStorage();
  const retentionStore = new DailyChallengeStore(retention.storage);
  for (let day = 1; day <= 31; day++) {
    const dateKey = `2026-07-${String(day).padStart(2, '0')}`;
    retentionStore.recordResult(createDailyChallenge(dateKey).challengeId, day);
  }
  const retainedOldChallenge = createDailyChallenge('2020-01-01').challengeId;
  retentionStore.recordResult(retainedOldChallenge, 7);
  assert(
    retentionStore.getRecord(retainedOldChallenge).attempts === 1,
    'Retention always keeps the challenge that was just recorded'
  );
  assert(retention.backing.size === 31, 'Retention bounds the number of stored challenge days');

  const futureDatedRetention = createMemoryStorage();
  for (let index = 0; index < 31; index++) {
    const dateKey = `2026-05-${String(index + 1).padStart(2, '0')}`;
    const challengeId = createDailyChallenge(dateKey).challengeId;
    futureDatedRetention.storage.setItem(
      `bugbuster_daily_result_v1:${challengeId}:future-${index}`,
      JSON.stringify({
        score: index,
        playedAt: `2099-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
      })
    );
  }
  const rollbackChallenge = createDailyChallenge('2020-03-01').challengeId;
  const rollbackRecord = new DailyChallengeStore(futureDatedRetention.storage).recordResult(
    rollbackChallenge,
    888
  ).record;
  assert(
    rollbackRecord.bestScore === 888 && rollbackRecord.attempts === 1,
    'Future-dated retained events do not trim a result after a clock rollback'
  );
  assert(
    futureDatedRetention.backing.size === 31,
    'Clock-rollback recovery keeps the retention journal bounded'
  );

  const bounded = createMemoryStorage();
  const boundedStore = new DailyChallengeStore(bounded.storage);
  boundedStore.recordResult(first.challengeId, 1000);
  for (let attempt = 0; attempt < MAX_EVENTS_PER_CHALLENGE + 20; attempt++) {
    boundedStore.recordResult(first.challengeId, attempt);
  }
  const boundedRecord = boundedStore.getRecord(first.challengeId);
  const boundedEventCount = [...bounded.backing.keys()].filter((key) =>
    key.startsWith('bugbuster_daily_result_v1:')
  ).length;
  assert(
    boundedEventCount === MAX_EVENTS_PER_CHALLENGE,
    'Per-day attempt events are capped in persistent storage'
  );
  assert(
    boundedRecord.attempts === MAX_EVENTS_PER_CHALLENGE && boundedRecord.attemptsCapped,
    'Attempt totals disclose that retained history is capped'
  );
  assert(
    bounded.backing.has(`bugbuster_daily_attempts_capped_v1:${first.challengeId}`),
    'A compact marker preserves the capped-attempt state'
  );
  assert(boundedRecord.bestScore === 1000, 'Attempt pruning always preserves the daily best');

  const crossTabPruning = createMemoryStorage();
  const pruningStoreA = new DailyChallengeStore(crossTabPruning.storage);
  const pruningStoreB = new DailyChallengeStore(crossTabPruning.storage);
  pruningStoreA.recordResult(first.challengeId, -100);
  for (let attempt = 0; attempt < MAX_EVENTS_PER_CHALLENGE + 20; attempt++) {
    pruningStoreB.recordResult(first.challengeId, attempt);
  }
  const recordAfterOtherTabPruned = pruningStoreA.getRecord(first.challengeId);
  assert(
    recordAfterOtherTabPruned.attempts === MAX_EVENTS_PER_CHALLENGE,
    'A tab does not resurrect successfully persisted events pruned by another tab'
  );
  assert(
    recordAfterOtherTabPruned.bestScore === MAX_EVENTS_PER_CHALLENGE + 19,
    'Cross-tab pruning keeps the latest shared daily best'
  );

  const retentionRace = createMemoryStorage();
  for (let index = 0; index < 31; index++) {
    const challengeId = createDailyChallenge(
      `2026-07-${String(index + 1).padStart(2, '0')}`
    ).challengeId;
    retentionRace.storage.setItem(
      `bugbuster_daily_result_v1:${challengeId}:baseline-${index}`,
      JSON.stringify({
        score: index,
        playedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
      })
    );
  }
  const concurrentlyPlayedA = createDailyChallenge('2020-01-01').challengeId;
  const concurrentlyPlayedB = createDailyChallenge('2020-01-02').challengeId;
  retentionRace.storage.setItem(
    `bugbuster_daily_result_v1:${concurrentlyPlayedA}:fresh-a`,
    JSON.stringify({ score: 501, playedAt: '2026-08-10T10:00:00.000Z' })
  );
  retentionRace.storage.setItem(
    `bugbuster_daily_result_v1:${concurrentlyPlayedB}:fresh-b`,
    JSON.stringify({ score: 502, playedAt: '2026-08-10T10:00:01.000Z' })
  );
  const retentionStoreA = new DailyChallengeStore(retentionRace.storage);
  const retentionStoreB = new DailyChallengeStore(retentionRace.storage);
  retentionStoreA._trim();
  retentionStoreB._trim();
  assert(
    retentionStoreA.getRecord(concurrentlyPlayedA).bestScore === 501 &&
      retentionStoreB.getRecord(concurrentlyPlayedB).bestScore === 502,
    'Deterministic cleanup keeps fresh completions from both tabs at the retention boundary'
  );

  const quotaStorage = createLimitedStorage(32);
  for (let index = 0; index < 32; index++) {
    const date = new Date(Date.UTC(2026, 0, index + 1));
    const dateKey = date.toISOString().slice(0, 10);
    const challengeId = createDailyChallenge(dateKey).challengeId;
    quotaStorage.backing.set(
      `bugbuster_daily_result_v1:${challengeId}:quota-${index}`,
      JSON.stringify({ score: index, playedAt: `${dateKey}T00:00:00.000Z` })
    );
  }
  const quotaChallenge = createDailyChallenge('2020-02-01').challengeId;
  const quotaRecord = new DailyChallengeStore(quotaStorage.storage).recordResult(
    quotaChallenge,
    777
  );
  assert(
    quotaRecord.record.bestScore === 777,
    'Quota recovery prunes only old daily entries and retries the new result'
  );

  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const scoreStorage = createMemoryStorage().storage;
  scoreStorage.setItem('bugbuster_highscore_classic', '42');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: scoreStorage
  });
  try {
    const scoreManager = new ScoreManager();
    scoreManager.setHighScoreOverride(-5);
    scoreManager.reset('classic');
    scoreManager.add(30);
    assert(scoreManager.checkHighScore(), 'Temporary high-score override can be beaten');
    assert(scoreManager.highScore === 30, 'Temporary high-score override updates in memory');
    scoreManager.clearHighScoreOverride();
    assert(
      scoreManager.highScore === 42,
      'Clearing an override restores the persistent mode high score'
    );
  } finally {
    if (localStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  }

  console.log(`\nDaily challenge tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} daily challenge tests failed`);
}

/** @returns {{storage: Storage, backing: Map<string, string>}} */
function createMemoryStorage() {
  /** @type {Map<string, string>} */
  const backing = new Map();
  /** @type {Storage} */
  const storage = {
    get length() {
      return backing.size;
    },
    clear() {
      backing.clear();
    },
    key(index) {
      return Array.from(backing.keys())[index] ?? null;
    },
    getItem(key) {
      return backing.get(key) ?? null;
    },
    setItem(key, value) {
      backing.set(key, String(value));
    },
    removeItem(key) {
      backing.delete(key);
    }
  };
  return { storage, backing };
}

/**
 * @param {Storage} storage
 * @param {(key: string, value: string) => void} afterSet
 * @returns {Storage}
 */
function wrapStorageWithSetHook(storage, afterSet) {
  return {
    get length() {
      return storage.length;
    },
    clear() {
      storage.clear();
    },
    key(index) {
      return storage.key(index);
    },
    getItem(key) {
      return storage.getItem(key);
    },
    setItem(key, value) {
      storage.setItem(key, value);
      afterSet(key, value);
    },
    removeItem(key) {
      storage.removeItem(key);
    }
  };
}

/** @param {number} maxItems */
function createLimitedStorage(maxItems) {
  const backing = new Map();
  /** @type {Storage} */
  const storage = {
    get length() {
      return backing.size;
    },
    clear() {
      backing.clear();
    },
    key(index) {
      return Array.from(backing.keys())[index] ?? null;
    },
    getItem(key) {
      return backing.get(key) ?? null;
    },
    setItem(key, value) {
      if (!backing.has(key) && backing.size >= maxItems) {
        const error = new Error('quota exceeded');
        error.name = 'QuotaExceededError';
        throw error;
      }
      backing.set(key, String(value));
    },
    removeItem(key) {
      backing.delete(key);
    }
  };
  return { storage, backing };
}

/** @returns {Storage} */
function createThrowingStorage() {
  /** @returns {never} */
  const unavailable = () => {
    throw new Error('storage unavailable');
  };

  return {
    get length() {
      return unavailable();
    },
    clear() {
      unavailable();
    },
    key() {
      return unavailable();
    },
    getItem() {
      return unavailable();
    },
    setItem() {
      unavailable();
    },
    removeItem() {
      unavailable();
    }
  };
}

/**
 * Flip a byte in a compact Base64URL token without recomputing its HMAC.
 * @param {string} token
 * @param {number} byteIndex
 * @returns {string}
 */
function mutateTokenByte(token, byteIndex) {
  const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  bytes[byteIndex] ^= 1;

  let changed = '';
  for (const byte of bytes) changed += String.fromCharCode(byte);
  return btoa(changed).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Create a format-valid token with intentionally unsupported fields. The key
 * derivation is public client code, so this helper also documents that these
 * tokens are not proof of an authentic score.
 * @param {number} dayIndex
 * @param {number} score
 * @param {number} challengeVersion
 * @returns {Promise<string>}
 */
async function createPublicFormatShareToken(dayIndex, score, challengeVersion) {
  const nonce = 0x1234;
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  bytes[0] = 1;
  bytes[1] = (dayIndex >>> 16) & 0xff;
  bytes[2] = (dayIndex >>> 8) & 0xff;
  bytes[3] = dayIndex & 0xff;
  view.setUint16(4, nonce, false);

  const date = new Date(DAY_ZERO_UTC + dayIndex * DAY_MS);
  const dateKey = `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(
    date.getUTCMonth() + 1
  ).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

  const payload = new Uint8Array(6);
  new DataView(payload.buffer).setInt32(0, score, false);
  payload[4] = challengeVersion;
  payload[5] = 0;

  const maskMaterial = encoder.encode(`${MASK_DOMAIN}|${dateKey}|${nonce}|${SHARE_PEPPER}`);
  const mask = new Uint8Array(await crypto.subtle.digest('SHA-256', maskMaterial));
  for (let index = 0; index < payload.length; index++) {
    bytes[6 + index] = payload[index] ^ mask[index];
  }

  const keyMaterial = encoder.encode(`${HMAC_DOMAIN}|${dateKey}|${nonce}|${SHARE_PEPPER}`);
  const keyDigest = await crypto.subtle.digest('SHA-256', keyMaterial);
  const key = await crypto.subtle.importKey(
    'raw',
    keyDigest,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const message = new ArrayBuffer(12);
  new Uint8Array(message).set(bytes.subarray(0, 12));
  const tag = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  bytes.set(tag.subarray(0, 12), 12);

  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

await runDailyChallengeTests();
