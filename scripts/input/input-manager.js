// @ts-check
export const Direction = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 }
};

export class InputManager {
  constructor() {
    this._queue = [null, null];
    this._queueLen = 0;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this._activeCanvasTouchId = null;
    this.minSwipeDistance = 30;
    this.boostActive = false;
    this.heldDirection = null;
    this._lastDirectionInputAt = 0;
    /** @type {Map<'up' | 'down' | 'left' | 'right', number>} */
    this._heldDirectionSince = new Map();
    this._allowDirectionRepeatAfterBlur = false;
    this._windowBlurHandler = this._handleWindowBlur.bind(this);
    this._windowFocusHandler = this._handleWindowFocus.bind(this);

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      this._bindKeyboard();
      this._bindTouch();
      this._bindDpad();
    }
  }

  get directionQueue() {
    const arr = [];
    for (let i = 0; i < this._queueLen; i++) {
      arr.push(this._queue[i]);
    }
    return arr;
  }

  enqueueDirection(dir) {
    const last = this._queueLen > 0 ? this._queue[this._queueLen - 1] : null;
    const currentIntent = last || this.heldDirection;
    if (currentIntent && currentIntent.x === dir.x && currentIntent.y === dir.y) return;

    if (currentIntent && currentIntent.x + dir.x === 0 && currentIntent.y + dir.y === 0) {
      if (last) {
        this._queue[this._queueLen - 1] = dir;
        this._lastDirectionInputAt = Date.now();
        return;
      }
    }

    if (this._queueLen >= 2) {
      this._queue[0] = dir;
      this._queue[1] = null;
      this._queueLen = 1;
      this._lastDirectionInputAt = Date.now();
      return;
    }

    this._queue[this._queueLen] = dir;
    this._queueLen++;
    this._lastDirectionInputAt = Date.now();
  }

  hasQueuedDirection() {
    return this._queueLen > 0;
  }

  getNextDirection() {
    if (this._queueLen === 0) return null;
    const dir = this._queue[0];
    this._queue[0] = this._queue[1];
    this._queue[1] = null;
    this._queueLen--;
    return dir;
  }

  clearQueue() {
    this._queue[0] = null;
    this._queue[1] = null;
    this._queueLen = 0;
  }

  isBoostActive() {
    return this.boostActive;
  }

  getLastDirectionInputAt() {
    return this._lastDirectionInputAt;
  }

  /**
   * @param {{x: number, y: number} | null} dir
   * @returns {'up' | 'down' | 'left' | 'right' | null}
   */
  _directionIdFromDir(dir) {
    if (!dir) return null;
    if (dir.x === 0 && dir.y === -1) return 'up';
    if (dir.x === 0 && dir.y === 1) return 'down';
    if (dir.x === -1 && dir.y === 0) return 'left';
    if (dir.x === 1 && dir.y === 0) return 'right';
    return null;
  }

  /**
   * True when holding the current direction long enough to enable straight boost.
   * @param {{x: number, y: number} | null} snakeDir
   * @returns {boolean}
   */
  isHoldingCurrentDirection(snakeDir) {
    if (!snakeDir) return false;
    if (this._queueLen > 0) return false;

    const id = this._directionIdFromDir(snakeDir);
    if (!id) return false;

    if (this._heldDirectionSince.size !== 1) return false;
    const since = this._heldDirectionSince.get(id);
    if (typeof since !== 'number') return false;

    return Date.now() - since > 150;
  }

  /**
   * True when holding any single direction key long enough (for AI-mode boost).
   * @returns {boolean}
   */
  isHoldingAnyDirection() {
    if (this._queueLen > 0) return false;
    if (this._heldDirectionSince.size !== 1) return false;
    const since = this._heldDirectionSince.values().next().value;
    if (typeof since !== 'number') return false;
    return Date.now() - since > 150;
  }

  /**
   * @param {'up' | 'down' | 'left' | 'right'} dirId
   * @returns {{x: number, y: number}}
   */
  _directionFromId(dirId) {
    switch (dirId) {
      case 'up':
        return Direction.UP;
      case 'down':
        return Direction.DOWN;
      case 'left':
        return Direction.LEFT;
      case 'right':
        return Direction.RIGHT;
    }
  }

  /**
   * @param {string} key
   * @returns {{ dir: {x: number, y: number}, id: 'up' | 'down' | 'left' | 'right' } | null}
   */
  _directionFromKey(key) {
    switch (key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
      case 'z':
      case 'Z':
        return { dir: Direction.UP, id: 'up' };
      case 'ArrowDown':
      case 's':
      case 'S':
        return { dir: Direction.DOWN, id: 'down' };
      case 'ArrowLeft':
      case 'a':
      case 'A':
      case 'q':
      case 'Q':
        return { dir: Direction.LEFT, id: 'left' };
      case 'ArrowRight':
      case 'd':
      case 'D':
        return { dir: Direction.RIGHT, id: 'right' };
      default:
        return null;
    }
  }

  /**
   * @returns {{ dir: {x: number, y: number}, since: number } | null}
   */
  _getMostRecentHeldDirection() {
    let bestId = null;
    let bestSince = -1;
    for (const [id, since] of this._heldDirectionSince.entries()) {
      if (since > bestSince) {
        bestSince = since;
        bestId = id;
      }
    }
    if (!bestId) return null;
    return { dir: this._directionFromId(bestId), since: bestSince };
  }

  /**
   * @param {{x: number, y: number}} dir
   * @param {'up' | 'down' | 'left' | 'right' | null} dirId
   * @param {number} [since]
   * @param {boolean} [preserveExistingSince]
   * @returns {void}
   */
  _setDirectionHold(dir, dirId, since = Date.now(), preserveExistingSince = false) {
    if (!dirId) return;
    let heldSince = since;
    if (preserveExistingSince) {
      const existingSince = this._heldDirectionSince.get(dirId);
      if (typeof existingSince === 'number') {
        heldSince = existingSince;
      }
    }
    this._heldDirectionSince.set(dirId, heldSince);
    this._setHeldDirection(dir, heldSince);
  }

  /**
   * @param {'up' | 'down' | 'left' | 'right' | null} dirId
   * @returns {void}
   */
  _clearDirectionHold(dirId) {
    if (!dirId) return;
    this._heldDirectionSince.delete(dirId);
    const next = this._getMostRecentHeldDirection();
    if (next) {
      this._setHeldDirection(next.dir, next.since);
    } else {
      this.heldDirection = null;
    }
  }

  /**
   * @param {string} key
   * @returns {boolean} True when key is a direction key.
   */
  _handleDirectionKeyDown(key) {
    const resolved = this._directionFromKey(key);
    if (!resolved) return false;

    const holdSince = Date.now();
    this.enqueueDirection(resolved.dir);
    this._setDirectionHold(resolved.dir, resolved.id, holdSince, true);
    return true;
  }

  /**
   * @param {string} key
   * @returns {boolean} True when key is a direction key.
   */
  _handleDirectionKeyUp(key) {
    const resolved = this._directionFromKey(key);
    if (!resolved) return false;

    this._clearDirectionHold(resolved.id);
    return true;
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }

      // Boost with space
      if (e.key === ' ') {
        e.preventDefault();
        this.boostActive = true;
        return;
      }

      const isDirectionKey = !!this._directionFromKey(e.key);
      if (isDirectionKey) {
        e.preventDefault();
      }
      if (e.repeat && !this._allowDirectionRepeatAfterBlur) return;
      if (e.repeat && this._allowDirectionRepeatAfterBlur) {
        this._allowDirectionRepeatAfterBlur = false;
      }

      void this._handleDirectionKeyDown(e.key);
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        this.boostActive = false;
      }
      void this._handleDirectionKeyUp(e.key);
    });

    window.addEventListener('blur', this._windowBlurHandler);

    window.addEventListener('focus', this._windowFocusHandler);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this._clearInputState();
      }
    });
  }

  _handleWindowBlur() {
    this._clearInputState();
  }

  _handleWindowFocus() {
    this._clearInputState();
  }

  _clearInputState() {
    this.boostActive = false;
    this.heldDirection = null;
    this._heldDirectionSince.clear();
    this._activeCanvasTouchId = null;
    this._allowDirectionRepeatAfterBlur = true;
  }

  _setHeldDirection(dir, since = Date.now()) {
    if (!this.heldDirection || this.heldDirection.x !== dir.x || this.heldDirection.y !== dir.y) {
      this.heldDirection = dir;
      void since;
    }
  }

  _bindTouch() {
    const gameContainer = document.getElementById('game-container');
    if (!gameContainer) return;
    const gameCanvas = document.getElementById('game-canvas');

    const shouldIgnoreTouch = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(
        target.closest(
          '#controls-panel, #mobile-controls, #seo-content, .lil-gui, button, input, select, textarea, label'
        )
      );
    };

    /**
     * @param {TouchList} touchList
     * @param {number} touchId
     * @returns {Touch | null}
     */
    const findTouchById = (touchList, touchId) => {
      for (let i = 0; i < touchList.length; i++) {
        const touch = touchList[i];
        if (touch.identifier === touchId) return touch;
      }
      return null;
    };

    gameContainer.addEventListener(
      'touchstart',
      (e) => {
        if (shouldIgnoreTouch(e.target)) return;
        if (gameCanvas && e.target !== gameCanvas) return;
        if (this._activeCanvasTouchId !== null) return;
        const activeTouch = e.changedTouches[0];
        if (!activeTouch) return;
        e.preventDefault();
        this._activeCanvasTouchId = activeTouch.identifier;
        this.touchStartX = activeTouch.clientX;
        this.touchStartY = activeTouch.clientY;
      },
      { passive: false }
    );

    gameContainer.addEventListener(
      'touchmove',
      (e) => {
        if (this._activeCanvasTouchId === null) return;
        const activeTouch = findTouchById(e.touches, this._activeCanvasTouchId);
        if (!activeTouch) return;
        e.preventDefault();
      },
      { passive: false }
    );

    gameContainer.addEventListener(
      'touchend',
      (e) => {
        if (this._activeCanvasTouchId === null) return;
        const activeTouch = findTouchById(e.changedTouches, this._activeCanvasTouchId);
        if (!activeTouch) return;
        e.preventDefault();
        this._handleSwipe(activeTouch.clientX, activeTouch.clientY);
        this._activeCanvasTouchId = null;
      },
      { passive: false }
    );

    gameContainer.addEventListener('touchcancel', (e) => {
      if (this._activeCanvasTouchId === null) return;
      const activeTouch = findTouchById(e.changedTouches, this._activeCanvasTouchId);
      if (!activeTouch) return;
      this._activeCanvasTouchId = null;
    });
  }

  _handleSwipe(endX, endY) {
    const dx = endX - this.touchStartX;
    const dy = endY - this.touchStartY;

    if (Math.abs(dx) < this.minSwipeDistance && Math.abs(dy) < this.minSwipeDistance) return;

    if (Math.abs(dx) > Math.abs(dy)) {
      this.enqueueDirection(dx > 0 ? Direction.RIGHT : Direction.LEFT);
    } else {
      this.enqueueDirection(dy > 0 ? Direction.DOWN : Direction.UP);
    }
  }

  _bindDpad() {
    const bindBtn = (id, dir) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const dirId = this._directionIdFromDir(dir);

      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.enqueueDirection(dir);
        if (dirId) {
          const holdSince = Date.now();
          this._setDirectionHold(dir, dirId, holdSince);
        }
      });

      const clearHold = () => {
        this._clearDirectionHold(dirId);
      };
      btn.addEventListener('touchend', clearHold);
      btn.addEventListener('touchcancel', clearHold);

      btn.addEventListener('mousedown', () => {
        this.enqueueDirection(dir);
        if (dirId) {
          const holdSince = Date.now();
          this._setDirectionHold(dir, dirId, holdSince);
        }
      });
      btn.addEventListener('mouseup', clearHold);
      btn.addEventListener('mouseleave', clearHold);
    };

    bindBtn('btn-up', Direction.UP);
    bindBtn('btn-down', Direction.DOWN);
    bindBtn('btn-left', Direction.LEFT);
    bindBtn('btn-right', Direction.RIGHT);
  }
}

export const inputManager = new InputManager();
