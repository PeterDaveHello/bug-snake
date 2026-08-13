// @ts-check
import { ItemType, PoisonMode, SpeedMode } from './config.js';
import { createDailyV1Random } from './daily-v1-algorithm.js';

const CHALLENGE_VERSION = 1;
const SHARE_VERSION = 1;
const SHARE_BYTES = 24;
const SHARE_TAG_BYTES = 12;
const SHARE_PREFIX_BYTES = SHARE_BYTES - SHARE_TAG_BYTES;
const SHARE_PAYLOAD_OFFSET = 6;
const SHARE_PAYLOAD_BYTES = 6;
const MIN_SHARED_SCORE = -0x80000000;
const MAX_SHARED_SCORE = 0x7fffffff;
const DAY_ZERO_UTC = Date.UTC(2020, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAY_INDEX = Math.floor((Date.UTC(9999, 11, 31) - DAY_ZERO_UTC) / DAY_MS);

// This value is intentionally public. In a client-side open-source game it is
// diversification/obfuscation only, not a secret or a security boundary.
const SHARE_PEPPER = 'serpentos-bug-buster-daily-share-v1';
const MASK_DOMAIN = 'bug-snake/share/mask/v1';
const HMAC_DOMAIN = 'bug-snake/share/hmac/v1';
const RULES_DOMAIN = 'bug-snake/daily/rules/v1';
const GAMEPLAY_DOMAIN = 'bug-snake/daily/gameplay/v1';

// Daily-v1 rules are intentionally self-contained. Future tuning of the main
// game configuration must not reinterpret old shared links or historical days.
const DAILY_V1_MAP_TEMPLATES = Object.freeze(['cross_wall', 'pillars', 'maze_simple']);
const DAILY_V1_OBSTACLE_DENSITIES = Object.freeze([0.02, 0.03, 0.04, 0.05]);
const DAILY_V1_RULES = Object.freeze({
  mapSize: 24,
  wrapWalls: false,
  startLength: 3,
  speedMode: SpeedMode.SCORE,
  dangerEnabled: true,
  dangerSpawnRate: 5,
  dangerTimeoutSec: 15,
  poisonMode: PoisonMode.SHRINK
});
/**
 * @typedef {Object} DailyItemDefinition
 * @property {number} score
 * @property {number} length
 * @property {number} weight
 * @property {string} color
 * @property {number} [speedBoost]
 * @property {boolean} [isPoison]
 */

/**
 * @typedef {Object} DailyGameplayRules
 * @property {number} defaultSpeed
 * @property {number} maxSpeed
 * @property {number} minSpeed
 * @property {number} scoreSpeedStep
 * @property {number} scoreSpeedMax
 * @property {number} timeSpeedStep
 * @property {number} timeSpeedMax
 * @property {number} boostSpeedDelta
 * @property {number} manualBoostSpeedDelta
 * @property {number} inputGraceMs
 * @property {number} speedSmoothingMs
 * @property {number} poisonShrinkAmount
 */

/** @type {Readonly<DailyGameplayRules>} */
const DAILY_V1_GAMEPLAY_RULES = Object.freeze({
  defaultSpeed: 6,
  maxSpeed: 25,
  minSpeed: 5,
  scoreSpeedStep: 50,
  scoreSpeedMax: 20,
  timeSpeedStep: 15,
  timeSpeedMax: 20,
  boostSpeedDelta: 3,
  manualBoostSpeedDelta: 8,
  inputGraceMs: 0,
  // The normal-mode smoother advances from performance.now(). Daily-v1 keeps
  // speed transitions immediate so frame pacing cannot alter gameplay rules.
  speedSmoothingMs: 0,
  poisonShrinkAmount: 4
});

/** @type {Readonly<Record<string, Readonly<DailyItemDefinition>>>} */
const DAILY_V1_ITEM_DEFINITIONS = Object.freeze({
  [ItemType.ROACH]: Object.freeze({
    score: 10,
    length: 1,
    weight: 50,
    color: '#8B5A2B'
  }),
  [ItemType.ANT]: Object.freeze({
    score: 6,
    length: 1,
    weight: 30,
    color: '#FF3B30'
  }),
  [ItemType.MOSQUITO]: Object.freeze({
    score: 15,
    length: 1,
    speedBoost: 3,
    weight: 20,
    color: '#32ADE6'
  }),
  [ItemType.EGG]: Object.freeze({
    score: 8,
    length: 1,
    weight: 25,
    color: '#F5DEB3'
  }),
  [ItemType.MOUSE]: Object.freeze({
    score: 20,
    length: 2,
    weight: 8,
    color: '#808080'
  }),
  [ItemType.TRASH]: Object.freeze({
    score: -20,
    length: -2,
    weight: 80,
    color: '#A2845E'
  }),
  [ItemType.POISON]: Object.freeze({
    score: 0,
    length: 0,
    weight: 20,
    color: '#AF52DE',
    isPoison: true
  })
});

const encoder = new TextEncoder();

/**
 * @typedef {Object} DailyChallengeDescriptor
 * @property {number} version
 * @property {number} algorithmVersion
 * @property {string} challengeId
 * @property {string} dateKey
 * @property {number} seed
 * @property {string} mapTemplate
 * @property {number} mapSize
 * @property {number} obstacleDensity
 * @property {boolean} wrapWalls
 * @property {number} startLength
 * @property {string} speedMode
 * @property {boolean} dangerEnabled
 * @property {number} dangerSpawnRate
 * @property {number} dangerTimeoutSec
 * @property {string} poisonMode
 * @property {Record<string, boolean>} itemEnabled
 * @property {Record<string, number>} itemWeights
 * @property {Readonly<DailyGameplayRules>} gameplayRules
 * @property {Readonly<Record<string, Readonly<DailyItemDefinition>>>} itemDefinitions
 */

/**
 * @typedef {Object} DecodedShare
 * @property {DailyChallengeDescriptor} challenge
 * @property {number} score
 */

/**
 * @param {Date} [date]
 * @returns {string}
 */
export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * @param {string} dateKey
 * @returns {DailyChallengeDescriptor}
 */
export function createDailyChallenge(dateKey) {
  const normalizedDate = normalizeDateKey(dateKey);
  const rulesRng = createDailyV1Random(`${RULES_DOMAIN}|${normalizedDate}`);
  const gameplayRng = createDailyV1Random(`${GAMEPLAY_DOMAIN}|${normalizedDate}`);
  const mapTemplate =
    DAILY_V1_MAP_TEMPLATES[rulesRng.nextInt(0, DAILY_V1_MAP_TEMPLATES.length - 1)];
  const obstacleDensity =
    DAILY_V1_OBSTACLE_DENSITIES[rulesRng.nextInt(0, DAILY_V1_OBSTACLE_DENSITIES.length - 1)];

  /** @type {Record<string, boolean>} */
  const itemEnabled = {};
  /** @type {Record<string, number>} */
  const itemWeights = {};
  for (const type of Object.values(ItemType)) itemEnabled[type] = false;
  for (const [type, definition] of Object.entries(DAILY_V1_ITEM_DEFINITIONS)) {
    itemEnabled[type] = true;
    itemWeights[type] = definition.weight;
  }

  return {
    version: CHALLENGE_VERSION,
    algorithmVersion: 1,
    challengeId: `daily-v${CHALLENGE_VERSION}-${normalizedDate}`,
    dateKey: normalizedDate,
    seed: gameplayRng.initialSeed,
    mapTemplate,
    obstacleDensity,
    ...DAILY_V1_RULES,
    itemEnabled,
    itemWeights,
    gameplayRules: DAILY_V1_GAMEPLAY_RULES,
    itemDefinitions: DAILY_V1_ITEM_DEFINITIONS
  };
}

/**
 * Encode a compact, obfuscated result token with lightweight accidental and
 * casual-edit detection for URL sharing.
 *
 * The HMAC key is derived entirely in the client and is therefore recoverable
 * from the public source. It does not authenticate the score and must not be
 * treated as proof for a trusted leaderboard, prize, or competitive result.
 *
 * @param {string} dateKey
 * @param {number} score
 * @returns {Promise<string>}
 */
export async function encodeDailyShare(dateKey, score) {
  ensureWebCrypto();
  const normalizedDate = normalizeDateKey(dateKey);
  const normalizedScore = normalizeScore(score);
  const dayIndex = dateKeyToDayIndex(normalizedDate);
  const nonce = crypto.getRandomValues(new Uint16Array(1))[0];
  const bytes = new Uint8Array(SHARE_BYTES);
  const view = new DataView(bytes.buffer);

  bytes[0] = SHARE_VERSION;
  writeUint24(bytes, 1, dayIndex);
  view.setUint16(4, nonce, false);

  const payload = new Uint8Array(SHARE_PAYLOAD_BYTES);
  const payloadView = new DataView(payload.buffer);
  payloadView.setInt32(0, normalizedScore, false);
  payload[4] = CHALLENGE_VERSION;
  payload[5] = 0;

  const mask = await deriveMask(normalizedDate, nonce);
  for (let i = 0; i < SHARE_PAYLOAD_BYTES; i++) {
    bytes[SHARE_PAYLOAD_OFFSET + i] = payload[i] ^ mask[i];
  }

  const tag = await signPrefix(bytes.subarray(0, SHARE_PREFIX_BYTES), normalizedDate, nonce);
  bytes.set(tag.subarray(0, SHARE_TAG_BYTES), SHARE_PREFIX_BYTES);
  return bytesToBase64Url(bytes);
}

/**
 * @param {string} token
 * @returns {Promise<DecodedShare | null>}
 */
export async function decodeDailyShare(token) {
  if (!globalThis.crypto?.subtle) return null;
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;

  let bytes;
  try {
    bytes = base64UrlToBytes(token);
  } catch {
    return null;
  }
  if (bytes.length !== SHARE_BYTES || bytes[0] !== SHARE_VERSION) return null;

  const dayIndex = readUint24(bytes, 1);
  const dateKey = dayIndexToDateKey(dayIndex);
  if (!dateKey) return null;

  const nonce = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(4, false);
  const expectedTag = await signPrefix(bytes.subarray(0, SHARE_PREFIX_BYTES), dateKey, nonce);
  if (
    !constantTimeEqual(bytes.subarray(SHARE_PREFIX_BYTES), expectedTag.subarray(0, SHARE_TAG_BYTES))
  ) {
    return null;
  }

  const mask = await deriveMask(dateKey, nonce);
  const payload = new Uint8Array(SHARE_PAYLOAD_BYTES);
  for (let i = 0; i < SHARE_PAYLOAD_BYTES; i++) {
    payload[i] = bytes[SHARE_PAYLOAD_OFFSET + i] ^ mask[i];
  }
  if (payload[4] !== CHALLENGE_VERSION || payload[5] !== 0) return null;

  const score = new DataView(payload.buffer).getInt32(0, false);
  try {
    return { challenge: createDailyChallenge(dateKey), score };
  } catch {
    return null;
  }
}

/** @param {string} dateKey @returns {string} */
function normalizeDateKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new RangeError('Invalid daily challenge date');
  const parts = dateKey.split('-').map(Number);
  const utc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== parts[0] ||
    check.getUTCMonth() !== parts[1] - 1 ||
    check.getUTCDate() !== parts[2]
  ) {
    throw new RangeError('Invalid daily challenge date');
  }
  return dateKey;
}

