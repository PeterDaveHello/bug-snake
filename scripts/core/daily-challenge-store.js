// @ts-check

const STORAGE_PREFIX = 'bugbuster_daily_result_v1:';
const ATTEMPTS_CAPPED_PREFIX = 'bugbuster_daily_attempts_capped_v1:';
const MAX_RECORDS = 31;
export const MAX_EVENTS_PER_CHALLENGE = 128;
const MAX_PLAYED_AT_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
const MIN_SCORE = -0x80000000;
const MAX_SCORE = 0x7fffffff;
const CHALLENGE_ID_PATTERN = /^daily-v1-\d{4}-\d{2}-\d{2}$/;
const CANONICAL_PLAYED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
let fallbackEventCounter = 0;

/**
 * @typedef {Object} DailyRecord
 * @property {number} bestScore
 * @property {number} attempts
 * @property {boolean} attemptsCapped
 * @property {string} lastPlayedAt
 */

/** @typedef {{challengeId: string, score: number, playedAt: string}} DailyResultEvent */
/** @typedef {{events: Map<string, DailyResultEvent>, cappedChallengeIds: Set<string>}} DailySnapshot */
/** @typedef {{challengeId: string, entries: Array<[string, DailyResultEvent]>}} DailyEventGroup */
/**
 * @typedef {Object} RetentionPlan
 * @property {Set<string>} retainedEventKeys
 * @property {Set<string>} retainedChallengeIds
 * @property {Set<string>} newlyCappedChallengeIds
 */

export class DailyChallengeStore {
  /** @param {Storage | null} [storage] */
  constructor(storage = getDefaultStorage()) {
    this.storage = storage;
    /** @type {Map<string, DailyResultEvent>} */
    this.memoryEvents = new Map();
    /** @type {Set<string>} */
    this.memoryCappedChallengeIds = new Set();
  }

  /** @param {string} challengeId @returns {DailyRecord} */
  getRecord(challengeId) {
    if (!CHALLENGE_ID_PATTERN.test(challengeId)) return emptyRecord();
    const snapshot = this._readSnapshot();
    return aggregateRecord(
      snapshot.events,
      challengeId,
      snapshot.cappedChallengeIds.has(challengeId)
    );
  }

  /**
   * Persist each attempt under a unique key. This append-only layout prevents
   * two tabs from overwriting one another during a read-modify-write race.
   *
   * @param {string} challengeId
   * @param {number} score
   * @returns {{record: DailyRecord, isNewBest: boolean}}
   */
  recordResult(challengeId, score) {
    if (!CHALLENGE_ID_PATTERN.test(challengeId)) {
      return { record: emptyRecord(), isNewBest: false };
    }

    const before = this._readSnapshot();
    const previous = aggregateRecord(
      before.events,
      challengeId,
      before.cappedChallengeIds.has(challengeId)
    );
    const result = {
      challengeId,
      score: normalizeScore(score),
      playedAt: createPlayedAt(before.events)
    };
    const key = `${STORAGE_PREFIX}${challengeId}:${createEventId()}`;

    const persisted = this._writeEvent(key, result);
    if (persisted) {
      this._trim();
    } else {
      this.memoryEvents.set(key, result);
      this._trimMemoryEvents();
    }

    const after = this._readSnapshot();
    const record = aggregateRecord(
      after.events,
      challengeId,
      after.cappedChallengeIds.has(challengeId)
    );
    return {
      record,
      isNewBest: result.score > previous.bestScore && result.score === record.bestScore
    };
  }

  /** @returns {DailySnapshot} */
  _readSnapshot() {
    const events = new Map(this.memoryEvents);
    const cappedChallengeIds = new Set(this.memoryCappedChallengeIds);
    if (!this.storage) return { events, cappedChallengeIds };

    try {
      /** @type {string[]} */
      const keys = [];
      for (let index = 0; index < this.storage.length; index++) {
        const key = this.storage.key(index);
        if (key) keys.push(key);
      }

      for (const key of keys) {
        if (key.startsWith(STORAGE_PREFIX)) {
          const raw = this.storage.getItem(key);
          const event = sanitizeEvent(key, raw);
          if (event) events.set(key, event);
          continue;
        }

        const cappedChallengeId = cappedChallengeIdFromKey(key);
        if (cappedChallengeId) cappedChallengeIds.add(cappedChallengeId);
      }
    } catch {
      // Keep the in-memory journal so the feature remains usable this session.
    }
    return { events, cappedChallengeIds };
  }

