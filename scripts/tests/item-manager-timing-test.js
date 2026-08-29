// @ts-check
import { ItemType } from '../core/config.js';
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

const grid = new Grid(8, false);
const snake = new Snake(grid, 1);
snake.body = [{ x: 1, y: 1 }];
snake.prevBody = [{ x: 1, y: 1 }];
snake._rebuildOccupiedKeys();

const settings = {
  itemEnabled: {
    [ItemType.ROACH]: true,
    [ItemType.ANT]: false,
    [ItemType.MOSQUITO]: false,
    [ItemType.EGG]: false,
    [ItemType.MOUSE]: false,
    [ItemType.TRASH]: true,
    [ItemType.POISON]: false
  },
  itemWeights: {
    [ItemType.ROACH]: 1,
    [ItemType.TRASH]: 1
  },
  dangerEnabled: true,
  dangerSpawnRate: 1000,
  dangerTimeoutSec: 15
};

const manager = new ItemManager(grid, snake, settings);
manager.spawnItem(ItemType.TRASH, 0);
const hasTrash = () => manager.items.some((item) => item.type === ItemType.TRASH);

assert(hasTrash(), 'Danger item starts present');

manager.tick(5, 5_000);
assert(hasTrash(), 'Danger item remains before its active-play timeout');

manager.tick(0, 60_000);
assert(hasTrash(), 'Wall-clock time does not expire danger while gameplay is paused');

manager.tick(10.001, 70_001);
assert(!hasTrash(), 'Danger item expires after enough active gameplay time');

manager.clear();
assert(manager.dangerTimer === 0, 'Clearing items resets the active-play danger clock');

manager.tick(Number.MAX_VALUE);
assert(
  Number.isFinite(manager.dangerTimer) && manager.dangerTimer === Number.MAX_SAFE_INTEGER,
  'Extreme finite elapsed time is clamped to a finite active-play clock'
);

manager.tick(Number.MAX_VALUE);
assert(
  manager.dangerTimer === Number.MAX_SAFE_INTEGER,
  'Repeated extreme elapsed time cannot overflow the active-play clock'
);

console.log(`\nItem manager timing tests: ${passed} passed`);