/** @param {number} score @returns {number} */
function normalizeScore(score) {
  if (!Number.isSafeInteger(score) || score < MIN_SHARED_SCORE || score > MAX_SHARED_SCORE) {
    throw new RangeError('Invalid daily challenge score');
  }
  return score;
}

/** @param {string} dateKey @returns {number} */
function dateKeyToDayIndex(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const index = Math.floor((Date.UTC(year, month - 1, day) - DAY_ZERO_UTC) / DAY_MS);
  if (index < 0 || index > MAX_DAY_INDEX) {
    throw new RangeError('Daily challenge date is outside the supported range');
  }
  return index;
}

/** @param {number} dayIndex @returns {string | null} */
function dayIndexToDateKey(dayIndex) {
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > MAX_DAY_INDEX) return null;
  const date = new Date(DAY_ZERO_UTC + dayIndex * DAY_MS);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** @param {string} dateKey @param {number} nonce @returns {Promise<Uint8Array>} */
async function deriveMask(dateKey, nonce) {
  const material = encoder.encode(`${MASK_DOMAIN}|${dateKey}|${nonce}|${SHARE_PEPPER}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', material));
}

/**
 * @param {Uint8Array} prefix
 * @param {string} dateKey
 * @param {number} nonce
 * @returns {Promise<Uint8Array>}
 */
async function signPrefix(prefix, dateKey, nonce) {
  const keyMaterial = encoder.encode(`${HMAC_DOMAIN}|${dateKey}|${nonce}|${SHARE_PEPPER}`);
  const keyDigest = await crypto.subtle.digest('SHA-256', keyMaterial);
  const key = await crypto.subtle.importKey(
    'raw',
    keyDigest,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const message = new ArrayBuffer(prefix.byteLength);
  new Uint8Array(message).set(prefix);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
}

function ensureWebCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error('Web Crypto API is unavailable');
  }
}

/** @param {Uint8Array} bytes @param {number} offset @param {number} value */
function writeUint24(bytes, offset, value) {
  bytes[offset] = (value >>> 16) & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = value & 0xff;
}

/** @param {Uint8Array} bytes @param {number} offset @returns {number} */
function readUint24(bytes, offset) {
  return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}

/** @param {Uint8Array} a @param {Uint8Array} b @returns {boolean} */
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** @param {Uint8Array} bytes @returns {string} */
function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** @param {string} value @returns {Uint8Array} */
function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
