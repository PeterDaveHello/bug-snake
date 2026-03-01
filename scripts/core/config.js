// @ts-check
export const ItemType = {
  ROACH: 'roach',
  ANT: 'ant',
  MOSQUITO: 'mosquito',
  EGG: 'egg',
  MOUSE: 'mouse',
  TRASH: 'trash',
  POISON: 'poison'
};

export const SpeedMode = {
  FIXED: 'fixed',
  SCORE: 'score',
  TIME: 'time',
  MANUAL: 'manual'
};

export const PoisonMode = {
  DEATH: 'death',
  SHRINK: 'shrink'
};

export const GameConfig = {
  map: {
    defaultSize: 24,
    minSize: 16,
    maxSize: 48,
    step: 4
  },

  snake: {
    defaultLength: 3,
    minLength: 3,
    maxLength: 10
  },

  rules: {
    defaultWrap: false,
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
    speedSmoothingMs: 100,
    poisonShrinkAmount: 4
  },

  render: {
    itemSpriteCacheEnabled: true,
    itemSpriteFrameBuckets: 6,
    itemSpriteVariantBuckets: 4
  },

  items: {
    [ItemType.ROACH]: { score: 10, length: 1, weight: 50, color: '#8B5A2B' },
    [ItemType.ANT]: { score: 6, length: 1, weight: 30, color: '#FF3B30' },
    [ItemType.MOSQUITO]: { score: 15, length: 1, speedBoost: 3, weight: 20, color: '#32ADE6' },
    [ItemType.EGG]: { score: 8, length: 1, weight: 25, color: '#F5DEB3' },
    [ItemType.MOUSE]: { score: 20, length: 2, weight: 8, color: '#808080' },
    [ItemType.TRASH]: { score: -20, length: -2, weight: 80, color: '#A2845E' },
    [ItemType.POISON]: { score: 0, length: 0, weight: 20, color: '#AF52DE', isPoison: true }
  },

  dangerSpawnRate: 6,
  dangerTimeoutSec: 15,

  defaults: {
    seed: Date.now(),
    musicVolume: 0.35,
    musicEnabled: true,
    sfxVolume: 0.6
  },

  randomizer: {
    maxMapSize: 32,
    densityMax: 0.08,
    wrapChance: 0.25,
    speedMin: 6,
    speedMax: 10
  }
};
