// @ts-check

export const ReviewDirectionMask = Object.freeze({
  UP: 1,
  DOWN: 2,
  LEFT: 4,
  RIGHT: 8
});

const DEFAULT_DURATION_MS = 4000;
const DEFAULT_MAX_FRAMES = 128;
const DEFAULT_MAX_ITEMS = 8;

/**
 * @typedef {'up' | 'down' | 'left' | 'right'} ReviewDirectionId
 * @typedef {{x: number, y: number}} Point
 * @typedef {{
 *   allowed: boolean,
 *   reason: string | null,
 *   target: Point | null,
 *   normalizedTarget: Point | null
 * }} MoveInspection
 * @typedef {{
 *   timestampMs: number,
 *   bodyCells: Uint16Array | Uint32Array,
 *   items: Array<{
 *     x: number,
 *     y: number,
 *     type: string,
 *     id?: number,
 *     visualAttrs?: {sizeVar?: number, hueVar?: number, angleVar?: number, quirk?: number}
 *   }>,
 *   direction: ReviewDirectionId,
 *   snakeSkin: string,
 *   score: number,
 *   safeDirectionMask: number,
 *   attemptedDirection: ReviewDirectionId | null,
 *   attemptedTarget: Point | null,
 *   attemptedNormalizedTarget: Point | null,
 *   inspectionReason: string | null,
 *   stepDurationMs: number
 * }} DeathReviewFrame
 */

/**
 * @param {{x: number, y: number} | null | undefined} direction
 * @returns {ReviewDirectionId}
 */
export function directionToReviewId(direction) {
  if (direction?.x === 0 && direction.y === -1) return 'up';
  if (direction?.x === 0 && direction.y === 1) return 'down';
  if (direction?.x === -1 && direction.y === 0) return 'left';
  return 'right';
}

/**
 * @param {ReviewDirectionId | null | undefined} directionId
 * @returns {{x: number, y: number}}
 */
export function reviewIdToDirection(directionId) {
  switch (directionId) {
    case 'up':
      return { x: 0, y: -1 };
    case 'down':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    default:
      return { x: 1, y: 0 };
  }
}

/**
 * @param {{x: number, y: number}} direction
 * @returns {number}
 */
export function directionToMask(direction) {
  if (direction.x === 0 && direction.y === -1) return ReviewDirectionMask.UP;
  if (direction.x === 0 && direction.y === 1) return ReviewDirectionMask.DOWN;
  if (direction.x === -1 && direction.y === 0) return ReviewDirectionMask.LEFT;
  return ReviewDirectionMask.RIGHT;
}

export class DeathReviewRecorder {
  /**
   * @param {{durationMs?: number, maxFrames?: number, maxItems?: number}} [options]
   */
  constructor(options = {}) {
    const durationMs = Number.isFinite(options.durationMs)
      ? options.durationMs
      : DEFAULT_DURATION_MS;
    const maxFrames = Number.isFinite(options.maxFrames)
      ? options.maxFrames
      : DEFAULT_MAX_FRAMES;
    const maxItems = Number.isFinite(options.maxItems) ? options.maxItems : DEFAULT_MAX_ITEMS;

    this.durationMs = Math.max(500, Math.floor(durationMs));
    this.maxFrames = Math.max(2, Math.floor(maxFrames));
    this.maxItems = Math.max(1, Math.floor(maxItems));
    /** @type {Array<DeathReviewFrame | null>} */
    this._frames = new Array(this.maxFrames).fill(null);
    this.clear();
  }

  clear() {
    this._frames.fill(null);
    this._start = 0;
    this._count = 0;
    this._elapsedMs = 0;
    this._recording = false;
    this._cellArrayConstructor = Uint16Array;
    this._context = null;
    this._review = null;
  }

  /**
   * @param {{
   *   grid: {size: number, wrapWalls: boolean, obstacles: Set<number>},
   *   snake: {body: Point[], direction: Point},
   *   itemManager: {items: Array<Record<string, unknown>>},
   *   settings: {snakeSkin?: string},
   *   scoreManager: {score: number}
   * }} game
   */
  beginRun(game) {
    this.clear();
    const gridSize = Math.max(1, Math.floor(game.grid.size));
    const cellCount = gridSize * gridSize;
    this._cellArrayConstructor = cellCount <= 0xffff ? Uint16Array : Uint32Array;
    this._context = {
      gridSize,
      wrapWalls: Boolean(game.grid.wrapWalls),
      obstacleCells: new this._cellArrayConstructor([...game.grid.obstacles]),
      snakeSkin: game.settings.snakeSkin || 'classic'
    };
    this._recording = true;
    this.captureFrame(game, 0);
  }

