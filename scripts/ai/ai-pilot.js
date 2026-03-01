// @ts-check
import { GameConfig } from '../core/config.js';
import { MinHeap } from '../utils/min-heap.js';

export const AIAlgorithm = {
  GREEDY: 'greedy',
  BFS: 'bfs',
  ASTAR: 'astar'
};

const MOVES = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 }
];

const DIR_UP = MOVES[0];
const DIR_DOWN = MOVES[1];
const DIR_LEFT = MOVES[2];
const DIR_RIGHT = MOVES[3];

export class AIPilot {
  constructor(grid, snake, itemManager) {
    this.grid = grid;
    this.snake = snake;
    this.itemManager = itemManager;
    this.algorithm = AIAlgorithm.ASTAR;
    this.currentPath = [];
    this.enabled = false;
    this.showPath = true;
    this.maxPathLength = 30;
    this.pathLength = this.maxPathLength;
    this.updateEveryNTicks = 1;
    this.tickCounter = 0;

    this._scratchTotalCells = 0;
    /** @type {Int32Array | null} */
    this._scratchParent = null;
    /** @type {Int32Array | null} */
    this._scratchGScore = null;
    /** @type {Uint8Array | null} */
    this._scratchClosed = null;
    /** @type {Int32Array | null} */
    this._scratchQueueKeys = null;
    /** @type {Uint8Array | null} */
    this._scratchGreedyVisited = null;

    /** @type {MinHeap<{key: number, f: number, g: number, t: number}> | null} */
    this._aStarOpenSet = null;
    /** @type {{key: number, f: number, g: number, t: number}[]} */
    this._aStarNodePool = [];
    this._aStarNodePoolIndex = 0;

    /** @type {Set<number>} */
    this._dangerKeys = new Set();
    /** @type {number} */
    this._dangerTickId = -1;
  }

  /**
   * Treat the tail cell as empty when it will move away (not growing).
   * This improves pathfinding stability in tight spaces without
   * simulating the full future snake body.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  _isSnakeOccupied(x, y) {
    const snake = this.snake;
    if (snake && typeof snake.isOccupied === 'function') {
      const growthPending = typeof snake.growthPending === 'number' ? snake.growthPending : 0;
      const shrinkPending = typeof snake.shrinkPending === 'number' ? snake.shrinkPending : 0;
      const ignoreCount = growthPending === 0 ? 1 + (shrinkPending > 0 ? 1 : 0) : 0;
      return snake.isOccupied(x, y, ignoreCount);
    }
    if (snake && typeof snake.isBody === 'function') {
      return snake.isBody(x, y);
    }
    return false;
  }

  _refreshDangerKeys() {
    if (this._dangerTickId === this.tickCounter) return;
    this._dangerTickId = this.tickCounter;
    this._dangerKeys.clear();

    const items =
      this.itemManager && Array.isArray(this.itemManager.items) ? this.itemManager.items : [];

    const size = this.grid.size;
    for (const item of items) {
      const def = GameConfig.items[item.type];
      if (!def) continue;
      if (def.score < 0 || def.isPoison) {
        this._dangerKeys.add(item.y * size + item.x);
      }
    }
  }

  _ensureScratchBuffers() {
    const size = this.grid.size;
    const totalCells = size * size;
    if (
      this._scratchTotalCells === totalCells &&
      this._scratchParent &&
      this._scratchGScore &&
      this._scratchClosed &&
      this._scratchQueueKeys &&
      this._scratchGreedyVisited
    ) {
      return;
    }

    this._scratchTotalCells = totalCells;
    this._scratchParent = new Int32Array(totalCells);
    this._scratchGScore = new Int32Array(totalCells);
    this._scratchClosed = new Uint8Array(totalCells);
    this._scratchQueueKeys = new Int32Array(totalCells);
    this._scratchGreedyVisited = new Uint8Array(totalCells);
  }

  /**
   * @param {number} key
   * @param {number} f
   * @param {number} g
   * @param {number} t
   * @returns {{key: number, f: number, g: number, t: number}}
   */
  _getAStarNode(key, f, g, t) {
    const index = this._aStarNodePoolIndex++;
    const node = this._aStarNodePool[index];
    if (node) {
      node.key = key;
      node.f = f;
      node.g = g;
      node.t = t;
      return node;
    }
    const newNode = { key, f, g, t };
    this._aStarNodePool[index] = newNode;
    return newNode;
  }

