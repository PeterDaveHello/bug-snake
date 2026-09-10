// @ts-check
import { GameConfig, ItemType } from '../core/config.js';
import {
  DeathReviewRecorder,
  ReviewDirectionMask,
  directionToMask,
  directionToReviewId,
  reviewIdToDirection
} from '../core/death-review-recorder.js';
import { Grid } from '../core/grid.js';
import { ItemManager } from '../core/item-manager.js';
import { Snake } from '../core/snake.js';
import { Direction } from '../input/input-manager.js';

let passed = 0;

/** @param {boolean} condition @param {string} message */
function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✅ PASS: ${message}`);
  passed++;
}

/** @param {number} actual @param {number} expected @param {string} message */
function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

/** @param {number} size */
function createFixture(size = 8) {
  const grid = new Grid(size);
  const snake = new Snake(grid, 3);
  const fixture = {
    grid,
    snake,
    settings: { snakeSkin: 'neon' },
    itemManager: { items: [] },
    scoreManager: { score: 0 }
  };
  return fixture;
}

{
  assertEqual(directionToMask(Direction.UP), ReviewDirectionMask.UP, 'Up direction has stable bit');
  assertEqual(
    directionToMask(Direction.RIGHT),
    ReviewDirectionMask.RIGHT,
    'Right direction has stable bit'
  );
  assert(directionToReviewId(Direction.LEFT) === 'left', 'Direction converts to review identifier');
  const down = reviewIdToDirection('down');
  assert(down.x === 0 && down.y === 1, 'Review identifier converts back to direction');
}

{
  const recorder = new DeathReviewRecorder({
    durationMs: Number.NaN,
    maxFrames: Number.POSITIVE_INFINITY,
    maxItems: Number.NEGATIVE_INFINITY
  });
  assertEqual(recorder.durationMs, 4000, 'Non-finite duration falls back to the default');
  assertEqual(recorder.maxFrames, 128, 'Non-finite frame capacity falls back to the default');
  assertEqual(recorder.maxItems, 8, 'Non-finite item capacity falls back to the default');
}

{
  const fixture = createFixture(8);
  fixture.settings.snakeSkin = 'classic';
  const recorder = new DeathReviewRecorder({ durationMs: 4000, maxFrames: 8 });
  recorder.beginRun(fixture);
  fixture.settings.snakeSkin = 'quantum';
  recorder.captureFrame(fixture, 100);
  const review = recorder.finish('unknown');
  assert(Boolean(review), 'Skin-change fixture produces a review');
  if (!review) throw new Error('Skin-change review unexpectedly missing');
  assert(review.frames[0].snakeSkin === 'classic', 'First frame keeps its live snake skin');
  assert(review.frames.at(-1)?.snakeSkin === 'quantum', 'Later frame captures a changed skin');
  assert(review.snakeSkin === 'quantum', 'Review fallback skin follows the final recorded frame');
}

{
  const fixture = createFixture(6);
  fixture.snake.body = [
    { x: 5, y: 2 },
    { x: 4, y: 2 },
    { x: 3, y: 2 }
  ];
  fixture.snake.prevBody = fixture.snake.body.map((segment) => ({ ...segment }));
  fixture.snake.direction = Direction.RIGHT;
  fixture.snake.nextDirection = Direction.RIGHT;
  fixture.snake._rebuildOccupiedKeys();

  const wall = fixture.snake.inspectMove(Direction.RIGHT);
  assert(!wall.allowed && wall.reason === 'wall', 'Move inspection reports wall collisions');
  assert(wall.target?.x === 6 && wall.target.y === 2, 'Wall inspection preserves raw target');

  fixture.grid.wrapWalls = true;
  const wrapped = fixture.snake.inspectMove(Direction.RIGHT);
  assert(wrapped.allowed, 'Move inspection permits wrapping at the boundary');
  assert(
    wrapped.normalizedTarget?.x === 0 && wrapped.normalizedTarget.y === 2,
    'Move inspection exposes normalized wrapped target'
  );
}

{
  const fixture = createFixture(8);
  const head = fixture.snake.getHead();
  fixture.grid.addObstacle(head.x, head.y - 1);
  const obstacle = fixture.snake.inspectMove(Direction.UP);
  assert(!obstacle.allowed && obstacle.reason === 'obstacle', 'Move inspection reports obstacles');

  const reverse = fixture.snake.inspectMove(Direction.LEFT);
  assert(
    !reverse.allowed && reverse.reason === 'reverse',
    'Move inspection rejects immediate reversal'
  );
}

{
  const fixture = createFixture(8);
  fixture.snake.body = [
    { x: 3, y: 3 },
    { x: 3, y: 4 },
    { x: 2, y: 4 },
    { x: 2, y: 3 }
  ];
  fixture.snake.prevBody = fixture.snake.body.map((segment) => ({ ...segment }));
  fixture.snake.direction = Direction.UP;
  fixture.snake.nextDirection = Direction.UP;
  fixture.snake.growthPending = 1;
  fixture.snake._rebuildOccupiedKeys();

  const self = fixture.snake.inspectMove(Direction.LEFT);
  assert(!self.allowed && self.reason === 'self', 'Move inspection reports occupied body cells');
}

{
  const fixture = createFixture(8);
  const itemEnabled = Object.fromEntries(Object.values(ItemType).map((type) => [type, false]));
  itemEnabled[ItemType.POISON] = true;
  const settings = {
    dangerEnabled: true,
    dangerSpawnRate: GameConfig.dangerSpawnRate,
    dangerTimeoutSec: 1,
    itemEnabled,
    itemWeights: {}
  };
  const manager = new ItemManager(fixture.grid, fixture.snake, settings);
  manager.dangerTimer = 950;
  const poison = {
    x: 5,
    y: 4,
    type: ItemType.POISON,
    spawnTime: 0,
    id: 1,
    visualAttrs: {}
  };
  manager.items = [poison];

  assert(
    !manager.willItemExpireAfter(poison, 0.05),
    'Danger item remains active at the exact timeout boundary'
  );
  assert(
    manager.willItemExpireAfter(poison, 0.051),
    'Danger item expiry projects the upcoming active-play step'
  );
  manager.tick(0.051);
  assert(
    manager.getItemAt(poison.x, poison.y) === null,
    'Projected expiry uses the same rule as the actual item lifecycle'
  );

  manager.items = [poison];
  settings.itemEnabled[ItemType.POISON] = false;
  assert(
    manager.getItemAt(poison.x, poison.y) === null,
    'Prospective collision lookup ignores disabled poison before the next tick'
  );
  manager.tick(0);
  assert(manager.items.length === 0, 'Actual item lifecycle removes the same disabled poison');
}

{
  const fixture = createFixture(8);
  fixture.grid.addObstacle(1, 1);
  fixture.itemManager.items = [
    {
      x: 4,
      y: 4,
      type: 'ant',
      id: 42,
      visualAttrs: { sizeVar: 1.1, hueVar: 2, angleVar: 0.1, quirk: 0.7 }
    }
  ];
  const recorder = new DeathReviewRecorder({ durationMs: 4000, maxFrames: 8 });
  recorder.beginRun(fixture);
  const firstCell = fixture.snake.body[0].y * fixture.grid.size + fixture.snake.body[0].x;

  for (let step = 0; step < 6; step++) {
    recorder.markDecision({
      attemptedDirection: Direction.RIGHT,
      safeDirectionMask: ReviewDirectionMask.UP | ReviewDirectionMask.RIGHT,
      inspection: {
        allowed: step < 5,
        reason: step < 5 ? null : 'wall',
        target: { x: 8, y: 4 },
        normalizedTarget: null
      },
      stepDurationMs: 1000
    });
    if (step === 5) break;
    fixture.scoreManager.score += 10;
    fixture.snake.body[0] = { x: Math.min(7, fixture.snake.body[0].x + 1), y: 4 };
    fixture.snake._rebuildOccupiedKeys();
    recorder.captureFrame(fixture, 1000);
  }

  const review = recorder.finish('wall');
  assert(Boolean(review), 'Recorder produces a completed review');
  if (!review) throw new Error('Review unexpectedly missing');
  assert(review.frames.length <= 5, 'Recorder trims snapshots to the configured duration');
  assert(review.frames[0].timestampMs === 0, 'Review timestamps are normalized to zero');
  assert(
    review.durationMs <= 5000,
    'Review duration includes at most one fatal step beyond the window'
  );
  assert(review.obstacleCells[0] === 9, 'Review keeps an immutable obstacle snapshot');
  assert(review.snakeSkin === 'neon', 'Review keeps the final active snake skin');
  assert(
    review.frames.every((frame) => frame.snakeSkin === 'neon'),
    'Frames preserve the active skin when it does not change'
  );
  assert(review.death.reason === 'wall', 'Review records the actual death reason');
  assert(review.death.attemptedDirection === 'right', 'Review records the fatal direction');
  assert(
    review.death.safeDirectionMask === (ReviewDirectionMask.UP | ReviewDirectionMask.RIGHT),
    'Review records immediate safe directions'
  );
  assert(
    review.frames[0].bodyCells[0] !== firstCell,
    'Trimming removes snapshots older than the review window'
  );

  const newestHead = review.frames.at(-1)?.bodyCells[0];
  fixture.snake.body[0] = { x: 0, y: 0 };
  assert(
    review.frames.at(-1)?.bodyCells[0] === newestHead,
    'Recorded body cells do not alias live state'
  );
  fixture.itemManager.items[0].visualAttrs.sizeVar = 0.2;
  assert(
    review.frames.at(-1)?.items[0].visualAttrs?.sizeVar === 1.1,
    'Recorded item visuals do not alias live item attributes'
  );
}

{
  const fixture = createFixture(8);
  const recorder = new DeathReviewRecorder();
  recorder.beginRun(fixture);
  recorder.markDecision({
    attemptedDirection: Direction.UP,
    safeDirectionMask: ReviewDirectionMask.RIGHT,
    inspection: {
      allowed: false,
      reason: 'obstacle',
      target: { x: 4, y: 3 },
      normalizedTarget: { x: 4, y: 3 }
    },
    stepDurationMs: 120
  });
  const oldReview = recorder.finish('obstacle');
  recorder.beginRun(fixture);
  assert(recorder.getReview() === null, 'Beginning a new run clears the previous review');
  assert(
    oldReview?.death.target?.x === 4,
    'Clearing the recorder does not mutate an existing review'
  );
}

console.log(`\nDeath review tests: ${passed} passed`);
