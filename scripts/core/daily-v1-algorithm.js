// @ts-check

const DEAD_END_DIRS = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -1, y: 0 }),
  Object.freeze({ x: 1, y: 0 })
]);
const FOOD_TYPES = Object.freeze(['roach', 'ant', 'mosquito', 'egg', 'mouse']);
const DANGER_TYPES = Object.freeze(['trash', 'poison']);

/**
 * Frozen RNG implementation for daily-v1. Do not modify this algorithm; add a
 * new daily challenge version instead.
 */
export class DailyV1Random {
  /** @param {number | string} [seed] */
  constructor(seed = Date.now()) {
    this.setSeed(seed);
  }

  /** @param {number | string} seed */
  setSeed(seed) {
    this.initialSeed = typeof seed === 'string' ? this._hashString(seed) : seed >>> 0;
    this.state = this.initialSeed;
  }

  /** @param {string} value @returns {number} */
  _hashString(value) {
    let hash = 1779033703 ^ value.length;
    for (let index = 0; index < value.length; index++) {
      hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353);
      hash = (hash << 13) | (hash >>> 19);
    }
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return hash >>> 0;
  }

  /** @returns {number} */
  next() {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  /** @returns {number} */
  nextFloat() {
    return this.next();
  }

  /** @param {number} min @param {number} max @returns {number} */
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

/** @param {number | string} seed @returns {DailyV1Random} */
export function createDailyV1Random(seed) {
  return new DailyV1Random(seed);
}

/**
 * Generate a map and return the same RNG after map generation so item spawning
 * continues the exact daily-v1 sequence.
 *
 * The algorithm intentionally reads only public gameplay state plus the
 * descriptor-backed settings/item definitions supplied to ItemManager. It must
 * not delegate v1 rule decisions to ItemManager private helpers, because later
 * normal-mode refactors must not reinterpret historical daily-v1 challenges.
 *
 * @param {import('./grid.js').Grid} grid
 * @param {string} template
 * @param {number} seed
 * @param {number} density
 * @returns {DailyV1ItemAlgorithm}
 */
export function createDailyV1ItemAlgorithm(grid, template, seed, density) {
  const random = new DailyV1Random(seed);
  generateDailyV1Map(grid, template, density, random);
  return {
    version: 1,
    random,
    findSpawnPosition: findDailyV1SpawnPosition,
    pickFoodType: (manager) => weightedPick(manager, FOOD_TYPES),
    pickDangerType: (manager) => weightedPick(manager, DANGER_TYPES),
    weightedPick
  };
}

/**
 * @typedef {Object} DailyV1ItemAlgorithm
 * @property {number} version
 * @property {DailyV1Random} random
 * @property {(manager: import('./item-manager.js').ItemManager, avoidDeadEnds: boolean) => {x: number, y: number} | null} findSpawnPosition
 * @property {(manager: import('./item-manager.js').ItemManager) => string | null} pickFoodType
 * @property {(manager: import('./item-manager.js').ItemManager) => string | null} pickDangerType
 * @property {(manager: import('./item-manager.js').ItemManager, types: readonly string[]) => string | null} weightedPick
 */

/**
 * @param {import('./grid.js').Grid} grid
 * @param {string} template
 * @param {number} density
 * @param {DailyV1Random} random
 */
function generateDailyV1Map(grid, template, density, random) {
  grid.clearObstacles();
  const size = grid.size;
  const middle = Math.floor(size / 2);

  switch (template) {
    case 'empty':
      break;
    case 'cross_wall':
      for (let index = 2; index < size - 2; index++) {
        if (Math.abs(index - middle) > 2) {
          grid.addObstacle(index, middle);
          grid.addObstacle(middle, index);
        }
      }
      break;
    case 'pillars':
      for (let x = 4; x < size - 4; x += 4) {
        for (let y = 4; y < size - 4; y += 4) {
          grid.addObstacle(x, y);
          grid.addObstacle(x + 1, y);
          grid.addObstacle(x, y + 1);
          grid.addObstacle(x + 1, y + 1);
        }
      }
      break;
    case 'maze_simple':
      for (let index = 0; index < size; index++) {
        grid.addObstacle(index, 0);
        grid.addObstacle(index, size - 1);
        grid.addObstacle(0, index);
        grid.addObstacle(size - 1, index);
      }
      for (let x = 4; x < size - 4; x += 4) {
        for (let y = 4; y < size - 4; y++) {
          if (random.nextFloat() > 0.3) grid.addObstacle(x, y);
        }
      }
      break;
  }

  const count = Math.floor(size * size * density);
  const isSafeZone = (x, y) => Math.abs(x - middle) <= 1 && Math.abs(y - middle) <= 1;
  let added = 0;
  let attempts = 0;
  while (added < count && attempts < count * 5) {
    const x = random.nextInt(0, size - 1);
    const y = random.nextInt(0, size - 1);
    if (!grid.isObstacle(x, y) && !isSafeZone(x, y)) {
      grid.addObstacle(x, y);
      added++;
    }
    attempts++;
  }
}

/**
 * @param {import('./item-manager.js').ItemManager} manager
 * @param {boolean} avoidDeadEnds
 * @returns {{x: number, y: number} | null}
 */
function findDailyV1SpawnPosition(manager, avoidDeadEnds) {
  const isOccupied = (x, y) =>
    manager.snake.isOccupied(x, y, false) ||
    manager.items.some((item) => item.x === x && item.y === y);

  if (avoidDeadEnds) {
    const reachable = findReachableFoodCell(manager, isOccupied);
    if (reachable) return reachable;
  }

  const position = findRandomEmptyCell(manager, (x, y) => {
    if (isOccupied(x, y)) return true;
    return avoidDeadEnds && isDeadEndCell(manager, x, y);
  });
  if (position) return position;
  return findRandomEmptyCell(manager, isOccupied);
}

/**
 * @param {import('./item-manager.js').ItemManager} manager
 * @param {(x: number, y: number) => boolean} occupied
 * @returns {{x: number, y: number} | null}
 */
function findReachableFoodCell(manager, occupied) {
  const size = manager.grid.size;
  const cellCount = size * size;
  if (!cellCount) return null;

  const blocked = new Uint8Array(cellCount);
  const reachable = new Uint8Array(cellCount);
  const queue = new Int32Array(cellCount);
  for (const key of manager.grid.obstacles) {
    if (key >= 0 && key < cellCount) blocked[key] = 1;
  }
  for (const segment of manager.snake.body) {
    const key = segment.y * size + segment.x;
    if (key >= 0 && key < cellCount) blocked[key] = 1;
  }

  const head = manager.snake.getHead();
  if (!head) return null;
  const headKey = head.y * size + head.x;
  if (headKey < 0 || headKey >= cellCount) return null;
  blocked[headKey] = 0;

  let read = 0;
  let write = 0;
  reachable[headKey] = 1;
  queue[write++] = headKey;
  while (read < write) {
    const key = queue[read++];
    const x = key % size;
    const y = (key / size) | 0;
    for (let direction = 0; direction < 4; direction++) {
      let nextX = x;
      let nextY = y;
      if (direction === 0) nextY--;
      else if (direction === 1) nextY++;
      else if (direction === 2) nextX--;
      else nextX++;

      if (manager.grid.wrapWalls) {
        nextX = ((nextX % size) + size) % size;
        nextY = ((nextY % size) + size) % size;
      } else if (!manager.grid.isValid(nextX, nextY)) {
        continue;
      }

      const nextKey = nextY * size + nextX;
      if (reachable[nextKey] || blocked[nextKey]) continue;
      reachable[nextKey] = 1;
      queue[write++] = nextKey;
    }
  }

  let chosenKey = -1;
  let candidateCount = 0;
  for (let key = 0; key < cellCount; key++) {
    if (!reachable[key]) continue;
    const x = key % size;
    const y = (key / size) | 0;
    if (occupied(x, y) || isDeadEndCell(manager, x, y)) continue;
    candidateCount++;
    if (manager.algorithm.random.nextInt(0, candidateCount - 1) === 0) chosenKey = key;
  }

  return chosenKey < 0 ? null : { x: chosenKey % size, y: (chosenKey / size) | 0 };
}

/**
 * @param {import('./item-manager.js').ItemManager} manager
 * @param {(x: number, y: number) => boolean} occupied
 * @returns {{x: number, y: number} | null}
 */
function findRandomEmptyCell(manager, occupied) {
  for (let attempts = 0; attempts < 100; attempts++) {
    const x = manager.algorithm.random.nextInt(0, manager.grid.size - 1);
    const y = manager.algorithm.random.nextInt(0, manager.grid.size - 1);
    if (!manager.grid.isObstacle(x, y) && !occupied(x, y)) return { x, y };
  }
  return null;
}

/**
 * @param {import('./item-manager.js').ItemManager} manager
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isDeadEndCell(manager, x, y) {
  let openCount = 0;
  for (const direction of DEAD_END_DIRS) {
    const nextX = x + direction.x;
    const nextY = y + direction.y;
    if (manager.grid.isValid(nextX, nextY) && !manager.grid.isObstacle(nextX, nextY)) {
      openCount++;
    }
  }
  return openCount <= 1;
}

/**
 * Daily-v1 enablement is part of the frozen algorithm contract. Keep it local
 * instead of calling ItemManager._isEnabled(), whose normal-mode semantics may
 * evolve independently.
 * @param {import('./item-manager.js').ItemManager} manager
 * @param {string} type
 * @returns {boolean}
 */
function isDailyV1Enabled(manager, type) {
  if (manager.settings.itemEnabled?.[type] === false) return false;
  if (!manager.settings.dangerEnabled && DANGER_TYPES.includes(type)) return false;
  return true;
}

/**
 * @param {import('./item-manager.js').ItemManager} manager
 * @param {readonly string[]} types
 * @returns {string | null}
 */
function weightedPick(manager, types) {
  const enabled = types.filter((type) => isDailyV1Enabled(manager, type));
  if (!enabled.length) return null;
  const weightOf = (type) => manager.itemDefinitions[type]?.weight || 0;
  const totalWeight = enabled.reduce((sum, type) => sum + weightOf(type), 0);
  if (totalWeight <= 0) return enabled[0];

  let value = manager.algorithm.random.nextInt(0, totalWeight - 1);
  for (const type of enabled) {
    value -= weightOf(type);
    if (value < 0) return type;
  }
  return enabled[0];
}