  /**
   * @param {{
   *   grid: {size: number},
   *   snake: {body: Point[], direction: Point},
   *   itemManager: {items: Array<Record<string, unknown>>},
   *   settings: {snakeSkin?: string},
   *   scoreManager: {score: number}
   * }} game
   * @param {number} elapsedSincePreviousMs
   */
  captureFrame(game, elapsedSincePreviousMs) {
    if (!this._recording || !this._context) return;

    const elapsed = Number.isFinite(elapsedSincePreviousMs)
      ? Math.max(0, elapsedSincePreviousMs)
      : 0;
    this._elapsedMs += elapsed;

    const bodyCells = new this._cellArrayConstructor(game.snake.body.length);
    for (let index = 0; index < game.snake.body.length; index++) {
      const segment = game.snake.body[index];
      bodyCells[index] = segment.y * game.grid.size + segment.x;
    }

    const items = [];
    const sourceItems = Array.isArray(game.itemManager.items) ? game.itemManager.items : [];
    const itemCount = Math.min(sourceItems.length, this.maxItems);
    for (let index = 0; index < itemCount; index++) {
      const item = sourceItems[index];
      if (!item || typeof item !== 'object') continue;
      const attrs =
        item.visualAttrs && typeof item.visualAttrs === 'object'
          ? /** @type {Record<string, unknown>} */ (item.visualAttrs)
          : null;
      items.push({
        x: Number(item.x) || 0,
        y: Number(item.y) || 0,
        type: typeof item.type === 'string' ? item.type : '',
        id: typeof item.id === 'number' ? item.id : undefined,
        visualAttrs: attrs
          ? {
              sizeVar: typeof attrs.sizeVar === 'number' ? attrs.sizeVar : undefined,
              hueVar: typeof attrs.hueVar === 'number' ? attrs.hueVar : undefined,
              angleVar: typeof attrs.angleVar === 'number' ? attrs.angleVar : undefined,
              quirk: typeof attrs.quirk === 'number' ? attrs.quirk : undefined
            }
          : undefined
      });
    }

    /** @type {DeathReviewFrame} */
    const frame = {
      timestampMs: this._elapsedMs,
      bodyCells,
      items,
      direction: directionToReviewId(game.snake.direction),
      snakeSkin: game.settings.snakeSkin || 'classic',
      score: Number.isFinite(game.scoreManager.score) ? game.scoreManager.score : 0,
      safeDirectionMask: 0,
      attemptedDirection: null,
      attemptedTarget: null,
      attemptedNormalizedTarget: null,
      inspectionReason: null,
      stepDurationMs: 0
    };

    this._pushFrame(frame);
    this._trimToDuration();
  }

  /**
   * Attach the decision that will be executed from the most recent snapshot.
   * @param {{
   *   attemptedDirection: Point,
   *   safeDirectionMask: number,
   *   inspection: MoveInspection,
   *   stepDurationMs: number
   * }} decision
   */
  markDecision(decision) {
    if (!this._recording || this._count === 0) return;
    const frame = this._latestFrame();
    if (!frame) return;

    frame.attemptedDirection = directionToReviewId(decision.attemptedDirection);
    frame.safeDirectionMask = Math.max(0, Math.floor(decision.safeDirectionMask));
    frame.attemptedTarget = clonePoint(decision.inspection.target);
    frame.attemptedNormalizedTarget = clonePoint(decision.inspection.normalizedTarget);
    frame.inspectionReason = decision.inspection.reason;
    frame.stepDurationMs = Number.isFinite(decision.stepDurationMs)
      ? Math.max(0, decision.stepDurationMs)
      : 0;
  }

  /**
   * @param {string} reason
   * @returns {ReturnType<DeathReviewRecorder['getReview']>}
   */
  finish(reason) {
    if (!this._recording || !this._context || this._count === 0) {
      return this._review;
    }
    this._recording = false;

    const orderedFrames = this._orderedFrames();
    const firstTimestamp = orderedFrames[0]?.timestampMs ?? 0;
    const frames = orderedFrames.map((frame) => ({
      ...frame,
      timestampMs: frame.timestampMs - firstTimestamp
    }));
    const finalFrame = frames[frames.length - 1];
    const durationMs = Math.max(
      finalFrame?.timestampMs ?? 0,
      (finalFrame?.timestampMs ?? 0) + (finalFrame?.stepDurationMs ?? 0)
    );

    this._review = {
      version: 1,
      gridSize: this._context.gridSize,
      wrapWalls: this._context.wrapWalls,
      obstacleCells: this._context.obstacleCells,
      snakeSkin: finalFrame?.snakeSkin ?? this._context.snakeSkin,
      frames,
      durationMs,
      death: {
        reason: reason || 'unknown',
        attemptedDirection: finalFrame?.attemptedDirection ?? finalFrame?.direction ?? 'right',
        target: clonePoint(finalFrame?.attemptedTarget),
        normalizedTarget: clonePoint(finalFrame?.attemptedNormalizedTarget),
        safeDirectionMask: finalFrame?.safeDirectionMask ?? 0,
        stepDurationMs: finalFrame?.stepDurationMs ?? 0
      }
    };
    return this._review;
  }

  getReview() {
    return this._review;
  }

  /** @param {DeathReviewFrame} frame */
  _pushFrame(frame) {
    if (this._count === this.maxFrames) {
      this._frames[this._start] = frame;
      this._start = (this._start + 1) % this.maxFrames;
      return;
    }

    const index = (this._start + this._count) % this.maxFrames;
    this._frames[index] = frame;
    this._count++;
  }

  _trimToDuration() {
    while (this._count > 1) {
      const oldest = this._frames[this._start];
      const latest = this._latestFrame();
      if (!oldest || !latest || latest.timestampMs - oldest.timestampMs <= this.durationMs) break;
      this._frames[this._start] = null;
      this._start = (this._start + 1) % this.maxFrames;
      this._count--;
    }
  }

  /** @returns {DeathReviewFrame | null} */
  _latestFrame() {
    if (this._count === 0) return null;
    const index = (this._start + this._count - 1) % this.maxFrames;
    return this._frames[index];
  }

  /** @returns {DeathReviewFrame[]} */
  _orderedFrames() {
    const frames = [];
    for (let offset = 0; offset < this._count; offset++) {
      const frame = this._frames[(this._start + offset) % this.maxFrames];
      if (frame) frames.push(frame);
    }
    return frames;
  }
}

/**
 * @param {Point | null | undefined} point
 * @returns {Point | null}
 */
function clonePoint(point) {
  if (!point) return null;
  return { x: point.x, y: point.y };
}
