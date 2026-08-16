// @ts-check
import { GameConfig, ItemType } from './config.js';
import { rng } from './random.js';

/**
 * @typedef {Object} ItemDefinition
 * @property {number} score
 * @property {number} length
 * @property {number} weight
 * @property {string} color
 * @property {number} [speedBoost]
 * @property {boolean} [isPoison]
 */

const DEAD_END_DIRS = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 }
];

export class ItemManager {
  /**
   * @param {import('./grid.js').Grid} grid
   * @param {import('./snake.js').Snake} snake
   * @param {Object} settings
   * @param {Readonly<Record<string, Readonly<ItemDefinition>>>} [itemDefinitions]
   * @param {import('./daily-v1-algorithm.js').DailyV1ItemAlgorithm | null} [algorithm]
   */
  constructor(grid, snake, settings, itemDefinitions = GameConfig.items, algorithm = null) {
    this.grid = grid;
    this.snake = snake;
    this.settings = settings;
    this.itemDefinitions = itemDefinitions;
    this.algorithm = algorithm;
    this.items = [];
    // Active-play milliseconds. This advances only when a gameplay simulation
    // tick runs, so pauses and background-tab suspension cannot expire hazards.
    this.dangerTimer = 0;
    this.foodEatenCount = 0;
    this.nextDangerThreshold = this.settings.dangerSpawnRate;

    this._spawnBlocked = null;
    this._spawnReachable = null;
    this._spawnQueue = null;
  }

  /**
   * @param {number} deltaTime Active gameplay time in seconds.
   * @param {number} [wallClockTime] Retained for call-site compatibility; hazard expiry ignores it.
   */
  tick(deltaTime, wallClockTime = 0) {
    void wallClockTime;
    const elapsedMs =
      Number.isFinite(deltaTime) && deltaTime > 0 ? Math.max(0, deltaTime * 1000) : 0;
    this.dangerTimer += elapsedMs;
    const currentTime = this.dangerTimer;
    const timeoutMs =
      this.settings.dangerTimeoutSec > 0 ? this.settings.dangerTimeoutSec * 1000 : 0;

    // Filter items: remove disabled types and expired danger items
    // Optimized: Use in-place filtering to avoid creating new Array every frame
    let writeIndex = 0;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (!this._isEnabled(item.type)) continue;

      const isExpiredDanger =
        timeoutMs > 0 && this._isDanger(item.type) && currentTime - item.spawnTime > timeoutMs;
      if (isExpiredDanger) continue;

      if (writeIndex !== i) {
        this.items[writeIndex] = item;
      }
      writeIndex++;
    }
    this.items.length = writeIndex;

    let hasFood = false;
    for (let i = 0; i < this.items.length; i++) {
      if (this._isFood(this.items[i].type)) {
        hasFood = true;
        break;
      }
    }
    if (!hasFood) {
      const foodType = this._pickFoodType();
      if (foodType) {
        this.spawnItem(foodType);
      }
    }