  setAlgorithm(algo) {
    this.algorithm = algo;
  }

  toggle(enabled) {
    this.enabled = enabled;
    this.currentPath = [];
  }

  update() {
    if (!this.enabled) return;
    this.tickCounter += 1;
    if (this.tickCounter % this.updateEveryNTicks !== 0) return;

    const head = this.snake.getHead();
    const target = this._findBestTarget(head);

    if (!target) {
      this.currentPath = [];
      return;
    }

    this._refreshDangerKeys();

    const size = this.grid.size;
    const headKey = head.y * size + head.x;
    const targetKey = target.y * size + target.x;

    switch (this.algorithm) {
      case AIAlgorithm.GREEDY:
        this.currentPath = this._solveGreedy(headKey, targetKey);
        break;
      case AIAlgorithm.BFS:
        this.currentPath = this._solveBFS(headKey, targetKey);
        break;
      case AIAlgorithm.ASTAR:
        this.currentPath = this._solveAStar(headKey, targetKey);
        break;
    }
  }

  getNextMove() {
    if (!this.enabled) return null;
    this._refreshDangerKeys();
    if (this.currentPath.length === 0) {
      return this._getFallbackMove();
    }
    const head = this.snake.getHead();
    const size = this.grid.size;
    const headKey = head.y * size + head.x;
    let nextKey = this.currentPath[0];

    if (nextKey === headKey) {
      this.currentPath.shift();
      if (this.currentPath.length === 0) {
        return this._getFallbackMove();
      }
      nextKey = this.currentPath[0];
    }

    if (this._dangerKeys.has(nextKey)) {
      this.currentPath = [];
      return this._getFallbackMove();
    }

    const nextX = nextKey % size;
    const nextY = Math.floor(nextKey / size);
    if (this.grid.obstacles.has(nextKey) || this._isSnakeOccupied(nextX, nextY)) {
      this.currentPath = [];
      return this._getFallbackMove();
    }
    const dir = this._getDirectionToXY(head.x, head.y, nextX, nextY);
    if (!dir || this._isReverse(dir)) {
      // Path can become stale when update frequency is reduced; avoid issuing
      // an illegal reverse move and fall back to a safe direction instead.
      this.currentPath = [];
      return this._getFallbackMove();
    }
    return dir;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cellSize
   * @param {number} offsetX
   * @param {number} offsetY
   * @param {number} [alpha]
   */
  drawPath(ctx, cellSize, offsetX, offsetY, alpha = 1) {
    if (!this.enabled || !this.showPath || this.currentPath.length === 0) return;

    ctx.save();
    ctx.strokeStyle = '#4CC9F0';
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([2, 4]);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();

    const t = typeof alpha === 'number' ? alpha : 1;
    const head = this.snake.getHead();
    const size = this.grid.size;
    const wrapWalls = this.grid.wrapWalls;
    const prevBody = Array.isArray(this.snake.prevBody) ? this.snake.prevBody : null;
    const prevHead = prevBody && prevBody[0] ? prevBody[0] : head;

    let ix = head.x;
    let iy = head.y;

    if (prevHead) {
      if (wrapWalls) {
        const halfSize = size / 2;
        let dx = head.x - prevHead.x;
        let dy = head.y - prevHead.y;

        if (Math.abs(dx) > halfSize) dx = dx > 0 ? dx - size : dx + size;
        if (Math.abs(dy) > halfSize) dy = dy > 0 ? dy - size : dy + size;

        ix = prevHead.x + dx * t;
        iy = prevHead.y + dy * t;
        ix = ((ix % size) + size) % size;
        iy = ((iy % size) + size) % size;
      } else {
        ix = prevHead.x + (head.x - prevHead.x) * t;
        iy = prevHead.y + (head.y - prevHead.y) * t;
      }
    }

    const startX = offsetX + ix * cellSize + cellSize / 2;
    const startY = offsetY + iy * cellSize + cellSize / 2;
    ctx.moveTo(startX, startY);

    let prevX = ix;
    let prevY = iy;

    // Limit path visualization length to prevent clutter
    const drawLimit =
      this.pathLength >= this.maxPathLength
        ? this.currentPath.length
        : Math.min(this.currentPath.length, this.pathLength);
    for (let i = 0; i < drawLimit; i++) {
      const key = this.currentPath[i];
      const x = key % size;
      const y = Math.floor(key / size);
      const px = offsetX + x * cellSize + cellSize / 2;
      const py = offsetY + y * cellSize + cellSize / 2;

      // Handle wrapping jump visually by moving without drawing line
      const isWrapJump = wrapWalls
        ? Math.abs(x - prevX) > size / 2 || Math.abs(y - prevY) > size / 2
        : false;

      if (isWrapJump) {
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }

      prevX = x;
      prevY = y;
    }

    ctx.stroke();
    ctx.restore();
  }

  _getFallbackMove() {
    this._refreshDangerKeys();

    const head = this.snake.getHead();
    const size = this.grid.size;
    const wrap = this.grid.wrapWalls;
    let bestSafeDir = null;
    let bestSafeSpace = -1;
    let bestDangerDir = null;
    let bestDangerSpace = -1;

    for (const dir of MOVES) {
      if (this._isReverse(dir)) continue;

      let nx = head.x + dir.x;
      let ny = head.y + dir.y;
      if (wrap) {
        if (nx < 0) nx = size - 1;
        else if (nx >= size) nx = 0;

        if (ny < 0) ny = size - 1;
        else if (ny >= size) ny = 0;
      } else {
        if (!this.grid.isValid(nx, ny)) continue;
      }

      const nextKey = ny * size + nx;
      if (this.grid.obstacles.has(nextKey)) continue;
      if (this._isSnakeOccupied(nx, ny)) continue;

      const space = this._estimateOpenSpace(nextKey);
      const isDanger = this._dangerKeys.has(nextKey);
      if (!isDanger && space > bestSafeSpace) {
        bestSafeSpace = space;
        bestSafeDir = dir;
      } else if (isDanger && space > bestDangerSpace) {
        bestDangerSpace = space;
        bestDangerDir = dir;
      }
    }

    return bestSafeDir || bestDangerDir;
  }

  _estimateOpenSpace(startKey) {
    this._ensureScratchBuffers();
    const size = this.grid.size;
    const wrap = this.grid.wrapWalls;
    const visited = this._scratchClosed;
    const queue = this._scratchQueueKeys;
    if (!visited || !queue) return 0;
    visited.fill(0);
    visited[startKey] = 1;

    const obstacles = this.grid.obstacles;
    let queueRead = 0;
    let queueWrite = 0;
    queue[queueWrite++] = startKey;
    let count = 0;

    while (queueRead < queueWrite) {
      const key = queue[queueRead++];
      count += 1;

      const x = key % size;
      const y = Math.floor(key / size);

      for (const dir of MOVES) {
        let nx = x + dir.x;
        let ny = y + dir.y;

        if (wrap) {
          if (nx < 0) nx = size - 1;
          else if (nx >= size) nx = 0;

          if (ny < 0) ny = size - 1;
          else if (ny >= size) ny = 0;
        } else {
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
        }

        const nKey = ny * size + nx;
        if (visited[nKey]) continue;
        if (obstacles.has(nKey)) continue;
        if (this._dangerKeys.has(nKey)) continue;
        if (this._isSnakeOccupied(nx, ny)) continue;

        visited[nKey] = 1;
        queue[queueWrite++] = nKey;
      }
    }

    return count;
  }

  _findBestTarget(head) {
    let bestItem = null;
    let minDist = Infinity;
    const size = this.grid.size;
    const wrapWalls = this.grid.wrapWalls;

    for (const item of this.itemManager.items) {
      const def = GameConfig.items[item.type];
      if (def.score > 0) {
        let dx = Math.abs(head.x - item.x);
        let dy = Math.abs(head.y - item.y);
        if (wrapWalls) {
          dx = Math.min(dx, size - dx);
          dy = Math.min(dy, size - dy);
        }
        const dist = dx + dy;
        if (dist < minDist) {
          minDist = dist;
          bestItem = item;
        }
      }
    }
    return bestItem;
  }

  _solveGreedy(startKey, endKey) {
    this._ensureScratchBuffers();
    const size = this.grid.size;
    const wrap = this.grid.wrapWalls;
    const obstacles = this.grid.obstacles;
    const visited = this._scratchGreedyVisited;
    if (!visited) return [];
    visited.fill(0);
    visited[startKey] = 1;
    const reverseX = -this.snake.direction.x;
    const reverseY = -this.snake.direction.y;

    const endX = endKey % size;
    const endY = Math.floor(endKey / size);

    const path = [];
    let currentKey = startKey;
    let prevKey = -1;

    const maxSteps = Math.min(size * size, 512);
    for (let i = 0; i < maxSteps; i++) {
      if (currentKey === endKey) break;

      const cx = currentKey % size;
      const cy = Math.floor(currentKey / size);

      let bestNextKey = -1;
      let minDist = Infinity;

      for (const dir of MOVES) {
        if (currentKey === startKey && dir.x === reverseX && dir.y === reverseY) {
          continue;
        }

        let nx = cx + dir.x;
        let ny = cy + dir.y;

        if (wrap) {
          if (nx < 0) nx = size - 1;
          else if (nx >= size) nx = 0;

          if (ny < 0) ny = size - 1;
          else if (ny >= size) ny = 0;
        } else {
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
        }

        const nKey = ny * size + nx;
        if (nKey === prevKey) continue;
        if (visited[nKey]) continue;
        if (obstacles.has(nKey)) continue;
        if (this._dangerKeys.has(nKey)) continue;
        if (this._isSnakeOccupied(nx, ny)) continue;

        let dx = Math.abs(nx - endX);
        let dy = Math.abs(ny - endY);
        if (wrap) {
          dx = Math.min(dx, size - dx);
          dy = Math.min(dy, size - dy);
        }
        const dist = dx + dy;
        if (dist < minDist) {
          minDist = dist;
          bestNextKey = nKey;
        }
      }

      if (bestNextKey >= 0) {
        path.push(bestNextKey);
        visited[bestNextKey] = 1;
        prevKey = currentKey;
        currentKey = bestNextKey;
      } else {
        break;
      }
    }

    return path;
  }

  _solveBFS(startKey, endKey) {
    if (startKey === endKey) return [];

    this._ensureScratchBuffers();
    const size = this.grid.size;
    const wrap = this.grid.wrapWalls;
    const reverseX = -this.snake.direction.x;
    const reverseY = -this.snake.direction.y;

    const visited = this._scratchClosed;
    const parent = this._scratchParent;
    const queue = this._scratchQueueKeys;
    if (!visited || !parent || !queue) return [];

    visited.fill(0);
    visited[startKey] = 1;

    parent.fill(-1);

    const obstacles = this.grid.obstacles;
    let queueRead = 0;
    let queueWrite = 0;
    queue[queueWrite++] = startKey;

    while (queueRead < queueWrite) {
      const key = queue[queueRead++];
      if (key === endKey) {
        return this._reconstructPath(startKey, endKey, parent);
      }

      const x = key % size;
      const y = Math.floor(key / size);

      for (const dir of MOVES) {
        if (key === startKey && dir.x === reverseX && dir.y === reverseY) {
          continue;
        }

        let nx = x + dir.x;
        let ny = y + dir.y;

        if (wrap) {
          if (nx < 0) nx = size - 1;
          else if (nx >= size) nx = 0;

          if (ny < 0) ny = size - 1;
          else if (ny >= size) ny = 0;
        } else {
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
        }

        const nKey = ny * size + nx;
        if (visited[nKey]) continue;
        if (obstacles.has(nKey)) continue;
        if (this._dangerKeys.has(nKey)) continue;
        if (this._isSnakeOccupied(nx, ny)) continue;

        visited[nKey] = 1;
        parent[nKey] = key;
        queue[queueWrite++] = nKey;
      }
    }

    return [];
  }

  /**
   * @param {number} startKey
   * @param {number} endKey
   * @param {Int32Array} parent
   * @returns {number[]}
   */
  _reconstructPath(startKey, endKey, parent) {
    const path = [];
    let key = endKey;

    while (key !== -1 && key !== startKey) {
      path.push(key);
      key = parent[key];
    }

    path.reverse();
    return path;
  }

  _solveAStar(startKey, endKey) {
    if (startKey === endKey) return [];

    this._ensureScratchBuffers();
    const size = this.grid.size;
    const wrap = this.grid.wrapWalls;
    const obstacles = this.grid.obstacles;
    const reverseX = -this.snake.direction.x;
    const reverseY = -this.snake.direction.y;

    const endX = endKey % size;
    const endY = Math.floor(endKey / size);

    if (!this._aStarOpenSet) {
      this._aStarOpenSet = new MinHeap((a, b) => {
        const byF = a.f - b.f;
        return byF !== 0 ? byF : a.t - b.t;
      });
    }
    const openSet = this._aStarOpenSet;
    openSet.clear();
    this._aStarNodePoolIndex = 0;
    let ticket = 0;
    openSet.push(this._getAStarNode(startKey, 0, 0, ticket++));

    const parent = this._scratchParent;
    const gScore = this._scratchGScore;
    const closed = this._scratchClosed;
    if (!parent || !gScore || !closed) return [];

    parent.fill(-1);

    gScore.fill(0x7fffffff);
    gScore[startKey] = 0;

    closed.fill(0);

    while (openSet.size > 0) {
      const current = openSet.pop();
      if (!current) break;
      const key = current.key;
      if (closed[key]) continue;
      if (current.g !== gScore[key]) continue;

      if (key === endKey) {
        return this._reconstructPath(startKey, endKey, parent);
      }

      closed[key] = 1;

      const x = key % size;
      const y = Math.floor(key / size);

      for (const dir of MOVES) {
        if (key === startKey && dir.x === reverseX && dir.y === reverseY) {
          continue;
        }

        let nx = x + dir.x;
        let ny = y + dir.y;

        if (wrap) {
          if (nx < 0) nx = size - 1;
          else if (nx >= size) nx = 0;

          if (ny < 0) ny = size - 1;
          else if (ny >= size) ny = 0;
        } else {
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
        }

        const nKey = ny * size + nx;
        if (closed[nKey]) continue;
        if (obstacles.has(nKey)) continue;
        if (this._dangerKeys.has(nKey)) continue;
        if (this._isSnakeOccupied(nx, ny)) continue;

        const tentativeG = current.g + 1;
        if (tentativeG < gScore[nKey]) {
          gScore[nKey] = tentativeG;
          parent[nKey] = key;
          let dx = Math.abs(nx - endX);
          let dy = Math.abs(ny - endY);
          if (wrap) {
            dx = Math.min(dx, size - dx);
            dy = Math.min(dy, size - dy);
          }
          const h = dx + dy;
          const f = tentativeG + h;
          openSet.push(this._getAStarNode(nKey, f, tentativeG, ticket++));
        }
      }
    }
    return [];
  }

  _isReverse(dir) {
    const current = this.snake.direction;
    return current.x + dir.x === 0 && current.y + dir.y === 0;
  }

  _getDirectionToXY(fromX, fromY, toX, toY) {
    let dx = toX - fromX;
    let dy = toY - fromY;

    const halfSize = this.grid.size / 2;
    if (this.grid.wrapWalls) {
      if (dx > halfSize) dx -= this.grid.size;
      else if (dx < -halfSize) dx += this.grid.size;

      if (dy > halfSize) dy -= this.grid.size;
      else if (dy < -halfSize) dy += this.grid.size;
    }

    if (dx === 1) {
      return DIR_RIGHT;
    }
    if (dx === -1) {
      return DIR_LEFT;
    }
    if (dy === 1) {
      return DIR_DOWN;
    }
    if (dy === -1) {
      return DIR_UP;
    }
    return null;
  }
}
