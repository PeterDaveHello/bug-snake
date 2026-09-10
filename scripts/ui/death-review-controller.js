// @ts-check
import { ReviewDirectionMask, reviewIdToDirection } from '../core/death-review-recorder.js';
import { game } from '../core/game.js';
import { Grid } from '../core/grid.js';
import { i18n } from '../i18n/i18n.js';

const PLAYBACK_RATE = 0.5;
const ACCENT_COLOR = '#f72585';
const SAFE_COLOR = '#4cc9f0';
const DAILY_ACTIVE_CLASS = 'daily-challenge-active';

/**
 * @typedef {'up' | 'down' | 'left' | 'right'} ReviewDirectionId
 * @typedef {{x: number, y: number}} Point
 * @typedef {{
 *   timestampMs: number,
 *   bodyCells: Uint16Array | Uint32Array,
 *   items: Array<Record<string, unknown>>,
 *   direction: ReviewDirectionId,
 *   snakeSkin: string,
 *   score: number,
 *   safeDirectionMask: number
 * }} ReviewFrame
 * @typedef {{
 *   version: number,
 *   gridSize: number,
 *   wrapWalls: boolean,
 *   obstacleCells: Uint16Array | Uint32Array,
 *   snakeSkin: string,
 *   frames: ReviewFrame[],
 *   durationMs: number,
 *   death: {
 *     reason: string,
 *     attemptedDirection: ReviewDirectionId,
 *     target: Point | null,
 *     normalizedTarget: Point | null,
 *     safeDirectionMask: number,
 *     stepDurationMs: number
 *   }
 * }} DeathReview
 * @typedef {{
 *   grid: Grid,
 *   itemManager: {items: Array<Record<string, unknown>>},
 *   snake: {body: Point[], prevBody: Point[], direction: Point},
 *   settings: {snakeSkin: string},
 *   gameMode: string,
 *   scoreManager: {score: number, highScore: number},
 *   waitingForInput: boolean
 * }} ReviewScene
 */

export class DeathReviewController {
  /**
   * @param {{
   *   showScreen: (id: string) => void,
   *   hideScreen: (id: string) => void,
   *   restart: (randomize: boolean) => void
   * }} hooks
   */
  constructor(hooks) {
    this.hooks = hooks;
    /** @type {DeathReview | null} */
    this.review = null;
    this.active = false;
    this.playing = false;
    this.positionMs = 0;
    this._lastAnimationAt = 0;
    this._animationFrame = 0;
    this._renderedFrameIndex = -1;
    /** @type {Point[]} */
    this._decodedBody = [];
    /** @type {ReviewScene | null} */
    this._scene = null;
    /** @type {Record<string, HTMLElement>} */
    this.elements = {};
    this._keydownHandler = this._handleKeydown.bind(this);
    this._visibilityHandler = this._handleVisibilityChange.bind(this);
    this._resizeHandler = this._handleResize.bind(this);
  }

  init() {
    for (const id of [
      'btn-open-death-review',
      'game-over-review-summary',
      'death-review-screen',
      'death-review-title',
      'death-review-summary',
      'death-review-time',
      'death-review-timeline',
      'btn-death-review-previous',
      'btn-death-review-play',
      'btn-death-review-next',
      'btn-death-review-back',
      'btn-death-review-restart',
      'btn-death-review-random'
    ]) {
      const element = document.getElementById(id);
      if (element instanceof HTMLElement) this.elements[id] = element;
    }

    this.elements['btn-open-death-review']?.addEventListener('click', () => this.open());
    this.elements['btn-death-review-previous']?.addEventListener('click', () => this._step(-1));
    this.elements['btn-death-review-play']?.addEventListener('click', () => this._togglePlayback());
    this.elements['btn-death-review-next']?.addEventListener('click', () => this._step(1));
    this.elements['btn-death-review-back']?.addEventListener('click', () => this.close(true));
    this.elements['btn-death-review-restart']?.addEventListener('click', () => this.restart(false));
    this.elements['btn-death-review-random']?.addEventListener('click', () => this.restart(true));

    const timeline = this.elements['death-review-timeline'];
    if (timeline instanceof HTMLInputElement) {
      timeline.addEventListener('input', () => {
        this._setPlaying(false);
        this.positionMs = Number(timeline.value) || 0;
        this._render();
      });
    }

    window.addEventListener('keydown', this._keydownHandler, true);
    window.addEventListener('resize', this._resizeHandler);
    document.addEventListener('visibilitychange', this._visibilityHandler);
    this.updateUIText();
    this.setReview(null);
  }

