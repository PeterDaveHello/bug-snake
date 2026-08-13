// @ts-check
import { GameConfig, SpeedMode } from './config.js';

/**
 * @typedef {Object} GameplayRules
 * @property {number} defaultSpeed
 * @property {number} maxSpeed
 * @property {number} minSpeed
 * @property {number} scoreSpeedStep
 * @property {number} scoreSpeedMax
 * @property {number} timeSpeedStep
 * @property {number} timeSpeedMax
 * @property {number} boostSpeedDelta
 * @property {number} manualBoostSpeedDelta
 * @property {number} inputGraceMs
 * @property {number} speedSmoothingMs
 * @property {number} poisonShrinkAmount
 */

export class TimeManager {
  constructor() {
    this.timeLeft = 0;
    this.elapsedSeconds = 0;
    this.speedBoostRemainingMs = 0;
    this.currentSpeed = GameConfig.rules.defaultSpeed;
    /** @type {Readonly<GameplayRules>} */
    this.rules = GameConfig.rules;

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
   * @param {Readonly<GameplayRules>} [rules]
   */
  reset(gameMode, settings, rules = GameConfig.rules) {
    this.settings = settings;
    this.rules = rules;
    this.elapsedSeconds = 0;
    this.speedBoostRemainingMs = 0;
    this._lastSpeedCheck = 0;
    this._lastTimeCheck = 0;
    this.currentSpeed = this.rules.defaultSpeed; // Reset baseline

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
   * Apply a speed boost for a duration of active gameplay.
   * @param {number} durationSeconds
   */
  activateSpeedBoost(durationSeconds) {
    const durationMs = durationSeconds * 1000;
    this.speedBoostRemainingMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  }

  /**
   * Advance effects that are defined in active simulation time. This is called
   * once after a successful gameplay tick, so pauses, background suspension,
   * input grace, and catch-up frame pacing cannot consume extra duration.
   * @param {number} deltaSeconds
   */
  advanceActiveTime(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;

    if (this.settings.speedMode === SpeedMode.TIME) {
      this.elapsedSeconds += deltaSeconds;
    }
    this.speedBoostRemainingMs = Math.max(0, this.speedBoostRemainingMs - deltaSeconds * 1000);
  }

  /**
   * Calculate current game speed based on mode, active time, score, and boosts
   * @param {number} now
   * @param {number} currentScore
   * @returns {number} The calculated target speed
   */
  calculateSpeed(now, currentScore) {
    this._lastSpeedCheck = now;

    let baseSpeed = this.rules.defaultSpeed;

    if (this.settings.speedMode === SpeedMode.SCORE) {
      const boost = Math.floor(currentScore / this.rules.scoreSpeedStep);
      baseSpeed = Math.max(
        this.rules.minSpeed,
        Math.min(this.rules.scoreSpeedMax, this.rules.defaultSpeed + boost)
      );
    } else if (this.settings.speedMode === SpeedMode.TIME) {
      const boost = Math.floor(this.elapsedSeconds / this.rules.timeSpeedStep);
      baseSpeed = Math.min(this.rules.timeSpeedMax, this.rules.defaultSpeed + boost);
    } else if (this.settings.speedMode === SpeedMode.MANUAL) {
      baseSpeed = this.settings.manualSpeed;
    }

    const boostSpeed = this.speedBoostRemainingMs > 0 ? this.rules.boostSpeedDelta : 0;
    const targetSpeed = Math.min(this.rules.maxSpeed, baseSpeed + boostSpeed);

    this.currentSpeed = targetSpeed;
    return targetSpeed;
  }
}