    if (this.settings.dangerEnabled && this.foodEatenCount >= this.nextDangerThreshold) {
      let hasDanger = false;
      for (let i = 0; i < this.items.length; i++) {
        if (this._isDanger(this.items[i].type)) {
          hasDanger = true;
          break;
        }
      }
      if (!hasDanger) {
        const dangerType = this._pickDangerType();
        if (dangerType) {
          this.spawnItem(dangerType, currentTime);
        }
      }
      this.nextDangerThreshold += this.settings.dangerSpawnRate;
    }
  }

  spawnItem(type, currentTime = this.dangerTimer) {
    const avoidDeadEnds = this._isFood(type);
    const pos = this._findSpawnPosition(avoidDeadEnds);

    if (pos) {
      this.items.push({
        x: pos.x,
        y: pos.y,
        type: type,
        spawnTime: currentTime,
        id: Math.floor(Math.random() * 1000000),
        visualAttrs: {
          sizeVar: 0.85 + Math.random() * 0.3, // 0.85 - 1.15
          hueVar: Math.floor(-15 + Math.random() * 30), // +/- 15 deg
          angleVar: -0.2 + Math.random() * 0.4,
          quirk: Math.random() // 0.0 - 1.0 for random features
        }
      });
    }
  }

  _findSpawnPosition(avoidDeadEnds) {
    if (this.algorithm) return this.algorithm.findSpawnPosition(this, avoidDeadEnds);

    const isOccupied = (x, y) =>
      this.snake.isOccupied(x, y, false) || this.items.some((i) => i.x === x && i.y === y);

    if (avoidDeadEnds) {
      const reachablePos = this._findReachableFoodCell(isOccupied);
      if (reachablePos) return reachablePos;
    }

    const pos = this.grid.getRandomEmptyCell(rng, (x, y) => {
      if (isOccupied(x, y)) return true;
      return avoidDeadEnds && this._isDeadEndCell(x, y);
    });

    if (pos) return pos;
    // Fallback: accept dead ends if no better spot found
    return this.grid.getRandomEmptyCell(rng, isOccupied);
  }

  /**
   * Prefer spawning food in cells that are reachable from the snake head.
   * This avoids unreachable "dead zone" spawns in maps with sealed areas.
   * @param {(x: number, y: number) => boolean} isOccupied
   * @returns {{x: number, y: number} | null}
   */
  _findReachableFoodCell(isOccupied) {
    const size = this.grid.size;
    const cellCount = size * size;
    if (!cellCount) return null;

    if (!this._spawnBlocked || this._spawnBlocked.length !== cellCount) {
      this._spawnBlocked = new Uint8Array(cellCount);
      this._spawnReachable = new Uint8Array(cellCount);
      this._spawnQueue = new Int32Array(cellCount);
    }

    const blocked = this._spawnBlocked;
    const reachable = this._spawnReachable;
    const queue = this._spawnQueue;

    blocked.fill(0);
    reachable.fill(0);

    for (const key of this.grid.obstacles) {
      if (key >= 0 && key < cellCount) blocked[key] = 1;
    }
    for (const segment of this.snake.body) {
      const key = segment.y * size + segment.x;
      if (key >= 0 && key < cellCount) blocked[key] = 1;
    }

    const head = this.snake.getHead();
    if (!head) return null;
    const headKey = head.y * size + head.x;
    if (headKey < 0 || headKey >= cellCount) return null;
    blocked[headKey] = 0;

    let qRead = 0;
    let qWrite = 0;
    reachable[headKey] = 1;
    queue[qWrite++] = headKey;

    const wrapWalls = this.grid.wrapWalls;
    while (qRead < qWrite) {
      const key = queue[qRead++];
      const x = key % size;
      const y = (key / size) | 0;

      // Up, Down, Left, Right
      // Keep it explicit to avoid allocating arrays in hot code paths.
      for (let i = 0; i < 4; i++) {
        let nx = x;
        let ny = y;
        switch (i) {
          case 0:
            ny -= 1;
            break;
          case 1:
            ny += 1;
            break;
          case 2:
            nx -= 1;
            break;
          case 3:
            nx += 1;
            break;
        }

        if (wrapWalls) {
          nx = ((nx % size) + size) % size;
          ny = ((ny % size) + size) % size;
        } else if (!this.grid.isValid(nx, ny)) {
          continue;
        }

        const nkey = ny * size + nx;
        if (reachable[nkey] || blocked[nkey]) continue;
        reachable[nkey] = 1;
        queue[qWrite++] = nkey;
      }
    }

    let chosenKey = -1;
    let candidateCount = 0;
    for (let key = 0; key < cellCount; key++) {
      if (!reachable[key]) continue;
      const x = key % size;
      const y = (key / size) | 0;
      if (isOccupied(x, y)) continue;
      if (this._isDeadEndCell(x, y)) continue;
      candidateCount += 1;
      // Reservoir sampling: uniformly select without building an array.
      if (rng.nextInt(0, candidateCount - 1) === 0) {
        chosenKey = key;
      }
    }

    if (chosenKey < 0) return null;
    return { x: chosenKey % size, y: (chosenKey / size) | 0 };
  }

  _isDeadEndCell(x, y) {
    let openCount = 0;
    for (const dir of DEAD_END_DIRS) {
      const nx = x + dir.x;
      const ny = y + dir.y;
      if (this.grid.isValid(nx, ny) && !this.grid.isObstacle(nx, ny)) {
        openCount++;
      }
    }

    return openCount <= 1;
  }

  checkCollision(headX, headY) {
    const index = this.items.findIndex((i) => i.x === headX && i.y === headY);
    if (index !== -1) {
      const item = this.items[index];
      this.items.splice(index, 1);
      return item.type;
    }
    return null;
  }

  recordConsumption() {
    this.foodEatenCount++;
  }

  clear() {
    this.items = [];
    this.dangerTimer = 0;
    this.foodEatenCount = 0;
    this.nextDangerThreshold = this.settings.dangerSpawnRate;
  }

  _pickFoodType() {
    if (this.algorithm) return this.algorithm.pickFoodType(this);
    const foods = [
      ItemType.ROACH,
      ItemType.ANT,
      ItemType.MOSQUITO,
      ItemType.EGG,
      ItemType.MOUSE
    ].filter((type) => this._isEnabled(type));
    return this._weightedPick(foods);
  }

  _pickDangerType() {
    if (this.algorithm) return this.algorithm.pickDangerType(this);
    const dangers = [ItemType.TRASH, ItemType.POISON].filter((type) => this._isEnabled(type));
    return this._weightedPick(dangers);
  }

  _weightedPick(types) {
    if (this.algorithm) return this.algorithm.weightedPick(this, types);
    if (!types?.length) return null;

    const totalWeight = types.reduce((sum, t) => sum + this._getWeight(t), 0);
    if (totalWeight <= 0) return types[0];

    let random = rng.nextInt(0, totalWeight - 1);

    for (const type of types) {
      random -= this._getWeight(type);
      if (random < 0) return type;
    }
    return types[0];
  }

  _getWeight(type) {
    if (this.settings.itemWeights && this.settings.itemWeights[type] !== undefined) {
      return this.settings.itemWeights[type];
    }
    return this.itemDefinitions[type]?.weight ?? 0;
  }

  _isEnabled(type) {
    if (this.settings.itemEnabled && this.settings.itemEnabled[type] === false) {
      return false;
    }
    if (!this.settings.dangerEnabled && this._isDanger(type)) {
      return false;
    }
    return true;
  }

  _isFood(type) {
    const item = this.itemDefinitions[type];
    return Boolean(item && item.score > 0);
  }

  _isDanger(type) {
    const item = this.itemDefinitions[type];
    return Boolean(item && (item.score < 0 || item.isPoison));
  }
}