  /** @param {DeathReview | null | undefined} review */
  setReview(review) {
    if (this.active) this.close(false);
    this.review = review && review.frames.length > 0 ? review : null;
    const available = Boolean(this.review);
    const openButton = this.elements['btn-open-death-review'];
    const summary = this.elements['game-over-review-summary'];
    if (openButton instanceof HTMLButtonElement) {
      openButton.hidden = !available;
      openButton.disabled = !available;
    }
    if (summary) {
      summary.hidden = !available;
      summary.textContent = available ? this._buildDecisionSummary() : '';
    }
  }

  open() {
    if (this.active) return;
    if (!this.review || this.review.frames.length === 0) {
      game.showToast(i18n.t('review.unavailable'));
      return;
    }
    this.active = true;
    document.body.classList.add('death-review-active');
    this._prepareScene();

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.positionMs = reduceMotion ? this.review.durationMs : 0;
    this._setPlaying(!reduceMotion);

    // Review is a subview of the GAME_OVER result flow. Keep the death mix
    // ducked while swapping result overlays; only a real result-flow exit
    // (restart, close, or return to title) restores normal audio.
    // Shared overlay code owns autofocus so this controller does not compete
    // with it using a second timer.
    this.hooks.showScreen('death-review-screen');
    this.hooks.hideScreen('game-over-screen');
    this.updateUIText();
    this._render();
  }

  /** @param {boolean} [showResult] */
  close(showResult = true) {
    if (!this.active) return;
    this._setPlaying(false);
    this.active = false;
    document.body.classList.remove('death-review-active');

    if (showResult) {
      // Returning to the result screen is still inside the same ducked
      // GAME_OVER flow, so this handoff deliberately does not touch audio.
      this.hooks.showScreen('game-over-screen');
    }
    this.hooks.hideScreen('death-review-screen');
    game._render(1);
  }

  dismiss() {
    this.close(false);
  }

  /** @param {boolean} randomize */
  restart(randomize) {
    if (!this.active) return;
    const safeRandomize = randomize && !this._isDailyChallengeActive();
    this.close(false);
    this.hooks.restart(safeRandomize);
  }

  updateUIText() {
    setText('death-review-title', i18n.t('review.title'));
    setText('btn-open-death-review', i18n.t('review.open'));
    setText('btn-death-review-previous', i18n.t('review.previousFrame'));
    setText('btn-death-review-next', i18n.t('review.nextFrame'));
    setText('btn-death-review-back', i18n.t('review.backToResult'));
    setText('btn-death-review-restart', i18n.t('review.restartCurrent'));
    setText('btn-death-review-random', i18n.t('review.restartRandom'));
    setText('death-review-collision-label', i18n.t('review.collisionMarker'));
    setText('death-review-safe-label', i18n.t('review.safeMarker'));
    this._updateRestartAvailability();

    const timeline = this.elements['death-review-timeline'];
    if (timeline instanceof HTMLInputElement) {
      timeline.setAttribute('aria-label', i18n.t('review.timeline'));
    }
    const summary = this.elements['game-over-review-summary'];
    if (summary && this.review) summary.textContent = this._buildDecisionSummary();
    this._updatePlaybackUI();
  }

  _isDailyChallengeActive() {
    return document.body.classList.contains(DAILY_ACTIVE_CLASS);
  }

  _updateRestartAvailability() {
    const randomButton = this.elements['btn-death-review-random'];
    if (!(randomButton instanceof HTMLButtonElement)) return;
    const locked = this._isDailyChallengeActive();
    randomButton.hidden = locked;
    randomButton.disabled = locked;
  }

  _prepareScene() {
    if (!this.review) return;
    const grid = new Grid(this.review.gridSize, this.review.wrapWalls);
    grid.obstacles = new Set(this.review.obstacleCells);
    this._scene = {
      grid,
      itemManager: { items: [] },
      snake: { body: [], prevBody: [], direction: { x: 1, y: 0 } },
      settings: { snakeSkin: this.review.snakeSkin },
      gameMode: 'review',
      scoreManager: { score: 0, highScore: 0 },
      waitingForInput: false
    };
    this._renderedFrameIndex = -1;
    this._decodedBody = [];
  }