  /**
   * @param {string} key
   * @param {DailyResultEvent} event
   * @returns {boolean}
   */
  _writeEvent(key, event) {
    if (!this.storage) return false;
    const value = JSON.stringify({ score: event.score, playedAt: event.playedAt });

    try {
      this.storage.setItem(key, value);
      return true;
    } catch (error) {
      if (!isQuotaExceededError(error)) return false;
    }

    // First remove only data already outside normal retention bounds.
    this._trim();
    try {
      this.storage.setItem(key, value);
      return true;
    } catch (error) {
      if (!isQuotaExceededError(error)) return false;
    }

    // A journal can be exactly at its legal 31-day / 128-event boundary and
    // still have no free quota. In that case reserve one durable slot from
    // this feature's own oldest data, never from unrelated localStorage keys.
    if (!this._reclaimQuotaSpace(event.challengeId)) return false;
    try {
      this.storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {string} challengeId
   * @returns {boolean}
   */
  _reclaimQuotaSpace(challengeId) {
    const persistedEvents = this._readPersistedEvents();
    const groups = createSortedEventGroups(persistedEvents);
    const currentGroup = groups.find((group) => group.challengeId === challengeId);

    if (!currentGroup) {
      if (groups.length < MAX_RECORDS) return false;
      const oldestGroup = groups[groups.length - 1];
      let removedAny = false;
      for (const [key] of oldestGroup.entries) {
        removedAny = this._removePersistedEvent(key) || removedAny;
      }
      if (!removedAny || this._hasPersistedChallengeEvents(oldestGroup.challengeId)) return false;
      this._removeAttemptsCappedMarkerIfUnused(oldestGroup.challengeId);
      return true;
    }

    const markerPersisted = this._hasPersistedAttemptsCappedMarker(challengeId);
    if (currentGroup.entries.length < MAX_EVENTS_PER_CHALLENGE && !markerPersisted) return false;

    let bestEntry = currentGroup.entries[0];
    for (const candidate of currentGroup.entries) {
      if (candidate[1].score > bestEntry[1].score) bestEntry = candidate;
    }

    // If this day was already capped, the marker already owns its storage slot
    // and only one event needs to be replaced. Otherwise reserve a second slot
    // for the durable capped-history marker before retrying the pending event.
    const requiredRemovals = markerPersisted ? 1 : 2;
    let removedCount = 0;
    for (let index = currentGroup.entries.length - 1; index >= 0; index--) {
      const [key] = currentGroup.entries[index];
      if (key === bestEntry[0]) continue;
      if (this._removePersistedEvent(key)) removedCount++;
      if (removedCount >= requiredRemovals) break;
    }
    if (removedCount < requiredRemovals) return false;

    return markerPersisted || this._markAttemptsCapped(challengeId);
  }

  /** @returns {Map<string, DailyResultEvent>} */
  _readPersistedEvents() {
    /** @type {Map<string, DailyResultEvent>} */
    const events = new Map();
    if (!this.storage) return events;

    try {
      /** @type {string[]} */
      const keys = [];
      for (let index = 0; index < this.storage.length; index++) {
        const key = this.storage.key(index);
        if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
      }
      for (const key of keys) {
        const event = sanitizeEvent(key, this.storage.getItem(key));
        if (event) events.set(key, event);
      }
    } catch {
      // Quota recovery is best-effort; the normal memory fallback remains safe.
    }
    return events;
  }

  /** @param {string} key @returns {boolean} */
  _removePersistedEvent(key) {
    if (!this.storage) return false;
    try {
      if (this.storage.getItem(key) === null) return false;
      this.storage.removeItem(key);
      this.memoryEvents.delete(key);
      return true;
    } catch {
      return false;
    }
  }

  /** @param {string} challengeId @returns {boolean} */
  _hasPersistedChallengeEvents(challengeId) {
    if (!this.storage) return false;
    try {
      for (let index = 0; index < this.storage.length; index++) {
        const key = this.storage.key(index);
        if (key && challengeIdFromKey(key) === challengeId) return true;
      }
      return false;
    } catch {
      // Do not claim a destructive cleanup succeeded if storage cannot be checked.
      return true;
    }
  }

  /** @param {string} challengeId @returns {boolean} */
  _hasPersistedAttemptsCappedMarker(challengeId) {
    if (!this.storage) return false;
    try {
      return this.storage.getItem(`${ATTEMPTS_CAPPED_PREFIX}${challengeId}`) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Retain the most recently played challenge IDs and cap each day to a bounded
   * number of immutable attempt events. Ranking by playedAt makes every tab
   * derive the same retention set, even when the challenge dates are old.
   *
   * A key written after the snapshot is taken is absent from the deletion loop,
   * while a key visible to multiple tabs receives the same deterministic keep
   * decision. This prevents one tab from deleting another tab's fresh result at
   * the 31-day boundary.
   */
  _trim() {
    const persistedEvents = this._readPersistedEvents();
    const persistedCappedChallengeIds = this._readPersistedCappedChallengeIds();
    const plan = createRetentionPlan(persistedEvents);

    for (const [key] of persistedEvents) {
      if (plan.retainedEventKeys.has(key)) continue;
      this.memoryEvents.delete(key);
      if (!this.storage) continue;
      try {
        this.storage.removeItem(key);
      } catch {
        // Retention cleanup is best-effort and must not break daily play.
      }
    }

    for (const challengeId of plan.newlyCappedChallengeIds) {
      this._markAttemptsCapped(challengeId);
    }

    const knownCappedChallengeIds = new Set([
      ...persistedCappedChallengeIds,
      ...plan.newlyCappedChallengeIds
    ]);
    for (const challengeId of knownCappedChallengeIds) {
      if (!plan.retainedChallengeIds.has(challengeId)) {
        this._removeAttemptsCappedMarkerIfUnused(challengeId);
      }
    }
    this._trimMemoryEvents();
  }

  _trimMemoryEvents() {
    const plan = createRetentionPlan(this.memoryEvents);
    for (const [key] of this.memoryEvents) {
      if (!plan.retainedEventKeys.has(key)) this.memoryEvents.delete(key);
    }
    for (const challengeId of plan.newlyCappedChallengeIds) {
      this.memoryCappedChallengeIds.add(challengeId);
    }
    for (const challengeId of [...this.memoryCappedChallengeIds]) {
      if (!plan.retainedChallengeIds.has(challengeId)) {
        this.memoryCappedChallengeIds.delete(challengeId);
      }
    }

    const persistedEvents = this._readPersistedEvents();
    const persistedCappedChallengeIds = this._readPersistedCappedChallengeIds();
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const event of persistedEvents.values()) {
      counts.set(event.challengeId, (counts.get(event.challengeId) || 0) + 1);
    }
    for (const event of this.memoryEvents.values()) {
      counts.set(event.challengeId, (counts.get(event.challengeId) || 0) + 1);
    }
    for (const event of this.memoryEvents.values()) {
      if (
        persistedCappedChallengeIds.has(event.challengeId) ||
        (counts.get(event.challengeId) || 0) > MAX_EVENTS_PER_CHALLENGE
      ) {
        this.memoryCappedChallengeIds.add(event.challengeId);
      }
    }
  }

  /** @returns {Set<string>} */
  _readPersistedCappedChallengeIds() {
    /** @type {Set<string>} */
    const challengeIds = new Set();
    if (!this.storage) return challengeIds;
    try {
      for (let index = 0; index < this.storage.length; index++) {
        const key = this.storage.key(index);
        if (!key) continue;
        const challengeId = cappedChallengeIdFromKey(key);
        if (challengeId) challengeIds.add(challengeId);
      }
    } catch {
      // Retention remains best-effort when storage cannot be enumerated.
    }
    return challengeIds;
  }

  /** @param {string} challengeId */
  _removeAttemptsCappedMarkerIfUnused(challengeId) {
    if (this._hasCurrentChallengeEvents(challengeId)) return;
    this._removeAttemptsCappedMarker(challengeId);

    if (this._hasCurrentChallengeEvents(challengeId)) {
      this._markAttemptsCapped(challengeId);
    }
  }

  /** @param {string} challengeId @returns {boolean} */
  _hasCurrentChallengeEvents(challengeId) {
    for (const event of this.memoryEvents.values()) {
      if (event.challengeId === challengeId) return true;
    }
    if (!this.storage) return false;

    try {
      for (let index = 0; index < this.storage.length; index++) {
        const key = this.storage.key(index);
        if (key && challengeIdFromKey(key) === challengeId) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  /** @param {string} challengeId @returns {boolean} */
  _markAttemptsCapped(challengeId) {
    if (!this.storage) {
      this.memoryCappedChallengeIds.add(challengeId);
      return false;
    }

    try {
      this.storage.setItem(`${ATTEMPTS_CAPPED_PREFIX}${challengeId}`, '1');
      this.memoryCappedChallengeIds.delete(challengeId);
      return true;
    } catch {
      this.memoryCappedChallengeIds.add(challengeId);
      return false;
    }
  }

  /** @param {string} challengeId */
  _removeAttemptsCappedMarker(challengeId) {
    this.memoryCappedChallengeIds.delete(challengeId);
    if (!this.storage) return;
    try {
      this.storage.removeItem(`${ATTEMPTS_CAPPED_PREFIX}${challengeId}`);
    } catch {
      // Retention cleanup is best-effort and must not break daily play.
    }
  }
}

/**
 * @param {Map<string, DailyResultEvent>} events
 * @returns {DailyEventGroup[]}
 */
function createSortedEventGroups(events) {
  /** @type {Map<string, Array<[string, DailyResultEvent]>>} */
  const groupedEvents = new Map();
  for (const entry of events.entries()) {
    const challengeId = entry[1].challengeId;
    const group = groupedEvents.get(challengeId);
    if (group) group.push(entry);
    else groupedEvents.set(challengeId, [entry]);
  }

  const groups = [...groupedEvents.entries()].map(([challengeId, entries]) => {
    entries.sort(compareEventsNewestFirst);
    return { challengeId, entries };
  });
  groups.sort((a, b) => {
    const latestOrder = compareEventsNewestFirst(a.entries[0], b.entries[0]);
    return latestOrder || compareCodeUnits(b.challengeId, a.challengeId);
  });
  return groups;
}

/**
 * @param {Map<string, DailyResultEvent>} events
 * @returns {RetentionPlan}
 */
function createRetentionPlan(events) {
  const groups = createSortedEventGroups(events);
  const retainedGroups = groups.slice(0, MAX_RECORDS);
  const retainedChallengeIds = new Set(retainedGroups.map((group) => group.challengeId));
  /** @type {Set<string>} */
  const retainedEventKeys = new Set();
  /** @type {Set<string>} */
  const newlyCappedChallengeIds = new Set();

  for (const { challengeId, entries } of retainedGroups) {
    if (entries.length <= MAX_EVENTS_PER_CHALLENGE) {
      for (const [key] of entries) retainedEventKeys.add(key);
      continue;
    }

    newlyCappedChallengeIds.add(challengeId);
    let bestEntry = entries[0];
    for (const candidate of entries) {
      if (candidate[1].score > bestEntry[1].score) bestEntry = candidate;
    }

    const keptForChallenge = new Set([bestEntry[0]]);
    for (const [key] of entries) {
      if (keptForChallenge.size >= MAX_EVENTS_PER_CHALLENGE) break;
      keptForChallenge.add(key);
    }
    for (const key of keptForChallenge) retainedEventKeys.add(key);
  }

  return { retainedEventKeys, retainedChallengeIds, newlyCappedChallengeIds };
}

/**
 * Locale-independent UTF-16 code-unit comparison. All retention keys and
 * playedAt values are canonical ASCII, so this produces one stable ordering in
 * every browser locale.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareCodeUnits(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * @param {[string, DailyResultEvent]} a
 * @param {[string, DailyResultEvent]} b
 * @returns {number}
 */
function compareEventsNewestFirst(a, b) {
  const dateOrder = compareCodeUnits(b[1].playedAt, a[1].playedAt);
  return dateOrder || compareCodeUnits(b[0], a[0]);
}

/** @returns {Storage | null} */
function getDefaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** @returns {DailyRecord} */
function emptyRecord() {
  return { bestScore: 0, attempts: 0, attemptsCapped: false, lastPlayedAt: '' };
}

/**
 * @param {Map<string, DailyResultEvent>} events
 * @param {string} challengeId
 * @param {boolean} attemptsCapped
 * @returns {DailyRecord}
 */
function aggregateRecord(events, challengeId, attemptsCapped) {
  let attempts = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  let lastPlayedAt = '';

  for (const event of events.values()) {
    if (event.challengeId !== challengeId) continue;
    attempts++;
    bestScore = Math.max(bestScore, event.score);
    if (event.playedAt > lastPlayedAt) lastPlayedAt = event.playedAt;
  }

  if (attempts === 0) return emptyRecord();
  return {
    bestScore: Math.max(0, bestScore),
    attempts: attemptsCapped ? MAX_EVENTS_PER_CHALLENGE : attempts,
    attemptsCapped,
    lastPlayedAt
  };
}

/** @param {string} key @param {string | null} raw @returns {DailyResultEvent | null} */
function sanitizeEvent(key, raw) {
  const challengeId = challengeIdFromKey(key);
  if (!challengeId || !raw) return null;

  try {
    const candidate = JSON.parse(raw);
    if (!candidate || typeof candidate !== 'object') return null;
    const item = /** @type {{score?: unknown, playedAt?: unknown}} */ (candidate);
    const playedAtMs = typeof item.playedAt === 'string' ? Date.parse(item.playedAt) : NaN;
    if (
      typeof item.score !== 'number' ||
      !Number.isSafeInteger(item.score) ||
      item.score < MIN_SCORE ||
      item.score > MAX_SCORE ||
      !Number.isFinite(playedAtMs) ||
      playedAtMs > MAX_PLAYED_AT_MS
    ) {
      return null;
    }

    const playedAt = new Date(playedAtMs).toISOString();
    if (!CANONICAL_PLAYED_AT_PATTERN.test(playedAt)) return null;
    return { challengeId, score: item.score, playedAt };
  } catch {
    return null;
  }
}

/** @param {string} key @returns {string | null} */
function challengeIdFromKey(key) {
  if (!key.startsWith(STORAGE_PREFIX)) return null;
  const suffix = key.slice(STORAGE_PREFIX.length);
  const separator = suffix.indexOf(':');
  if (separator <= 0) return null;
  const challengeId = suffix.slice(0, separator);
  return CHALLENGE_ID_PATTERN.test(challengeId) ? challengeId : null;
}

/** @param {string} key @returns {string | null} */
function cappedChallengeIdFromKey(key) {
  if (!key.startsWith(ATTEMPTS_CAPPED_PREFIX)) return null;
  const challengeId = key.slice(ATTEMPTS_CAPPED_PREFIX.length);
  return CHALLENGE_ID_PATTERN.test(challengeId) ? challengeId : null;
}

/** @param {Map<string, DailyResultEvent>} events @returns {string} */
function createPlayedAt(events) {
  const now = Math.min(Date.now(), MAX_PLAYED_AT_MS);
  let latest = 0;
  for (const event of events.values()) {
    const timestamp = Date.parse(event.playedAt);
    if (Number.isFinite(timestamp) && timestamp > latest) latest = timestamp;
  }
  return new Date(Math.min(MAX_PLAYED_AT_MS, Math.max(now, latest + 1))).toISOString();
}

/** @returns {string} */
function createEventId() {
  try {
    if (typeof crypto !== 'undefined') {
      if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      if (typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
      }
    }
  } catch {
    // Fall back to a per-tab counter below.
  }

  fallbackEventCounter = (fallbackEventCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now().toString(36)}-${fallbackEventCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

/** @param {unknown} error @returns {boolean} */
function isQuotaExceededError(error) {
  if (!error || typeof error !== 'object') return false;
  const candidate = /** @type {{name?: unknown, code?: unknown}} */ (error);
  return (
    candidate.name === 'QuotaExceededError' ||
    candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    candidate.code === 22 ||
    candidate.code === 1014
  );
}

/** @param {number} score @returns {number} */
function normalizeScore(score) {
  return Number.isSafeInteger(score) && score >= MIN_SCORE && score <= MAX_SCORE ? score : 0;
}
