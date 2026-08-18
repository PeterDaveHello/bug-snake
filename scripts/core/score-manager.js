// @ts-check

export class ScoreManager {
  constructor() {
    this.score = 0;
    this.highScore = 0;
    this.itemsCollected = 0;
    this.gameMode = 'classic';
    /** @type {number | null} */
    this.highScoreOverride = null;
  }

  /**
   * Reset score state for a new game
   * @param {string} gameMode
   */
  reset(gameMode) {
    this.gameMode = gameMode;
    this.score = 0;
    this.itemsCollected = 0;
    this.highScore =
      this.highScoreOverride === null ? this._loadHighScore(gameMode) : this.highScoreOverride;
  }

  /**
   * Add points to current score
   * @param {number} points
   */
  add(points) {
    this.score += points;
  }

  /**
   * Increment the count of items collected
   */
  incrementItemsCollected() {
    this.itemsCollected++;
  }

  /**
   * Check if current score is higher than high score and save if so
   * @returns {boolean} true if a new high score was set
   */
  checkHighScore() {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      if (this.highScoreOverride === null) {
        this._saveHighScore(this.highScore);
      } else {
        this.highScoreOverride = this.highScore;
      }
      return true;
    }
    return false;
  }

  /**
   * Use a temporary in-memory high score for special sessions without
   * overwriting the persistent high score for the underlying game mode.
   * @param {number} score
   */
  setHighScoreOverride(score) {
    const normalized = Number.isSafeInteger(score) ? score : 0;
    this.highScoreOverride = normalized;
    this.highScore = normalized;
  }

  /**
   * Return to the normal per-mode persistent high score behavior.
   */
  clearHighScoreOverride() {
    this.highScoreOverride = null;
    this.highScore = this._loadHighScore(this.gameMode);
  }

  /**
   * Force save a specific high score (e.g. for resets)
   * @param {number} score
   * @param {string} [mode]
   */
  setHighScore(score, mode = this.gameMode) {
    if (this.highScoreOverride !== null && mode === this.gameMode) {
      this.highScoreOverride = score;
      this.highScore = score;
      return;
    }
    if (mode === this.gameMode) {
      this.highScore = score;
    }
    this._saveHighScore(score, mode);
  }

  /**
   * @param {string} [mode]
   * @returns {number}
   */
  _loadHighScore(mode = this.gameMode) {
    try {
      if (typeof localStorage === 'undefined') return 0;
      const key = `bugbuster_highscore_${mode || 'classic'}`;
      const stored = localStorage.getItem(key);
      if (!stored) return 0;
      const parsed = parseInt(stored, 10);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch (e) {
      console.warn('LocalStorage not available:', e);
      return 0;
    }
  }

  /**
   * @param {number} score
   * @param {string} [mode]
   */
  _saveHighScore(score, mode = this.gameMode) {
    try {
      if (typeof localStorage === 'undefined') return;
      const key = `bugbuster_highscore_${mode || 'classic'}`;
      localStorage.setItem(key, score.toString());
    } catch (e) {
      console.warn('LocalStorage not available:', e);
    }
  }
}
