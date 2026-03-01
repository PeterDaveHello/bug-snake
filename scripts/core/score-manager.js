// @ts-check

export class ScoreManager {
  constructor() {
    this.score = 0;
    this.highScore = 0;
    this.itemsCollected = 0;
    this.gameMode = 'classic';
  }

  /**
   * Reset score state for a new game
   * @param {string} gameMode
   */
  reset(gameMode) {
    this.gameMode = gameMode;
    this.score = 0;
    this.itemsCollected = 0;
    this.highScore = this._loadHighScore(gameMode);
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
      this._saveHighScore(this.highScore);
      return true;
    }
    return false;
  }

  /**
   * Force save a specific high score (e.g. for resets)
   * @param {number} score
   */
  setHighScore(score, mode = this.gameMode) {
    if (mode === this.gameMode) {
      this.highScore = score;
    }
    this._saveHighScore(score, mode);
  }

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