  /** @param {boolean} playing */
  _setPlaying(playing) {
    const next = Boolean(playing && this.active && this.review);
    if (this.playing === next) {
      this._updatePlaybackUI();
      return;
    }
    this.playing = next;
    this._lastAnimationAt = 0;
    if (this._animationFrame) {
      cancelAnimationFrame(this._animationFrame);
      this._animationFrame = 0;
    }
    if (next) {
      this._animationFrame = requestAnimationFrame((now) => this._tick(now));
    }
    this._updatePlaybackUI();
  }

  _togglePlayback() {
    if (!this.review || !this.active) return;
    if (this.playing) {
      this._setPlaying(false);
      return;
    }
    if (this.positionMs >= this.review.durationMs) this.positionMs = 0;
    this._setPlaying(true);
  }

  /** @param {number} now */
  _tick(now) {
    this._animationFrame = 0;
    if (!this.active || !this.playing || !this.review) return;
    if (!this._lastAnimationAt) this._lastAnimationAt = now;
    const elapsed = Math.min(100, Math.max(0, now - this._lastAnimationAt));
    this._lastAnimationAt = now;
    this.positionMs = Math.min(this.review.durationMs, this.positionMs + elapsed * PLAYBACK_RATE);
    this._render();
    if (this.positionMs >= this.review.durationMs) {
      this._setPlaying(false);
      return;
    }
    this._animationFrame = requestAnimationFrame((nextNow) => this._tick(nextNow));
  }

  /** @param {number} delta */
  _step(delta) {
    if (!this.review || !this.active) return;
    this._setPlaying(false);
    const currentIndex = this._frameIndexAt(this.positionMs);
    const nextIndex = Math.max(0, Math.min(this.review.frames.length - 1, currentIndex + delta));
    this.positionMs =
      delta > 0 && nextIndex === this.review.frames.length - 1
        ? this.review.durationMs
        : this.review.frames[nextIndex].timestampMs;
    this._render();
  }

  _render() {
    if (!this.review || !this._scene) return;
    const frameIndex = this._frameIndexAt(this.positionMs);
    const frame = this.review.frames[frameIndex];
    if (!frame) return;

    if (frameIndex !== this._renderedFrameIndex) {
      this._decodedBody = decodeBody(frame.bodyCells, this.review.gridSize);
      this._scene.snake.body = this._decodedBody;
      this._scene.snake.prevBody = this._decodedBody;
      this._scene.snake.direction = reviewIdToDirection(frame.direction);
      this._scene.itemManager.items = frame.items;
      this._scene.settings.snakeSkin = frame.snakeSkin || this.review.snakeSkin;
      this._scene.scoreManager.score = frame.score;
      this._renderedFrameIndex = frameIndex;
    }

    game.renderer.render(this._scene, 1, this.positionMs);
    this._drawDecisionOverlay(frame);
    this._updatePlaybackUI();
  }

  /** @param {ReviewFrame} frame */
  _drawDecisionOverlay(frame) {
    if (!this.review || this._decodedBody.length === 0) return;
    const revealAt = Math.max(0, this.review.durationMs - this.review.death.stepDurationMs);
    if (this.positionMs + 0.5 < revealAt) return;

    const renderer = game.renderer;
    const ctx = renderer.ctx;
    const head = this._decodedBody[0];
    const centerX = renderer.offsetX + (head.x + 0.5) * renderer.cellSize;
    const centerY = renderer.offsetY + (head.y + 0.5) * renderer.cellSize;
    const pulse = 0.72 + 0.28 * Math.sin(this.positionMs * 0.012);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = pulse;

    const safeDirections = /** @type {Array<[number, Point]>} */ ([
      [ReviewDirectionMask.UP, { x: 0, y: -1 }],
      [ReviewDirectionMask.DOWN, { x: 0, y: 1 }],
      [ReviewDirectionMask.LEFT, { x: -1, y: 0 }],
      [ReviewDirectionMask.RIGHT, { x: 1, y: 0 }]
    ]);
    for (const [mask, direction] of safeDirections) {
      if ((frame.safeDirectionMask & mask) === 0) continue;
      const length = renderer.cellSize * 0.34;
      drawArrow(
        ctx,
        centerX,
        centerY,
        centerX + direction.x * length,
        centerY + direction.y * length,
        SAFE_COLOR,
        Math.max(2, renderer.cellSize * 0.09)
      );
    }

    const attempted = reviewIdToDirection(this.review.death.attemptedDirection);
    const attemptedLength = renderer.cellSize * 0.48;
    drawArrow(
      ctx,
      centerX,
      centerY,
      centerX + attempted.x * attemptedLength,
      centerY + attempted.y * attemptedLength,
      ACCENT_COLOR,
      Math.max(2.5, renderer.cellSize * 0.11)
    );

    const rawTarget = this.review.death.target;
    const normalizedTarget = this.review.death.normalizedTarget;
    const target = normalizedTarget || rawTarget;
    if (target) {
      const marker = getCollisionMarkerRect(
        renderer,
        this.review.gridSize,
        rawTarget || target,
        normalizedTarget
      );
      ctx.fillStyle = 'rgba(247, 37, 133, 0.2)';
      ctx.strokeStyle = ACCENT_COLOR;
      ctx.lineWidth = Math.max(2, renderer.cellSize * 0.09);
      ctx.fillRect(marker.x, marker.y, marker.width, marker.height);
      ctx.strokeRect(marker.x, marker.y, marker.width, marker.height);
      ctx.beginPath();
      ctx.moveTo(marker.x, marker.y);
      ctx.lineTo(marker.x + marker.width, marker.y + marker.height);
      ctx.moveTo(marker.x + marker.width, marker.y);
      ctx.lineTo(marker.x, marker.y + marker.height);
      ctx.stroke();
    }

    ctx.restore();
  }

