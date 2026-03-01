// @ts-check
import { Direction } from '../input/input-manager.js';

export class Snake {
  constructor(grid, startLength = 3) {
    this.grid = grid;
    this.body = [];
    this.prevBody = [];
    this.direction = Direction.RIGHT;
    this.nextDirection = Direction.RIGHT;
    this.growthPending = 0;
    this.shrinkPending = 0;
    this.isDead = false;
    this.deathReason = null;
    /** @type {Set<number>} cell keys occupied by body segments */
    this._occupiedKeys = new Set();

    this._init(startLength);
    this._capturePrevBody();
  }

  _init(length) {
    const size = this.grid.size;
    const safeLength = Math.max(1, Math.min(length, size));
    const mid = Math.floor(size / 2);
    const startX = Math.min(size - 1, Math.max(mid, safeLength - 1));
    const startY = Math.floor(size / 2);

    for (let i = 0; i < safeLength; i++) {
      this.body.push({ x: startX - i, y: startY });
    }
    this._rebuildOccupiedKeys();
  }

  _rebuildOccupiedKeys() {
    this._occupiedKeys.clear();
    const size = this.grid.size;
    for (let i = 0; i < this.body.length; i++) {
      const s = this.body[i];
      this._occupiedKeys.add(s.y * size + s.x);
    }
  }

  _capturePrevBody() {
    const len = this.body.length;
    for (let i = 0; i < len; i++) {
      const segment = this.body[i];
      const prev = this.prevBody[i];
      if (prev) {
        prev.x = segment.x;
        prev.y = segment.y;
      } else {
        this.prevBody.push({ x: segment.x, y: segment.y });
      }
    }
    this.prevBody.length = len;
  }

  setDirection(newDir) {
    if (this.direction.x + newDir.x === 0 && this.direction.y + newDir.y === 0) {
      return;
    }
    this.nextDirection = newDir;
  }

  tick() {
    if (this.isDead) return;

    this._capturePrevBody();

    this.direction = this.nextDirection;
    const head = this.body[0];
    let nextX = head.x + this.direction.x;
    let nextY = head.y + this.direction.y;

    if (!this.grid.isValid(nextX, nextY)) {
      this.deathReason = 'wall';
      this.isDead = true;
      return;
    }

    if (this.grid.wrapWalls) {
      const nextPos = this.grid.normalize(nextX, nextY);
      nextX = nextPos.x;
      nextY = nextPos.y;
    }

    if (this.grid.isObstacle(nextX, nextY)) {
      this.deathReason = 'obstacle';
      this.isDead = true;
      return;
    }

    const ignoreCount = this.growthPending === 0 ? 1 + (this.shrinkPending > 0 ? 1 : 0) : 0;
    if (this.isOccupied(nextX, nextY, ignoreCount)) {
      this.deathReason = 'self';
      this.isDead = true;
      return;
    }

    this.body.unshift({ x: nextX, y: nextY });
    const size = this.grid.size;
    const nextKey = nextY * size + nextX;
    this._occupiedKeys.add(nextKey);

    if (this.growthPending > 0) {
      this.growthPending--;
    } else {
      const removed = this.body.pop();
      if (removed) {
        const removedKey = removed.y * size + removed.x;
        if (removedKey !== nextKey) this._occupiedKeys.delete(removedKey);
      }
      if (this.shrinkPending > 0 && this.body.length > 1) {
        const removed2 = this.body.pop();
        if (removed2) {
          const removed2Key = removed2.y * size + removed2.x;
          if (removed2Key !== nextKey) this._occupiedKeys.delete(removed2Key);
        }
        this.shrinkPending--;
      }
    }
  }

  grow(amount) {
    this.growthPending += amount;
  }

  shrink(amount) {
    this.shrinkPending += amount;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {boolean | number} ignoreTail
   * @returns {boolean}
   */
  isOccupied(x, y, ignoreTail = false) {
    let ignoreCount;
    if (typeof ignoreTail === 'number') {
      ignoreCount = Math.max(0, Math.floor(ignoreTail));
    } else {
      ignoreCount = ignoreTail ? 1 : 0;
    }
    const key = y * this.grid.size + x;
    if (!this._occupiedKeys.has(key)) return false;
    if (ignoreCount === 0) return true;
    // Rare path: verify hit is not in the ignored tail portion
    const limit = Math.max(0, this.body.length - ignoreCount);
    for (let i = 0; i < limit; i++) {
      if (this.body[i].x === x && this.body[i].y === y) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if the coordinate is part of the snake's body.
   * Alias for isOccupied, used by AI Pilot.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isBody(x, y) {
    return this.isOccupied(x, y);
  }

  getHead() {
    return this.body[0];
  }
}
