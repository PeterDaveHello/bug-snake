// @ts-check
import * as fs from 'node:fs';

import { createDailyChallenge } from '../core/daily-challenge.js';
import { createDailyV1ItemAlgorithm } from '../core/daily-v1-algorithm.js';
import { Grid } from '../core/grid.js';
import { ItemManager } from '../core/item-manager.js';
import { Snake } from '../core/snake.js';

let passed = 0;

/** @param {boolean} condition @param {string} message */
function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✅ PASS: ${message}`);
  passed++;
}

const challenge = createDailyChallenge('2026-08-11');
const grid = new Grid(challenge.mapSize, challenge.wrapWalls);
const algorithm = createDailyV1ItemAlgorithm(
  grid,
  challenge.mapTemplate,
  challenge.seed,
  challenge.obstacleDensity
);
const snake = new Snake(grid, challenge.startLength);
const settings = {
  ...challenge,
  itemEnabled: { ...challenge.itemEnabled },
  itemWeights: Object.fromEntries(Object.keys(challenge.itemWeights).map((type) => [type, 0]))
};
const manager = new ItemManager(grid, snake, settings, challenge.itemDefinitions, algorithm);

const originalIsEnabled = manager._isEnabled;
manager._isEnabled = () => {
  throw new Error('daily-v1 must not delegate enablement to ItemManager internals');
};
try {
  assert(
    Boolean(algorithm.pickFoodType(manager)),
    'Daily-v1 item selection is independent of ItemManager._isEnabled'
  );
  settings.dangerEnabled = false;
  assert(
    algorithm.pickDangerType(manager) === null,
    'Daily-v1 locally applies its frozen danger enablement rule'
  );
  settings.dangerEnabled = true;
  for (const type of Object.keys(settings.itemEnabled)) settings.itemEnabled[type] = false;
  settings.itemEnabled.ant = true;
  assert(
    algorithm.pickFoodType(manager) === 'ant',
    'Daily-v1 locally applies descriptor-backed item enablement'
  );
} finally {
  manager._isEnabled = originalIsEnabled;
}

const controllerSource = fs.readFileSync(
  new URL('../ui/daily-challenge-controller.js', import.meta.url),
  'utf8'
);
assert(
  !controllerSource.includes('if (this.active || this.sharedChallenge) return;') &&
    controllerSource.includes('if (!this.sharedChallenge)') &&
    controllerSource.includes('this.record = this.store.getRecord(this.challenge.challengeId);'),
  'Shared challenge previews preserve their encoded date while refreshing cross-tab records'
);
assert(
  controllerSource.includes("if (key === 'i' || key === 'p')"),
  'Daily mode consumes both AI activation and path-display shortcuts'
);
const initialRefreshIndex = controllerSource.indexOf('this._refreshLocalChallengePreview();');
const initialScheduleIndex = controllerSource.indexOf('this._scheduleMidnightRefresh();');
assert(
  initialRefreshIndex > 0 && initialScheduleIndex > initialRefreshIndex,
  'Initialization refreshes the inactive preview before scheduling the next midnight'
);

const algorithmSource = fs.readFileSync(new URL('../core/daily-v1-algorithm.js', import.meta.url), 'utf8');
assert(
  !algorithmSource.includes('manager._isEnabled(') && !algorithmSource.includes('manager._getWeight('),
  'Frozen daily-v1 selection code does not call ItemManager private rule helpers'
);

console.log(`\nDaily review contract tests: ${passed} passed`);