  _updatePlaybackUI() {
    const review = this.review;
    const timeline = this.elements['death-review-timeline'];
    if (timeline instanceof HTMLInputElement) {
      const maximum = review ? Math.max(0, Math.round(review.durationMs)) : 0;
      timeline.max = String(maximum);
      timeline.value = String(Math.min(maximum, Math.max(0, Math.round(this.positionMs))));
      timeline.disabled = !review;
    }

    const remainingSeconds = review ? Math.max(0, review.durationMs - this.positionMs) / 1000 : 0;
    const timeText = i18n.t('review.timeBeforeCollision', {
      seconds: remainingSeconds.toFixed(1)
    });
    setText('death-review-time', timeText);
    if (timeline instanceof HTMLInputElement) timeline.setAttribute('aria-valuetext', timeText);

    const summary = this.elements['death-review-summary'];
    if (summary) {
      const nextSummary = review ? this._buildDecisionSummary() : '';
      if (summary.textContent !== nextSummary) summary.textContent = nextSummary;
    }

    const playButton = this.elements['btn-death-review-play'];
    if (playButton instanceof HTMLButtonElement) {
      const atEnd = Boolean(review && this.positionMs >= review.durationMs);
      const key = this.playing ? 'review.pause' : atEnd ? 'review.replay' : 'review.play';
      const label = i18n.t(key);
      playButton.textContent = label;
      playButton.setAttribute('aria-label', label);
      playButton.setAttribute('aria-pressed', String(this.playing));
      playButton.disabled = !review;
    }
  }

  _buildDecisionSummary() {
    if (!this.review) return '';
    const direction = i18n.t(`review.direction.${this.review.death.attemptedDirection}`);
    const translatedReason = i18n.t(`deathReason.${this.review.death.reason}`);
    const reason = translatedReason.startsWith('[[')
      ? ''
      : i18n.t('ui.gameOverReason', { reason: translatedReason });
    const lastDirection = i18n.t('review.lastDirection', { direction });
    const mask = this.review.death.safeDirectionMask;
    const directions = this._directionLabels(mask);
    const advice = directions.length
      ? i18n.t('review.safeDirections', { directions: formatList(directions) })
      : i18n.t('review.noSafeDirection');
    return [reason, lastDirection, advice].filter(Boolean).join(' ');
  }

  /** @param {number} mask @returns {string[]} */
  _directionLabels(mask) {
    const labels = [];
    if (mask & ReviewDirectionMask.UP) labels.push(i18n.t('review.direction.up'));
    if (mask & ReviewDirectionMask.DOWN) labels.push(i18n.t('review.direction.down'));
    if (mask & ReviewDirectionMask.LEFT) labels.push(i18n.t('review.direction.left'));
    if (mask & ReviewDirectionMask.RIGHT) labels.push(i18n.t('review.direction.right'));
    return labels;
  }

