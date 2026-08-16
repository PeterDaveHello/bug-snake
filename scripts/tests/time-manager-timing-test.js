// @ts-check
import { GameConfig, SpeedMode } from '../core/config.js';
import { TimeManager } from '../core/time-manager.js';

let passed = 0;

/** @param {boolean} condition @param {string} message */
function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✅ PASS: ${message}`);
  passed++;
}

const settings = {
  speedMode: SpeedMode.FIXED,
  manualSpeed: GameConfig.rules.defaultSpeed,
  timeLimit: 60
};
const boostedSpeed = Math.min(
  GameConfig.rules.maxSpeed,
  GameConfig.rules.defaultSpeed + GameConfig.rules.boostSpeedDelta
);

const pausedBoost = new TimeManager();
pausedBoost.reset('classic', settings);
pausedBoost.activateSpeedBoost(3);
assert(pausedBoost.calculateSpeed(1_000, 0) === boostedSpeed, 'Speed boost starts immediately');

pausedBoost.advanceActiveTime(2);
const remainingBeforePause = pausedBoost.speedBoostRemainingMs;
assert(remainingBeforePause === 1_000, 'Active gameplay consumes the boost duration');
assert(
  pausedBoost.calculateSpeed(61_000, 0) === boostedSpeed &&
    pausedBoost.speedBoostRemainingMs === remainingBeforePause,
  'Pause and wall-clock time do not consume a speed boost'
);

pausedBoost.advanceActiveTime(1);
assert(
  pausedBoost.calculateSpeed(62_000, 0) === GameConfig.rules.defaultSpeed,
  'Speed boost expires after its remaining active gameplay time'
);

const catchUpBoost = new TimeManager();
catchUpBoost.reset('classic', settings);
catchUpBoost.activateSpeedBoost(3);
catchUpBoost.calculateSpeed(1_000, 0);
catchUpBoost.advanceActiveTime(0.1);
catchUpBoost.advanceActiveTime(0.1);
assert(
  catchUpBoost.calculateSpeed(61_000, 0) === boostedSpeed &&
    catchUpBoost.speedBoostRemainingMs === 2_800,
  'Catch-up frames consume only their actual simulated tick time'
);

const negativeScore = new TimeManager();
negativeScore.reset('classic', { ...settings, speedMode: SpeedMode.SCORE });
assert(
  negativeScore.calculateSpeed(1_000, -10_000) === GameConfig.rules.minSpeed,
  'Negative scores cannot reduce score-based speed below the configured minimum'
);

const invalidBoost = new TimeManager();
invalidBoost.reset('classic', settings);
for (const duration of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
  invalidBoost.activateSpeedBoost(duration);
  assert(
    invalidBoost.speedBoostRemainingMs === 0,
    `Invalid speed-boost duration ${String(duration)} is rejected`
  );
}

const timeScaled = new TimeManager();
timeScaled.reset('classic', { ...settings, speedMode: SpeedMode.TIME });
timeScaled.advanceActiveTime(GameConfig.rules.timeSpeedStep);
assert(
  timeScaled.calculateSpeed(1_000, 0) === GameConfig.rules.defaultSpeed + 1,
  'Time-based speed scaling uses active gameplay time'
);

timeScaled.reset('classic', settings);
assert(
  timeScaled.speedBoostRemainingMs === 0 &&
    timeScaled.calculateSpeed(62_000, 0) === GameConfig.rules.defaultSpeed,
  'Reset clears temporary speed boosts'
);

console.log(`\nTime manager timing tests: ${passed} passed`);
