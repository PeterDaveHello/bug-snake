// @ts-check
import { GameConfig, SpeedMode } from './config.js';

export class TimeManager {
  constructor() {
    this.timeLeft = 0;
    this.elapsedSeconds = 0;
    this.speedBoostUntil = 0;
    this.currentSpeed = GameConfig.rules.defaultSpeed;

    this._lastSpeedCheck = 0;
    this._lastTimeCheck = 0;

    // Default settings fallback
    this.settings = {
      speedMode: SpeedMode.FIXED,
      manualSpeed: GameConfig.rules.defaultSpeed,
      timeLimit: 60
    };
  }

  /**
   * Reset time state for a new game
   * @param {string} gameMode
   * @param {Object} settings - Game settings object
   */
  reset(gameMode, settings) {
    this.settings = settings;
    this.elapsedSeconds = 0;
    this.speedBoostUntil = 0;
    this._lastSpeedCheck = 0;
    this._lastTimeCheck = 0;
    this.currentSpeed = GameConfig.rules.defaultSpeed; // Reset baseline

    if (gameMode === 'timeAttack') {
      this.timeLeft = settings.timeLimit;
    }
  }

  /**
   * Update time attack countdown
   * @param {number} now - Current timestamp
   * @returns {boolean} true if time is up (0 or less)
   */
  checkTimeAttack(now) {
    if (!this._lastTimeCheck) this._lastTimeCheck = now;

    const elapsedMs = now - this._lastTimeCheck;
    if (elapsedMs >= 1000) {
      const secondsElapsed = Math.floor(elapsedMs / 1000);
      this.timeLeft = Math.max(0, this.timeLeft - secondsElapsed);
      this._lastTimeCheck += secondsElapsed * 1000;
      if (this.timeLeft <= 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Apply a speed boost for a duration
   * @param {number} durationSeconds
   */
  activateSpeedBoost(durationSeconds) {
    this.speedBoostUntil = performance.now() + durationSeconds * 1000;
  }

  /**
   * Calculate current game speed based on mode, time, score, and boosts
   * @param {number} now
   * @param {number} currentScore
   * @returns {number} The calculated target speed
   */
  calculateSpeed(now, currentScore) {
    if (!this._lastSpeedCheck) this._lastSpeedCheck = now;
    const deltaSeconds = (now - this._lastSpeedCheck) / 1000;
    this._lastSpeedCheck = now;

    if (this.settings.speedMode === SpeedMode.TIME) {
      this.elapsedSeconds += deltaSeconds;
    }

    let baseSpeed = GameConfig.rules.defaultSpeed;

    if (this.settings.speedMode === SpeedMode.SCORE) {
      const boost = Math.floor(currentScore / GameConfig.rules.scoreSpeedStep);
      baseSpeed = Math.min(GameConfig.rules.scoreSpeedMax, GameConfig.rules.defaultSpeed + boost);
    } else if (this.settings.speedMode === SpeedMode.TIME) {
      const boost = Math.floor(this.elapsedSeconds / GameConfig.rules.timeSpeedStep);
      baseSpeed = Math.min(GameConfig.rules.timeSpeedMax, GameConfig.rules.defaultSpeed + boost);
    } else if (this.settings.speedMode === SpeedMode.MANUAL) {
      baseSpeed = this.settings.manualSpeed;
    }

    const boostSpeed = now < this.speedBoostUntil ? GameConfig.rules.boostSpeedDelta : 0;
    const targetSpeed = Math.min(GameConfig.rules.maxSpeed, baseSpeed + boostSpeed);

    this.currentSpeed = targetSpeed;
    return targetSpeed;
  }
}