  /** @param {number} positionMs @returns {number} */
  _frameIndexAt(positionMs) {
    if (!this.review || this.review.frames.length === 0) return 0;
    let low = 0;
    let high = this.review.frames.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.review.frames[middle].timestampMs <= positionMs) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  }

  /** @param {KeyboardEvent} event */
  _handleKeydown(event) {
    if (!this.active) return;
    const target = event.target;
    const onControl =
      target instanceof HTMLButtonElement ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement;
    if (onControl && event.key !== 'Escape') {
      // Keep each control's browser-native key behavior while preventing the
      // gameplay input listener from consuming the same event.
      event.stopImmediatePropagation();
      return;
    }

    const normalizedKey = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    let handled = true;

    switch (event.key) {
      case 'Escape':
        this.close(true);
        break;
      case ' ':
        this._togglePlayback();
        break;
      case 'ArrowLeft':
        this._step(-1);
        break;
      case 'ArrowRight':
        this._step(1);
        break;
      case 'Home':
        this._setPlaying(false);
        this.positionMs = 0;
        this._render();
        break;
      case 'End':
        this._setPlaying(false);
        if (this.review) this.positionMs = this.review.durationMs;
        this._render();
        break;
      default:
        if (
          normalizedKey === 'r' &&
          !event.repeat &&
          !event.isComposing &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          this.restart(event.shiftKey);
        } else {
          handled = false;
        }
    }

    if (handled) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  _handleVisibilityChange() {
    if (this.active && document.hidden) this._setPlaying(false);
  }

  _handleResize() {
    if (!this.active) return;
    requestAnimationFrame(() => {
      if (this.active) this._render();
    });
  }
}

/** @param {Uint16Array | Uint32Array} cells @param {number} size @returns {Point[]} */
function decodeBody(cells, size) {
  const body = new Array(cells.length);
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    body[index] = { x: cell % size, y: Math.floor(cell / size) };
  }
  return body;
}

/** @param {string[]} values @returns {string} */
function formatList(values) {
  try {
    return new Intl.ListFormat(i18n.locale, { style: 'short', type: 'disjunction' }).format(values);
  } catch {
    return values.join(', ');
  }
}

/** @param {string} id @param {string} text */
function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

/**
 * Keep wall-death markers attached to the crossed board edge instead of
 * clamping them into the snake's final cell.
 * @param {{offsetX: number, offsetY: number, cellSize: number}} renderer
 * @param {number} gridSize
 * @param {Point} rawTarget
 * @param {Point | null} normalizedTarget
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function getCollisionMarkerRect(renderer, gridSize, rawTarget, normalizedTarget) {
  const cellSize = renderer.cellSize;
  const boardMaxX = renderer.offsetX + gridSize * cellSize;
  const boardMaxY = renderer.offsetY + gridSize * cellSize;
  const outsideGrid =
    !normalizedTarget &&
    (rawTarget.x < 0 ||
      rawTarget.x >= gridSize ||
      rawTarget.y < 0 ||
      rawTarget.y >= gridSize);

  if (outsideGrid) {
    const markerSize = Math.max(10, cellSize * 0.56);
    const clampedCellX = Math.max(0, Math.min(gridSize - 1, rawTarget.x));
    const clampedCellY = Math.max(0, Math.min(gridSize - 1, rawTarget.y));
    let x = renderer.offsetX + (clampedCellX + 0.5) * cellSize - markerSize / 2;
    let y = renderer.offsetY + (clampedCellY + 0.5) * cellSize - markerSize / 2;

    if (rawTarget.x < 0) x = renderer.offsetX;
    if (rawTarget.x >= gridSize) x = boardMaxX - markerSize;
    if (rawTarget.y < 0) y = renderer.offsetY;
    if (rawTarget.y >= gridSize) y = boardMaxY - markerSize;

    return { x, y, width: markerSize, height: markerSize };
  }

  const target = normalizedTarget || rawTarget;
  const inset = Math.max(2, cellSize * 0.12);
  return {
    x: renderer.offsetX + target.x * cellSize + inset,
    y: renderer.offsetY + target.y * cellSize + inset,
    width: cellSize - inset * 2,
    height: cellSize - inset * 2
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 * @param {string} color
 * @param {number} width
 */
function drawArrow(ctx, fromX, fromY, toX, toY, color, width) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const headSize = Math.max(5, width * 2.4);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headSize * Math.cos(angle - Math.PI / 6),
    toY - headSize * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    toX - headSize * Math.cos(angle + Math.PI / 6),
    toY - headSize * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}
