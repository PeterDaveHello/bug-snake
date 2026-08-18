// @ts-check
import { createHash } from 'node:crypto';

import { GameConfig, ItemType } from '../core/config.js';
import { createDailyChallenge } from '../core/daily-challenge.js';
import { createDailyV1ItemAlgorithm } from '../core/daily-v1-algorithm.js';
import { Grid } from '../core/grid.js';
import { ItemManager } from '../core/item-manager.js';
import { Snake } from '../core/snake.js';
import { TimeManager } from '../core/time-manager.js';

const challenge = createDailyChallenge('2026-08-11');
let passed = 0;

/** @param {boolean} condition @param {string} message */
function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✅ PASS: ${message}`);
  passed++;
}

assert(
  challenge.challengeId === 'daily-v1-2026-08-11',
  'Daily v1 golden vector keeps challenge ID stable'
);
assert(challenge.seed === 1591653427, 'Daily v1 golden vector keeps gameplay seed stable');
assert(challenge.algorithmVersion === 1, 'Daily v1 selects the frozen algorithm snapshot');
assert(challenge.mapTemplate === 'maze_simple', 'Daily v1 golden vector keeps map template stable');
assert(challenge.obstacleDensity === 0.03, 'Daily v1 golden vector keeps obstacle density stable');
assert(!challenge.wrapWalls, 'Daily v1 golden vector keeps wall wrapping disabled');
assert(challenge.speedMode === 'score', 'Daily v1 golden vector keeps speed mode stable');
assert(challenge.poisonMode === 'shrink', 'Daily v1 golden vector keeps poison mode stable');
assert(challenge.mapSize === 24, 'Daily v1 golden vector keeps map size stable');
assert(challenge.startLength === 3, 'Daily v1 golden vector keeps start length stable');
assert(challenge.dangerSpawnRate === 5, 'Daily v1 golden vector keeps danger rate stable');
assert(challenge.dangerTimeoutSec === 15, 'Daily v1 golden vector keeps danger timeout stable');

const expectedItemWeights = {
  roach: 50,
  ant: 30,
  mosquito: 20,
  egg: 25,
  mouse: 8,
  trash: 80,
  poison: 20
};
assert(
  Object.keys(challenge.itemEnabled).sort().join(',') ===
    Object.keys(expectedItemWeights).sort().join(',') &&
    Object.values(challenge.itemEnabled).every(Boolean),
  'Daily v1 golden vector keeps the enabled item set stable'
);
for (const [type, weight] of Object.entries(expectedItemWeights)) {
  assert(
    challenge.itemWeights[type] === weight,
    `Daily v1 golden vector keeps ${type} weight stable`
  );
}

const expectedGameplayRules = {
  defaultSpeed: 6,
  maxSpeed: 25,
  minSpeed: 5,
  scoreSpeedStep: 50,
  scoreSpeedMax: 20,
  timeSpeedStep: 15,
  timeSpeedMax: 20,
  boostSpeedDelta: 3,
  manualBoostSpeedDelta: 8,
  inputGraceMs: 0,
  speedSmoothingMs: 0,
  poisonShrinkAmount: 4
};
assert(
  JSON.stringify(challenge.gameplayRules) === JSON.stringify(expectedGameplayRules),
  'Daily v1 golden vector keeps gameplay rule constants stable'
);
assert(
  challenge.gameplayRules.speedSmoothingMs === 0,
  'Daily v1 keeps speed transitions independent of wall-clock frame pacing'
);

const expectedDefinitions = {
  roach: { score: 10, length: 1, weight: 50, color: '#8B5A2B' },
  ant: { score: 6, length: 1, weight: 30, color: '#FF3B30' },
  mosquito: { score: 15, length: 1, speedBoost: 3, weight: 20, color: '#32ADE6' },
  egg: { score: 8, length: 1, weight: 25, color: '#F5DEB3' },
  mouse: { score: 20, length: 2, weight: 8, color: '#808080' },
  trash: { score: -20, length: -2, weight: 80, color: '#A2845E' },
  poison: { score: 0, length: 0, weight: 20, color: '#AF52DE', isPoison: true }
};
assert(
  JSON.stringify(challenge.itemDefinitions) === JSON.stringify(expectedDefinitions),
  'Daily v1 golden vector keeps all item effects stable'
);

const grid = new Grid(challenge.mapSize, challenge.wrapWalls);
const algorithm = createDailyV1ItemAlgorithm(
  grid,
  challenge.mapTemplate,
  challenge.seed,
  challenge.obstacleDensity
);
const snake = new Snake(grid, challenge.startLength);
for (const segment of snake.body) grid.removeObstacle(segment.x, segment.y);
const obstacleFingerprint = createHash('sha256')
  .update([...grid.obstacles].sort((a, b) => a - b).join(','))
  .digest('hex');
assert(
  obstacleFingerprint === 'd1b7977c577d7ce77ec966c975b4c9049cca276cb945a7a922fb366108362030',
  'Daily v1 golden vector keeps the generated obstacle layout stable'
);

const spawnManager = new ItemManager(grid, snake, challenge, challenge.itemDefinitions, algorithm);
const spawnSequence = [];
for (let attempt = 0; attempt < 10; attempt++) {
  const previousItems = new Set(spawnManager.items);
  spawnManager.tick(0);
  for (const item of spawnManager.items) {
    if (!previousItems.has(item)) spawnSequence.push([item.type, item.x, item.y]);
  }
  const food = spawnManager.items.find((item) => spawnManager._isFood(item.type));
  if (!food) throw new Error('Daily v1 golden vector did not spawn food');
  spawnManager.checkCollision(food.x, food.y);
  spawnManager.recordConsumption();
}
assert(
  JSON.stringify(spawnSequence) ===
    JSON.stringify([
      ['egg', 21, 16],
      ['roach', 10, 21],
      ['mouse', 1, 5],
      ['mosquito', 12, 13],
      ['roach', 20, 11],
      ['roach', 2, 22],
      ['trash', 3, 9],
      ['ant', 14, 22],
      ['ant', 3, 13],
      ['mosquito', 19, 20],
      ['egg', 11, 19]
    ]),
  'Daily v1 golden vector keeps the item type and spawn sequence stable'
);

const originalScoreStep = GameConfig.rules.scoreSpeedStep;
const originalRoachScore = GameConfig.items[ItemType.ROACH].score;
GameConfig.rules.scoreSpeedStep = 1;
GameConfig.items[ItemType.ROACH].score = -999;
try {
  const timeManager = new TimeManager();
  timeManager.reset('classic', challenge, challenge.gameplayRules);
  assert(
    timeManager.calculateSpeed(1_000, 100) === 8,
    'Daily timing uses the versioned score-speed thresholds'
  );

  const itemManager = new ItemManager(
    /** @type {import('../core/grid.js').Grid} */ ({}),
    /** @type {import('../core/snake.js').Snake} */ ({}),
    challenge,
    challenge.itemDefinitions
  );
  assert(itemManager._isFood(ItemType.ROACH), 'Daily item classification uses versioned effects');
} finally {
  GameConfig.rules.scoreSpeedStep = originalScoreStep;
  GameConfig.items[ItemType.ROACH].score = originalRoachScore;
}

console.log(`\nDaily challenge vector tests: ${passed} passed`);
