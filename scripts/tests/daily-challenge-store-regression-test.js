// @ts-check
import { DailyChallengeStore, MAX_EVENTS_PER_CHALLENGE } from '../core/daily-challenge-store.js';
import { createDailyChallenge } from '../core/daily-challenge.js';

const STORAGE_PREFIX = 'bugbuster_daily_result_v1:';
const ATTEMPTS_CAPPED_PREFIX = 'bugbuster_daily_attempts_capped_v1:';

function runDailyStoreRegressionTests() {
  console.log('--- Running Daily Store Regression Tests ---');
  let passed = 0;
  let failed = 0;

  /** @param {boolean} condition @param {string} message @returns {void} */
  const assert = (condition, message) => {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  };

  const newDayQuota = createDailyEventLimitedStorage(31);
  for (let index = 0; index < 31; index++) {
    const date = new Date(Date.UTC(2026, 0, index + 1));
    const dateKey = date.toISOString().slice(0, 10);
    const challengeId = createDailyChallenge(dateKey).challengeId;
    newDayQuota.backing.set(
      `${STORAGE_PREFIX}${challengeId}:seed-${index}`,
      JSON.stringify({ score: index, playedAt: `${dateKey}T00:00:00.000Z` })
    );
  }

  const incomingChallenge = createDailyChallenge('2026-08-13').challengeId;
  const quotaResult = new DailyChallengeStore(newDayQuota.storage).recordResult(
    incomingChallenge,
    777
  );
  const reloadedQuotaRecord = new DailyChallengeStore(newDayQuota.storage).getRecord(
    incomingChallenge
  );
  const retainedChallengeIds = dailyChallengeIds(newDayQuota.backing);
  assert(
    quotaResult.record.bestScore === 777 && reloadedQuotaRecord.bestScore === 777,
    'Quota recovery persists a new challenge at the 31-day retention boundary'
  );
  assert(
    retainedChallengeIds.size === 31 &&
      retainedChallengeIds.has(incomingChallenge) &&
      !retainedChallengeIds.has(createDailyChallenge('2026-01-01').challengeId),
    'Quota recovery reserves the pending day by evicting the oldest retained daily group'
  );

  const sameDayQuota = createItemLimitedStorage(MAX_EVENTS_PER_CHALLENGE);
  const sameDayChallenge = createDailyChallenge('2026-08-12').challengeId;
  seedChallengeAttempts(sameDayQuota.backing, sameDayChallenge);
  const sameDayStore = new DailyChallengeStore(sameDayQuota.storage);
  sameDayStore.recordResult(sameDayChallenge, 999);
  let sameDayReload = new DailyChallengeStore(sameDayQuota.storage).getRecord(sameDayChallenge);
  assert(
    sameDayReload.bestScore === 999 && sameDayReload.attemptsCapped,
    'First same-day quota recovery preserves the new best and durable capped-history marker'
  );
  assert(
    sameDayQuota.backing.has(`${ATTEMPTS_CAPPED_PREFIX}${sameDayChallenge}`) &&
      sameDayQuota.backing.size <= MAX_EVENTS_PER_CHALLENGE,
    'First same-day quota recovery reserves space for both the pending event and marker'
  );

  sameDayStore.recordResult(sameDayChallenge, 1001);
  sameDayReload = new DailyChallengeStore(sameDayQuota.storage).getRecord(sameDayChallenge);
  assert(
    sameDayReload.bestScore === 1001 && sameDayReload.attemptsCapped,
    'Subsequent writes on an already capped day remain durable after reload'
  );
  assert(
    sameDayQuota.backing.size <= MAX_EVENTS_PER_CHALLENGE,
    'Repeated capped-day recovery replaces one old event instead of growing storage'
  );

  let rejectedFirstRemoval = false;
  const partialRemovalQuota = createItemLimitedStorage(
    MAX_EVENTS_PER_CHALLENGE,
    undefined,
    (key) => {
      if (!rejectedFirstRemoval && key.endsWith(':attempt-000')) {
        rejectedFirstRemoval = true;
        throw new Error('Simulated concurrent removal failure');
      }
    }
  );
  const partialChallenge = createDailyChallenge('2026-08-11').challengeId;
  seedChallengeAttempts(partialRemovalQuota.backing, partialChallenge);
  new DailyChallengeStore(partialRemovalQuota.storage).recordResult(partialChallenge, 2000);
  const partialReload = new DailyChallengeStore(partialRemovalQuota.storage).getRecord(
    partialChallenge
  );
  assert(
    rejectedFirstRemoval,
    'Quota recovery regression test exercises an individual deletion failure'
  );
  assert(
    partialReload.bestScore === 2000 && partialReload.attemptsCapped,
    'Quota recovery keeps scanning removable events after one deletion fails'
  );

  const unrelatedQuota = createItemLimitedStorage(31);
  for (let index = 0; index < 30; index++) {
    const dateKey = new Date(Date.UTC(2026, 2, index + 1)).toISOString().slice(0, 10);
    const challengeId = createDailyChallenge(dateKey).challengeId;
    unrelatedQuota.backing.set(
      `${STORAGE_PREFIX}${challengeId}:durable-${index}`,
      JSON.stringify({ score: index, playedAt: `${dateKey}T00:00:00.000Z` })
    );
  }
  unrelatedQuota.backing.set('unrelated-preference', 'keep-me');
  const fallbackChallenge = createDailyChallenge('2026-08-10').challengeId;
  const fallbackStore = new DailyChallengeStore(unrelatedQuota.storage);
  const fallbackRecord = fallbackStore.recordResult(fallbackChallenge, 555).record;
  assert(
    fallbackRecord.bestScore === 555,
    'Unreclaimable quota still keeps the result for this session'
  );
  assert(
    new DailyChallengeStore(unrelatedQuota.storage).getRecord(fallbackChallenge).attempts === 0 &&
      dailyChallengeIds(unrelatedQuota.backing).size === 30 &&
      unrelatedQuota.backing.get('unrelated-preference') === 'keep-me',
    'Quota fallback never deletes durable daily history or unrelated browser storage without a retention slot to reclaim'
  );

  const markerRaceBacking = new Map();
  const markerRaceChallenge = createDailyChallenge('2025-01-01').challengeId;
  markerRaceBacking.set(
    `${STORAGE_PREFIX}${markerRaceChallenge}:old-event`,
    JSON.stringify({ score: 10, playedAt: '2025-01-01T00:00:00.000Z' })
  );
  markerRaceBacking.set(`${ATTEMPTS_CAPPED_PREFIX}${markerRaceChallenge}`, '1');
  for (let index = 0; index < 31; index++) {
    const dateKey = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    const challengeId = createDailyChallenge(dateKey).challengeId;
    markerRaceBacking.set(
      `${STORAGE_PREFIX}${challengeId}:newer-${index}`,
      JSON.stringify({ score: index, playedAt: `${dateKey}T00:00:00.000Z` })
    );
  }

  let insertedConcurrentEvent = false;
  const markerRaceStorage = createStorage(markerRaceBacking, undefined, (key) => {
    if (!insertedConcurrentEvent && key === `${STORAGE_PREFIX}${markerRaceChallenge}:old-event`) {
      insertedConcurrentEvent = true;
      markerRaceBacking.set(
        `${STORAGE_PREFIX}${markerRaceChallenge}:concurrent-fresh`,
        JSON.stringify({ score: 999, playedAt: '2027-01-01T00:00:00.000Z' })
      );
    }
  });
  const markerRaceStore = new DailyChallengeStore(markerRaceStorage);
  markerRaceStore._trim();
  const markerRaceRecord = markerRaceStore.getRecord(markerRaceChallenge);
  assert(insertedConcurrentEvent, 'Retention test injects a concurrent fresh event');
  assert(
    markerRaceBacking.has(`${ATTEMPTS_CAPPED_PREFIX}${markerRaceChallenge}`) &&
      markerRaceRecord.bestScore === 999 &&
      markerRaceRecord.attemptsCapped,
    'Concurrent retention preserves the capped marker for a newly refreshed challenge'
  );

  const legacy = createMemoryStorage();
  const legacyChallenge = createDailyChallenge('2026-06-01').challengeId;
  legacy.backing.set(
    `${STORAGE_PREFIX}${legacyChallenge}:legacy`,
    JSON.stringify({ score: 12, playedAt: 'Jun 01 2026 10:00:00 GMT' })
  );
  const normalizedRecord = new DailyChallengeStore(legacy.storage).getRecord(legacyChallenge);
  assert(
    normalizedRecord.lastPlayedAt === '2026-06-01T10:00:00.000Z',
    'Parseable legacy timestamps are normalized to canonical ISO before aggregation'
  );

  const retention = createMemoryStorage();
  const misleadingLegacyChallenge = createDailyChallenge('2020-01-01').challengeId;
  retention.backing.set(
    `${STORAGE_PREFIX}${misleadingLegacyChallenge}:legacy-old`,
    JSON.stringify({ score: 1, playedAt: 'Jan 01 2025 00:00:00 GMT' })
  );
  for (let index = 0; index < 31; index++) {
    const challengeDate = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    const challengeId = createDailyChallenge(challengeDate).challengeId;
    const playedDate = new Date(Date.UTC(2026, 6, index + 1)).toISOString();
    retention.backing.set(
      `${STORAGE_PREFIX}${challengeId}:canonical-${index}`,
      JSON.stringify({ score: index, playedAt: playedDate })
    );
  }
  const retentionStore = new DailyChallengeStore(retention.storage);
  const originalLocaleCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = () => {
    throw new Error('Retention must not depend on localeCompare');
  };
  try {
    retentionStore._trim();
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
  assert(
    retentionStore.getRecord(misleadingLegacyChallenge).attempts === 0,
    'Retention ordering is canonical and locale-independent'
  );

  console.log(`\nDaily store regression tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} daily store regression tests failed`);
}

/**
 * @param {Map<string, string>} backing
 * @param {string} challengeId
 */
function seedChallengeAttempts(backing, challengeId) {
  for (let index = 0; index < MAX_EVENTS_PER_CHALLENGE; index++) {
    backing.set(
      `${STORAGE_PREFIX}${challengeId}:attempt-${String(index).padStart(3, '0')}`,
      JSON.stringify({
        score: index,
        playedAt: `2026-08-12T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(
          index % 60
        ).padStart(2, '0')}.000Z`
      })
    );
  }
}

/** @returns {{storage: Storage, backing: Map<string, string>}} */
function createMemoryStorage() {
  /** @type {Map<string, string>} */
  const backing = new Map();
  return { storage: createStorage(backing), backing };
}

/** @param {number} maxDailyEvents @returns {{storage: Storage, backing: Map<string, string>}} */
function createDailyEventLimitedStorage(maxDailyEvents) {
  /** @type {Map<string, string>} */
  const backing = new Map();
  const storage = createStorage(backing, (key) => {
    if (
      key.startsWith(STORAGE_PREFIX) &&
      !backing.has(key) &&
      countDailyEventKeys(backing) >= maxDailyEvents
    ) {
      throwQuotaError();
    }
  });
  return { storage, backing };
}

/**
 * @param {number} maxItems
 * @param {(key: string) => void} [beforeSet]
 * @param {(key: string) => void} [beforeRemove]
 * @returns {{storage: Storage, backing: Map<string, string>}}
 */
function createItemLimitedStorage(maxItems, beforeSet = undefined, beforeRemove = undefined) {
  /** @type {Map<string, string>} */
  const backing = new Map();
  const storage = createStorage(
    backing,
    (key) => {
      beforeSet?.(key);
      if (!backing.has(key) && backing.size >= maxItems) throwQuotaError();
    },
    beforeRemove
  );
  return { storage, backing };
}

/** @returns {never} */
function throwQuotaError() {
  const error = new Error('Storage quota reached');
  error.name = 'QuotaExceededError';
  throw error;
}

/**
 * @param {Map<string, string>} backing
 * @param {(key: string) => void} [beforeSet]
 * @param {(key: string) => void} [beforeRemove]
 * @returns {Storage}
 */
function createStorage(backing, beforeSet = undefined, beforeRemove = undefined) {
  return {
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
      beforeSet?.(key);
      backing.set(key, String(value));
    },
    removeItem(key) {
      beforeRemove?.(key);
      backing.delete(key);
    }
  };
}

/** @param {Map<string, string>} backing @returns {number} */
function countDailyEventKeys(backing) {
  return [...backing.keys()].filter((key) => key.startsWith(STORAGE_PREFIX)).length;
}

/** @param {Map<string, string>} backing @returns {Set<string>} */
function dailyChallengeIds(backing) {
  return new Set(
    [...backing.keys()]
      .filter((key) => key.startsWith(STORAGE_PREFIX))
      .map(challengeIdFromEventKey)
      .filter((value) => value !== null)
  );
}

/** @param {string} key @returns {string | null} */
function challengeIdFromEventKey(key) {
  if (!key.startsWith(STORAGE_PREFIX)) return null;
  const suffix = key.slice(STORAGE_PREFIX.length);
  const separator = suffix.indexOf(':');
  return separator > 0 ? suffix.slice(0, separator) : null;
}

runDailyStoreRegressionTests();
