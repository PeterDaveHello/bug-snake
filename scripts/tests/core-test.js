// @ts-check
import * as fs from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import { AIPilot, AIAlgorithm } from '../ai/ai-pilot.js';
import { GameConfig, ItemType, SpeedMode } from '../core/config.js';
import { GameLoop } from '../core/game-loop.js';
import { Grid } from '../core/grid.js';
import { ItemManager } from '../core/item-manager.js';
import { rng } from '../core/random.js';
import { ScoreManager } from '../core/score-manager.js';
import { Snake } from '../core/snake.js';
import { TimeManager } from '../core/time-manager.js';
import { Direction, InputManager } from '../input/input-manager.js';
import { MapGenerator, MapTemplate } from '../maps/map-generator.js';
import {
  KEYBOARD_HINT_TOKENS,
  splitKeyboardShortcut,
  tokenizeKeyboardHints
} from '../utils/keyboard-hint.js';
import { isPlainLetterShortcut } from '../utils/keyboard-shortcut.js';
import { MinHeap } from '../utils/min-heap.js';

/**
 * Simple test runner for Core Managers
 */
export function runCoreTests() {
  console.log('--- Running Core Manager Tests ---');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. ScoreManager Tests
  console.log('\n[ScoreManager]');
  const scoreMgr = new ScoreManager();

  scoreMgr.reset('classic');
  assert(scoreMgr.score === 0, 'Reset score is 0');

  scoreMgr.add(50);
  assert(scoreMgr.score === 50, 'Add 50 points');

  scoreMgr.incrementItemsCollected();
  assert(scoreMgr.itemsCollected === 1, 'Items collected increment');

  // ScoreManager localStorage persistence (Node-only mock)
  /** @type {Map<string, string>} */
  const highScoreStore = new Map();
  /** @type {Storage} */
  const localStorageMock = {
    get length() {
      return highScoreStore.size;
    },
    clear() {
      highScoreStore.clear();
    },
    key(index) {
      return Array.from(highScoreStore.keys())[index] ?? null;
    },
    getItem(key) {
      return highScoreStore.has(key) ? highScoreStore.get(key) : null;
    },
    setItem(key, value) {
      highScoreStore.set(key, String(value));
    },
    removeItem(key) {
      highScoreStore.delete(key);
    }
  };
  globalThis.localStorage = localStorageMock;

  const storageScoreMgr = new ScoreManager();
  storageScoreMgr.reset('classic');
  storageScoreMgr.add(10);
  storageScoreMgr.checkHighScore();
  assert(
    highScoreStore.get('bugbuster_highscore_classic') === '10',
    'High score is saved to localStorage'
  );

  const storageScoreMgr2 = new ScoreManager();
  storageScoreMgr2.reset('classic');
  assert(storageScoreMgr2.highScore === 10, 'High score is loaded from localStorage on reset');

  // Clean up mock
  delete globalThis.localStorage;

  // 2. TimeManager Tests
  console.log('\n[TimeManager]');
  const timeMgr = new TimeManager();
  const mockSettings = {
    speedMode: SpeedMode.SCORE,
    manualSpeed: 10,
    timeLimit: 60
  };

  timeMgr.reset('classic', mockSettings);
  assert(timeMgr.elapsedSeconds === 0, 'Reset elapsed time');

  // Test speed scaling with score
  const now = 10000;
  // Default speed 10, Score Step 50. Score 50 = +1 boost.
  const speed = timeMgr.calculateSpeed(now, 50);
  const expected = GameConfig.rules.defaultSpeed + 1;
  assert(speed === expected, `Speed scaling: Expected ${expected}, got ${speed}`);

  // Speed boost application
  const boostNow = 1_000;
  const boostSettings = {
    speedMode: SpeedMode.FIXED,
    manualSpeed: GameConfig.rules.defaultSpeed,
    timeLimit: 60
  };
  const boostMgr = new TimeManager();
  boostMgr.reset('classic', boostSettings);
  boostMgr.activateSpeedBoost(3);
  const boostedSpeed = boostMgr.calculateSpeed(boostNow, 0);
  assert(
    boostedSpeed === GameConfig.rules.defaultSpeed + GameConfig.rules.boostSpeedDelta,
    'Speed boost increases target speed'
  );
  let unboostedSpeed = boostedSpeed;
  for (let elapsedMs = 250; elapsedMs <= 3000; elapsedMs += 250) {
    boostMgr.advanceActiveTime(0.25);
    unboostedSpeed = boostMgr.calculateSpeed(boostNow + elapsedMs, 0);
  }
  assert(
    unboostedSpeed === GameConfig.rules.defaultSpeed,
    'Speed boost expires after its active gameplay duration'
  );

  // 3. Settings Reference Sync Test
  console.log('\n[Settings Sync]');
  // Verify that modifying the settings object reflects in managers (Reference Sharing)
  const sharedSettings = {
    speedMode: SpeedMode.FIXED,
    manualSpeed: 10,
    timeLimit: 60
  };

  const syncTimeMgr = new TimeManager();
  syncTimeMgr.reset('classic', sharedSettings);

  // Initial check
  const defaultSpeed = GameConfig.rules.defaultSpeed;
  assert(syncTimeMgr.calculateSpeed(now, 0) === defaultSpeed, `Initial speed ${defaultSpeed}`);

  // Modify shared settings (simulating PanelManager)
  sharedSettings.speedMode = SpeedMode.MANUAL;
  sharedSettings.manualSpeed = 20;

  // Manager should see the change immediately
  assert(syncTimeMgr.calculateSpeed(now, 0) === 20, 'Manual speed update reflected immediately');

  // 4. Grid Tests
  console.log('\n[Grid]');
  const wrapObsGrid = new Grid(5, true);
  wrapObsGrid.addObstacle(5, 0);
  assert(wrapObsGrid.isObstacle(0, 0), 'addObstacle normalizes x=size to x=0 when wrapWalls is on');
  assert(!wrapObsGrid.isObstacle(0, 1), 'Normalized obstacle does not alias to a different cell');
  wrapObsGrid.addObstacle(-1, 0);
  assert(wrapObsGrid.isObstacle(4, 0), 'addObstacle normalizes negative x when wrapWalls is on');
  wrapObsGrid.removeObstacle(-1, 0);
  assert(
    !wrapObsGrid.isObstacle(4, 0),
    'removeObstacle normalizes negative x when wrapWalls is on'
  );

  // 5. InputManager Tests
  console.log('\n[InputManager]');
  const inputMgr = new InputManager();
  const beforeInputAt = inputMgr.getLastDirectionInputAt();
  inputMgr.enqueueDirection(Direction.UP);
  assert(
    inputMgr.getLastDirectionInputAt() >= beforeInputAt,
    'enqueueDirection updates last direction input timestamp'
  );
  inputMgr.enqueueDirection(Direction.UP);
  assert(inputMgr.directionQueue.length === 1, 'enqueueDirection de-dupes consecutive directions');
  inputMgr.enqueueDirection(Direction.DOWN);
  assert(
    inputMgr.directionQueue.length === 1,
    'enqueueDirection replaces reverse of the last queued direction'
  );
  assert(
    inputMgr.directionQueue[0] === Direction.DOWN,
    'enqueueDirection keeps the latest correction'
  );
  inputMgr.clearQueue();
  inputMgr.enqueueDirection(Direction.UP);

  inputMgr.enqueueDirection(Direction.LEFT);
  inputMgr.enqueueDirection(Direction.DOWN);
  inputMgr.enqueueDirection(Direction.RIGHT);
  assert(inputMgr.directionQueue.length === 2, 'enqueueDirection enforces a max queue length of 2');

  const d0 = inputMgr.getNextDirection();
  const d1 = inputMgr.getNextDirection();
  assert(
    d0 === Direction.DOWN && d1 === Direction.RIGHT,
    'Queue saturation prioritizes latest steering intent'
  );
  assert(!inputMgr.hasQueuedDirection(), 'Queue reports empty after draining');
  inputMgr.clearQueue();
  inputMgr._handleDirectionKeyDown('ArrowRight');
  inputMgr._handleDirectionKeyDown('ArrowUp');
  inputMgr._handleDirectionKeyUp('ArrowRight');
  assert(
    inputMgr.heldDirection === Direction.UP,
    'Held direction persists when another key is still held'
  );
  inputMgr._handleDirectionKeyUp('ArrowUp');
  assert(inputMgr.heldDirection === null, 'Held direction clears when releasing last held key');
  inputMgr.clearQueue();
  inputMgr.heldDirection = null;
  inputMgr._heldDirectionSince.clear();
  const holdSince = Date.now() - 200;
  inputMgr._setDirectionHold(Direction.LEFT, 'left', holdSince);
  assert(inputMgr.heldDirection === Direction.LEFT, 'Direction hold helper syncs heldDirection');
  assert(
    inputMgr._heldDirectionSince.get('left') === holdSince,
    'Direction hold helper stores provided timestamp'
  );
  inputMgr._setDirectionHold(Direction.LEFT, 'left', holdSince + 50, true);
  assert(
    inputMgr._heldDirectionSince.get('left') === holdSince,
    'Direction hold helper preserves existing timestamp when requested'
  );
  inputMgr._setDirectionHold(Direction.UP, 'up', holdSince + 80);
  inputMgr._clearDirectionHold('up');
  assert(
    inputMgr.heldDirection === Direction.LEFT,
    'Direction release helper restores remaining held direction'
  );
  inputMgr._clearDirectionHold('left');
  assert(
    inputMgr.heldDirection === null,
    'Direction release helper clears held direction when empty'
  );
  assert(inputMgr.isBoostActive() === false, 'Holding direction keys does not enable boost');

  inputMgr.clearQueue();
  inputMgr._handleDirectionKeyDown('ArrowRight');
  inputMgr.clearQueue();
  inputMgr._handleDirectionKeyDown('ArrowUp');
  inputMgr._handleDirectionKeyUp('ArrowUp');
  inputMgr.enqueueDirection(Direction.LEFT);
  assert(
    inputMgr.directionQueue.length === 2 &&
      inputMgr.directionQueue[0] === Direction.UP &&
      inputMgr.directionQueue[1] === Direction.LEFT,
    'Allows buffering UP then LEFT while still holding RIGHT'
  );
  inputMgr._handleDirectionKeyUp('ArrowRight');

  inputMgr.clearQueue();
  inputMgr._handleDirectionKeyDown('ArrowRight');
  inputMgr.clearQueue();
  inputMgr._heldDirectionSince.set('right', Date.now() - 200);
  assert(
    inputMgr.isHoldingCurrentDirection(Direction.RIGHT) === true,
    'Holding current direction enables straight boost'
  );

  inputMgr._handleDirectionKeyDown('ArrowUp');
  inputMgr.clearQueue();
  inputMgr._heldDirectionSince.set('up', Date.now() - 200);
  assert(
    inputMgr.isHoldingCurrentDirection(Direction.UP) === false,
    'Straight boost is disabled when holding multiple direction keys'
  );
  inputMgr._handleDirectionKeyUp('ArrowUp');
  inputMgr._handleDirectionKeyUp('ArrowRight');

  inputMgr.clearQueue();
  inputMgr._handleDirectionKeyDown('ArrowUp');
  inputMgr._handleDirectionKeyUp('ArrowUp');
  assert(
    inputMgr.directionQueue.length === 1 && inputMgr.directionQueue[0] === Direction.UP,
    'Short tap queues one direction for buffering'
  );

  inputMgr.clearQueue();
  inputMgr._handleDirectionKeyDown('ArrowUp');
  inputMgr.clearQueue();
  inputMgr.enqueueDirection(Direction.LEFT);
  inputMgr.enqueueDirection(Direction.RIGHT);
  assert(
    inputMgr.directionQueue.length === 1,
    'enqueueDirection replaces reverse of last queued direction'
  );
  assert(
    inputMgr.directionQueue[0] === Direction.RIGHT,
    'enqueueDirection keeps latest correction'
  );
  inputMgr._handleDirectionKeyUp('ArrowUp');

  inputMgr.clearQueue();
  inputMgr._handleDirectionKeyDown('ArrowRight');
  inputMgr.clearQueue();
  const beforeReverseHeldAt = inputMgr.getLastDirectionInputAt();
  inputMgr.enqueueDirection(Direction.LEFT);
  assert(
    inputMgr.directionQueue.length === 1 && inputMgr.directionQueue[0] === Direction.LEFT,
    'enqueueDirection allows opposite of held direction when queue is empty'
  );
  assert(
    inputMgr.getLastDirectionInputAt() >= beforeReverseHeldAt,
    'Accepted held-opposite input updates timestamp'
  );
  const beforeDuplicateAt = inputMgr.getLastDirectionInputAt();
  inputMgr.enqueueDirection(Direction.LEFT);
  assert(
    inputMgr.getLastDirectionInputAt() === beforeDuplicateAt,
    'Ignored duplicate input does not update timestamp'
  );
  inputMgr._handleDirectionKeyUp('ArrowRight');

  inputMgr.clearQueue();
  inputMgr._handleDirectionKeyDown('ArrowRight');
  inputMgr.clearQueue();
  inputMgr.enqueueDirection(Direction.UP);
  inputMgr.enqueueDirection(Direction.RIGHT);
  inputMgr.enqueueDirection(Direction.LEFT);
  assert(
    inputMgr.directionQueue.length === 2 &&
      inputMgr.directionQueue[0] === Direction.UP &&
      inputMgr.directionQueue[1] === Direction.LEFT,
    'Full-queue correction preserves first legal turn'
  );
  inputMgr._handleDirectionKeyUp('ArrowRight');

  // 5.5 Keyboard Shortcut Utility Tests
  console.log('\n[Keyboard Shortcut Utility]');
  /**
   * @param {Partial<{key: string, repeat: boolean, ctrlKey: boolean, metaKey: boolean, altKey: boolean, shiftKey: boolean, isComposing: boolean}>} [overrides]
   */
  const shortcutEvent = (overrides = {}) => ({
    key: '',
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...overrides
  });
  assert(
    isPlainLetterShortcut(shortcutEvent({ key: 'a' }), 'a'),
    'Shortcut utility matches plain letter key by event.key'
  );
  assert(
    !isPlainLetterShortcut(shortcutEvent({ key: 'q' }), 'a'),
    'Shortcut utility rejects different letter keys'
  );
  assert(
    !isPlainLetterShortcut(shortcutEvent({ key: 'a', ctrlKey: true }), 'a'),
    'Shortcut utility ignores Ctrl-modified keys'
  );
  assert(
    !isPlainLetterShortcut(shortcutEvent({ key: 'a', metaKey: true }), 'a'),
    'Shortcut utility ignores Meta-modified keys'
  );
  assert(
    !isPlainLetterShortcut(shortcutEvent({ key: 'a', altKey: true }), 'a'),
    'Shortcut utility ignores Alt-modified keys'
  );
  assert(
    !isPlainLetterShortcut(shortcutEvent({ key: 'A', shiftKey: true }), 'a'),
    'Shortcut utility requires unmodified key presses'
  );
  assert(
    !isPlainLetterShortcut(shortcutEvent({ key: 'a', repeat: true }), 'a'),
    'Shortcut utility ignores repeated keydown events'
  );
  assert(
    !isPlainLetterShortcut(shortcutEvent({ key: 'a', isComposing: true }), 'a'),
    'Shortcut utility ignores composing key events'
  );
  assert(
    isPlainLetterShortcut(shortcutEvent({ key: 'l' }), 'l'),
    'Shortcut utility supports legend key on locale-aware key input'
  );

  // 5.6 Keyboard Hint Tokenizer Tests
  console.log('\n[Keyboard Hint Tokenizer]');
  for (const token of KEYBOARD_HINT_TOKENS) {
    const tokenParts = tokenizeKeyboardHints(`{${token}}`);
    assert(
      tokenParts.length === 1 && tokenParts[0]?.type === 'keys',
      `Keyboard hint tokenizer recognizes {${token}}`
    );
  }
  const arrowHintPart = tokenizeKeyboardHints('{arrowKeys}')[0];
  assert(
    arrowHintPart?.type === 'keys' && arrowHintPart.labelKey === 'ui.keyArrowKeys',
    'Arrow-key hint exposes a localized accessible-name key'
  );
  const hintParts = tokenizeKeyboardHints('Move: {arrowKeys} / {wasd}; restart: {randomRestart}.');
  assert(
    hintParts.length === 7 &&
      hintParts[0]?.type === 'text' &&
      hintParts[0].value === 'Move: ' &&
      hintParts[2]?.type === 'text' &&
      hintParts[2].value === ' / ' &&
      hintParts[4]?.type === 'text' &&
      hintParts[4].value === '; restart: ' &&
      hintParts[6]?.type === 'text' &&
      hintParts[6].value === '.',
    'Keyboard hint tokenizer preserves surrounding translated text'
  );
  const randomRestartPart = hintParts.find(
    (part) => part.type === 'keys' && part.separator === '+'
  );
  assert(
    randomRestartPart?.type === 'keys' && randomRestartPart.keys.join('+') === 'Shift+R',
    'Keyboard hint tokenizer preserves combination-key structure'
  );
  assert(
    randomRestartPart?.type === 'keys' && Object.isFrozen(randomRestartPart.keys),
    'Keyboard hint tokenizer keeps shared key definitions immutable'
  );
  assert(
    splitKeyboardShortcut('Shift+R').join('|') === 'Shift|R',
    'Keyboard shortcut splitter preserves combination-key order'
  );
  const unknownHintParts = tokenizeKeyboardHints('Keep {unknown} and <b>text</b>');
  assert(
    unknownHintParts.length === 1 &&
      unknownHintParts[0]?.type === 'text' &&
      unknownHintParts[0].value === 'Keep {unknown} and <b>text</b>',
    'Keyboard hint tokenizer preserves unknown placeholders and markup as text'
  );

  // 6. MapGenerator Tests
  console.log('\n[MapGenerator]');
  const mapSize = 12;
  const mapSeed = 123;
  const mapDensity = 0.1;

  const mapGridA = new Grid(mapSize, false);
  const mapGenA = new MapGenerator(mapGridA);
  mapGenA.generate(MapTemplate.MAZE_SIMPLE, mapSeed, mapDensity);

  const mapGridB = new Grid(mapSize, false);
  const mapGenB = new MapGenerator(mapGridB);
  mapGenB.generate(MapTemplate.MAZE_SIMPLE, mapSeed, mapDensity);

  const sameObstacles = (a, b) => {
    if (a.size !== b.size) return false;
    for (const key of a) {
      if (!b.has(key)) return false;
    }
    return true;
  };

  assert(
    sameObstacles(mapGridA.obstacles, mapGridB.obstacles),
    'Same seed produces the same obstacles'
  );

  mapGenB.generate(MapTemplate.MAZE_SIMPLE, mapSeed + 1, mapDensity);
  assert(
    !sameObstacles(mapGridA.obstacles, mapGridB.obstacles),
    'Different seed produces different obstacles'
  );

  const mid = Math.floor(mapSize / 2);
  let safeZoneClear = true;
  for (let y = mid - 1; y <= mid + 1; y++) {
    for (let x = mid - 1; x <= mid + 1; x++) {
      if (mapGridA.isObstacle(x, y)) {
        safeZoneClear = false;
        break;
      }
    }
  }
  assert(safeZoneClear, 'Random obstacles avoid the 3x3 safe zone');

  // 7. GameLoop Tests
  console.log('\n[GameLoop]');
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => {
    void cb;
    return 1;
  };
  globalThis.cancelAnimationFrame = (id) => {
    void id;
  };

  /** @type {number[]} */
  const loopAlphas = [];
  let loopUpdates = 0;
  /** @type {GameLoop | null} */
  let loop = null;
  const updateFn = () => {
    loopUpdates++;
    // Change speed inside update to validate accumulator/alpha handling.
    if (loopUpdates === 1) {
      loop?.setSpeed(25);
    }
  };
  const renderFn = (alpha) => {
    loopAlphas.push(alpha);
  };

  loop = new GameLoop(updateFn, renderFn);
  loop.isRunning = true;
  loop.lastTime = 0;
  loop.accumulator = 0;
  loop.setSpeed(10);
  loop._loop(200);
  assert(loopUpdates >= 1, 'Updates run when accumulator exceeds step');
  assert(loopAlphas.length === 1, 'Renders once per frame');
  assert(loop.accumulator >= 0, 'Accumulator never goes negative');
  assert(loopAlphas[0] >= 0 && loopAlphas[0] <= 1, 'Alpha stays within [0, 1] after speed change');

  /** @type {number[]} */
  const capAlphas = [];
  /** @type {number[]} */
  const capTickSteps = [];
  let capUpdates = 0;
  /** @type {GameLoop | null} */
  let capLoop = null;
  const capUpdate = () => {
    capUpdates++;
    if (capLoop) {
      capTickSteps.push(capLoop.tickStep);
    }
  };
  const capRender = (alpha) => {
    capAlphas.push(alpha);
  };
  capLoop = new GameLoop(capUpdate, capRender);
  capLoop.maxUpdatesPerFrame = 5;
  capLoop.isRunning = true;
  capLoop.lastTime = 0;
  capLoop.accumulator = 0;
  capLoop.setSpeed(100);
  capLoop._loop(250);
  const expectedMinStep = 0.25 / capLoop.maxUpdatesPerFrame;
  assert(
    capUpdates <= capLoop.maxUpdatesPerFrame,
    'Update count is capped per frame under low FPS'
  );
  assert(capAlphas[0] >= 0 && capAlphas[0] <= 1, 'Alpha stays within [0, 1] under update cap');
  assert(capTickSteps.length === capUpdates, 'Captures the tick step for every update');
  assert(
    Math.abs(capLoop.tickStep - expectedMinStep) < 1e-9,
    'Capped loop reports the effective tick step'
  );
  assert(
    Math.abs(capLoop.effectiveStep - expectedMinStep) < 1e-9,
    'Capped loop reports the effective render step'
  );
  for (const tickStep of capTickSteps) {
    assert(Math.abs(tickStep - expectedMinStep) < 1e-9, 'Tick uses the capped step under low FPS');
  }

  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCancel;

  // 8. ItemManager Spawn Tests
  console.log('\n[ItemManager]');
  rng.setSeed(123);
  const spawnGrid = new Grid(6, false);
  for (let y = 0; y < 6; y++) {
    spawnGrid.addObstacle(3, y);
  }
  // Force the legacy random picker to return an unreachable cell so the test
  // is deterministic (reachable spawn selection should ignore this).
  spawnGrid.getRandomEmptyCell = () => ({ x: 4, y: 1 });
  const spawnSnake = new Snake(spawnGrid, 1);
  spawnSnake.body = [{ x: 1, y: 1 }];
  spawnSnake.prevBody = [{ x: 1, y: 1 }];
  const spawnSettings = {
    itemEnabled: {
      [ItemType.ROACH]: true,
      [ItemType.TRASH]: false,
      [ItemType.POISON]: false
    },
    itemWeights: {
      [ItemType.ROACH]: 1
    },
    dangerEnabled: false,
    dangerSpawnRate: 4,
    dangerTimeoutSec: 0
  };
  const itemMgr = new ItemManager(spawnGrid, spawnSnake, spawnSettings);
  itemMgr.spawnItem(ItemType.ROACH, 0);
  assert(itemMgr.items.length === 1, 'Spawns a food item');
  assert(itemMgr.items[0].x < 3, 'Food spawns in a reachable region (not behind a sealed wall)');

  rng.setSeed(1);
  const singleFoodGrid = new Grid(6, false);
  const singleFoodSnake = new Snake(singleFoodGrid, 1);
  singleFoodSnake.body = [{ x: 2, y: 2 }];
  singleFoodSnake.prevBody = [{ x: 2, y: 2 }];
  const eggOnlySettings = {
    itemEnabled: {
      [ItemType.ROACH]: false,
      [ItemType.ANT]: false,
      [ItemType.MOSQUITO]: false,
      [ItemType.EGG]: true,
      [ItemType.MOUSE]: false,
      [ItemType.TRASH]: false,
      [ItemType.POISON]: false
    },
    itemWeights: {
      [ItemType.EGG]: 1
    },
    dangerEnabled: false,
    dangerSpawnRate: 4,
    dangerTimeoutSec: 0
  };
  const eggOnlyMgr = new ItemManager(singleFoodGrid, singleFoodSnake, eggOnlySettings);
  eggOnlyMgr.tick(0, 0);
  assert(eggOnlyMgr.items.length === 1, 'Spawns food when only Egg is enabled');
  assert(
    eggOnlyMgr.items[0].type === ItemType.EGG,
    'Spawns Egg when Egg is the only enabled food type'
  );

  rng.setSeed(2);
  const mouseOnlySettings = {
    itemEnabled: {
      [ItemType.ROACH]: false,
      [ItemType.ANT]: false,
      [ItemType.MOSQUITO]: false,
      [ItemType.EGG]: false,
      [ItemType.MOUSE]: true,
      [ItemType.TRASH]: false,
      [ItemType.POISON]: false
    },
    itemWeights: {
      [ItemType.MOUSE]: 1
    },
    dangerEnabled: false,
    dangerSpawnRate: 4,
    dangerTimeoutSec: 0
  };
  const mouseOnlyMgr = new ItemManager(singleFoodGrid, singleFoodSnake, mouseOnlySettings);
  mouseOnlyMgr.tick(0, 0);
  assert(mouseOnlyMgr.items.length === 1, 'Spawns food when only Mouse is enabled');
  assert(
    mouseOnlyMgr.items[0].type === ItemType.MOUSE,
    'Spawns Mouse when Mouse is the only enabled food type'
  );

  // 9. MinHeap Tests
  console.log('\n[MinHeap]');
  const heap = new MinHeap((a, b) => a - b);
  heap.push(5);
  heap.push(1);
  heap.push(3);
  heap.push(2);
  assert(heap.size === 4, 'Tracks heap size');
  assert(heap.pop() === 1, 'Pops smallest item first');
  assert(heap.pop() === 2, 'Pops items in ascending order');
  heap.push(0);
  assert(heap.pop() === 0, 'Handles pushes after pops');
  heap.clear();
  assert(heap.size === 0, 'Clears heap');
  assert(heap.pop() === null, 'Returns null when popping empty heap');

  // 10. Snake Tests
  console.log('\n[Snake]');
  const wallGrid = new Grid(5, false);
  const wallSnake = new Snake(wallGrid, 2);
  wallSnake.body = [
    { x: 4, y: 2 },
    { x: 3, y: 2 }
  ];
  wallSnake._rebuildOccupiedKeys();
  wallSnake.direction = Direction.RIGHT;
  wallSnake.nextDirection = Direction.RIGHT;
  wallSnake.tick();
  assert(wallSnake.isDead, 'Dies on wall collision when wrapWalls is off');
  assert(wallSnake.deathReason === 'wall', 'Death reason is wall');

  const wrapGrid = new Grid(5, true);
  const wrapSnake = new Snake(wrapGrid, 3);
  wrapSnake.body = [
    { x: 0, y: 2 },
    { x: 1, y: 2 },
    { x: 2, y: 2 }
  ];
  wrapSnake._rebuildOccupiedKeys();
  wrapSnake.direction = Direction.LEFT;
  wrapSnake.nextDirection = Direction.LEFT;
  wrapSnake.tick();
  assert(!wrapSnake.isDead, 'Does not die when wrapWalls is on');
  assert(
    wrapSnake.getHead().x === 4 && wrapSnake.getHead().y === 2,
    'WrapWalls wraps head to opposite edge'
  );
  assert(
    wrapSnake.prevBody[0].x === 0 && wrapSnake.prevBody[0].y === 2,
    'prevBody captures head position before tick'
  );

  const obstacleGrid = new Grid(6, false);
  obstacleGrid.addObstacle(3, 3);
  const obstacleSnake = new Snake(obstacleGrid, 2);
  obstacleSnake.body = [
    { x: 2, y: 3 },
    { x: 1, y: 3 }
  ];
  obstacleSnake._rebuildOccupiedKeys();
  obstacleSnake.direction = Direction.RIGHT;
  obstacleSnake.nextDirection = Direction.RIGHT;
  obstacleSnake.tick();
  assert(obstacleSnake.isDead, 'Dies on obstacle collision');
  assert(obstacleSnake.deathReason === 'obstacle', 'Death reason is obstacle');

  const tailGrid = new Grid(6, false);
  const tailSnake = new Snake(tailGrid, 4);
  // U-shape: head can move into tail cell safely when not growing.
  tailSnake.body = [
    { x: 1, y: 1 }, // head
    { x: 2, y: 1 },
    { x: 2, y: 2 },
    { x: 1, y: 2 } // tail (adjacent to head)
  ];
  tailSnake._rebuildOccupiedKeys();
  tailSnake.direction = Direction.RIGHT;
  tailSnake.nextDirection = Direction.RIGHT;
  tailSnake.growthPending = 0;
  tailSnake.shrinkPending = 0;
  tailSnake.setDirection(Direction.DOWN);
  tailSnake.tick();
  assert(!tailSnake.isDead, 'Moving into tail cell is allowed when tail moves away');
  assert(
    tailSnake.getHead().x === 1 && tailSnake.getHead().y === 2,
    'Head moves into previous tail cell'
  );
  assert(
    tailSnake.isOccupied(1, 2),
    'Occupied cache keeps the new head cell after moving into the previous tail cell'
  );

  const selfGrid = new Grid(6, false);
  const selfSnake = new Snake(selfGrid, 4);
  // Move into a non-tail body segment should kill.
  selfSnake.body = [
    { x: 2, y: 2 }, // head
    { x: 3, y: 2 },
    { x: 3, y: 3 },
    { x: 2, y: 3 } // tail
  ];
  selfSnake._rebuildOccupiedKeys();
  selfSnake.direction = Direction.UP;
  selfSnake.nextDirection = Direction.UP;
  selfSnake.setDirection(Direction.RIGHT);
  selfSnake.tick();
  assert(selfSnake.isDead, 'Dies on self collision');
  assert(selfSnake.deathReason === 'self', 'Death reason is self');

  // 10. AIPilot Tests (pathfinding)
  console.log('\n[AIPilot]');
  const grid = new Grid(8, false);
  const snake = {
    direction: { x: 1, y: 0 },
    getHead() {
      return { x: 3, y: 4 };
    },
    isBody(x, y) {
      void x;
      void y;
      return false;
    }
  };
  const itemManager = {
    items: [{ x: 7, y: 4, type: 'roach', id: 1 }]
  };
  const pilot = new AIPilot(grid, snake, itemManager);
  pilot.setAlgorithm(AIAlgorithm.ASTAR);
  pilot.toggle(true);
  pilot.update();
  assert(pilot.currentPath.length > 0, 'A* finds a path to food');
  const lastKey = pilot.currentPath[pilot.currentPath.length - 1];
  const targetKey = itemManager.items[0].y * grid.size + itemManager.items[0].x;
  assert(lastKey === targetKey, 'A* path ends at target');

  const greedyPilot = new AIPilot(grid, snake, itemManager);
  greedyPilot.setAlgorithm(AIAlgorithm.GREEDY);
  greedyPilot.toggle(true);
  greedyPilot.update();
  assert(greedyPilot.currentPath.length > 0, 'Greedy finds a path to food');
  assert(
    greedyPilot.currentPath[greedyPilot.currentPath.length - 1] === targetKey,
    'Greedy path ends at target'
  );

  const avoidGrid = new Grid(6, false);
  const avoidSnake = {
    direction: Direction.RIGHT,
    getHead() {
      return { x: 2, y: 2 };
    },
    isBody(x, y) {
      void x;
      void y;
      return false;
    }
  };
  const avoidItems = {
    items: [
      { x: 4, y: 2, type: ItemType.ROACH, id: 1 },
      { x: 3, y: 2, type: ItemType.TRASH, id: 2 }
    ]
  };
  const avoidTargetKey = avoidItems.items[0].y * avoidGrid.size + avoidItems.items[0].x;
  const avoidDangerKey = avoidItems.items[1].y * avoidGrid.size + avoidItems.items[1].x;

  const avoidPilot = new AIPilot(avoidGrid, avoidSnake, avoidItems);
  avoidPilot.setAlgorithm(AIAlgorithm.ASTAR);
  avoidPilot.toggle(true);
  avoidPilot.update();
  assert(avoidPilot.currentPath.length > 0, 'A* finds a path while avoiding danger items');
  assert(!avoidPilot.currentPath.includes(avoidDangerKey), 'A* avoids danger items');
  assert(
    avoidPilot.currentPath[avoidPilot.currentPath.length - 1] === avoidTargetKey,
    'A* still reaches food while avoiding danger'
  );

  const avoidGreedyPilot = new AIPilot(avoidGrid, avoidSnake, avoidItems);
  avoidGreedyPilot.setAlgorithm(AIAlgorithm.GREEDY);
  avoidGreedyPilot.toggle(true);
  avoidGreedyPilot.update();
  assert(
    avoidGreedyPilot.currentPath.length > 0,
    'Greedy finds a path while avoiding danger items'
  );
  assert(!avoidGreedyPilot.currentPath.includes(avoidDangerKey), 'Greedy avoids danger items');
  assert(
    avoidGreedyPilot.currentPath[avoidGreedyPilot.currentPath.length - 1] === avoidTargetKey,
    'Greedy still reaches food while avoiding danger'
  );

  const wrapAiGrid = new Grid(5, true);
  const wrapAiSnake = {
    direction: { x: 0, y: -1 },
    getHead() {
      return { x: 0, y: 2 };
    },
    isBody(x, y) {
      void x;
      void y;
      return false;
    }
  };
  const wrapAiItems = {
    items: [{ x: 4, y: 2, type: 'roach', id: 1 }]
  };
  const wrapPilot = new AIPilot(wrapAiGrid, wrapAiSnake, wrapAiItems);
  wrapPilot.setAlgorithm(AIAlgorithm.ASTAR);
  wrapPilot.toggle(true);
  wrapPilot.update();
  const wrapTargetKey = wrapAiItems.items[0].y * wrapAiGrid.size + wrapAiItems.items[0].x;
  assert(
    wrapPilot.currentPath.length === 1,
    'A* uses a single wrap step when target is adjacent across boundary'
  );
  assert(wrapPilot.currentPath[0] === wrapTargetKey, 'A* wrap step reaches target');

  const reverseGrid = new Grid(6, false);
  const reverseSnake = {
    direction: { x: 1, y: 0 },
    getHead() {
      return { x: 3, y: 3 };
    },
    isBody(x, y) {
      void x;
      void y;
      return false;
    }
  };
  const reverseItems = {
    items: [{ x: 2, y: 3, type: 'roach', id: 1 }]
  };
  const reversePilot = new AIPilot(reverseGrid, reverseSnake, reverseItems);
  reversePilot.setAlgorithm(AIAlgorithm.BFS);
  reversePilot.toggle(true);
  reversePilot.update();
  const reverseTargetKey = reverseItems.items[0].y * reverseGrid.size + reverseItems.items[0].x;
  assert(reversePilot.currentPath.length > 1, 'BFS avoids immediate reverse move at start');
  assert(
    reversePilot.currentPath[0] !== reverseTargetKey,
    'BFS first step is not the reverse direction'
  );
  assert(
    reversePilot.currentPath[reversePilot.currentPath.length - 1] === reverseTargetKey,
    'BFS still reaches target'
  );

  const staleGrid = new Grid(5, false);
  const staleSnake = {
    direction: Direction.RIGHT,
    getHead() {
      return { x: 2, y: 2 };
    },
    isBody(x, y) {
      void x;
      void y;
      return false;
    }
  };
  const stalePilot = new AIPilot(staleGrid, staleSnake, { items: [] });
  stalePilot.toggle(true);
  const staleHeadKey = staleSnake.getHead().y * staleGrid.size + staleSnake.getHead().x;
  // Simulate a stale path that would require an illegal reverse move.
  stalePilot.currentPath = [staleHeadKey - 1];
  const staleMove = stalePilot.getNextMove();
  assert(
    !!staleMove && staleMove.x === 0 && staleMove.y === -1,
    'Falls back when a stale path would reverse direction'
  );
  assert(stalePilot.currentPath.length === 0, 'Clears stale path after falling back');

  const consumedGrid = new Grid(5, false);
  const consumedSnake = {
    direction: Direction.RIGHT,
    getHead() {
      return { x: 2, y: 2 };
    },
    isBody(x, y) {
      void x;
      void y;
      return false;
    }
  };
  const consumedPilot = new AIPilot(consumedGrid, consumedSnake, { items: [] });
  consumedPilot.toggle(true);
  const consumedHeadKey = consumedSnake.getHead().y * consumedGrid.size + consumedSnake.getHead().x;
  consumedPilot.currentPath = [consumedHeadKey];
  const consumedMove = consumedPilot.getNextMove();
  assert(consumedMove !== null, 'Returns a fallback move when currentPath is fully consumed');

  const staleCollisionGrid = new Grid(5, false);
  staleCollisionGrid.addObstacle(3, 2);
  const staleCollisionSnake = {
    direction: Direction.RIGHT,
    getHead() {
      return { x: 2, y: 2 };
    },
    isBody(x, y) {
      void x;
      void y;
      return false;
    }
  };
  const staleCollisionPilot = new AIPilot(staleCollisionGrid, staleCollisionSnake, { items: [] });
  staleCollisionPilot.toggle(true);
  staleCollisionPilot.currentPath = [2 * staleCollisionGrid.size + 3];
  const staleCollisionMove = staleCollisionPilot.getNextMove();
  assert(
    !!staleCollisionMove && !(staleCollisionMove.x === 1 && staleCollisionMove.y === 0),
    'Avoids stale path steps that now collide'
  );

  const obstacleAiGrid = new Grid(7, false);
  obstacleAiGrid.addObstacle(2, 1);
  obstacleAiGrid.addObstacle(3, 1);
  obstacleAiGrid.addObstacle(4, 1);
  const obstacleAiSnake = {
    direction: { x: 1, y: 0 },
    getHead() {
      return { x: 1, y: 1 };
    },
    isBody(x, y) {
      void x;
      void y;
      return false;
    }
  };
  const obstacleAiItems = {
    items: [{ x: 5, y: 1, type: 'roach', id: 1 }]
  };
  const obstaclePilot = new AIPilot(obstacleAiGrid, obstacleAiSnake, obstacleAiItems);
  obstaclePilot.setAlgorithm(AIAlgorithm.ASTAR);
  obstaclePilot.toggle(true);
  obstaclePilot.update();
  const obstacleTargetKey =
    obstacleAiItems.items[0].y * obstacleAiGrid.size + obstacleAiItems.items[0].x;
  assert(obstaclePilot.currentPath.length > 0, 'A* finds a path around obstacles');
  assert(
    obstaclePilot.currentPath[obstaclePilot.currentPath.length - 1] === obstacleTargetKey,
    'A* reaches target around obstacles'
  );
  let obstaclePathOk = true;
  for (const key of obstaclePilot.currentPath) {
    if (obstacleAiGrid.obstacles.has(key)) {
      obstaclePathOk = false;
      break;
    }
  }
  assert(obstaclePathOk, 'A* path avoids obstacle cells');

  const bodyAiGrid = new Grid(7, false);
  const bodyCells = new Set([3 * 7 + 2, 3 * 7 + 3, 3 * 7 + 4]);
  const bodyAiSnake = {
    direction: { x: 1, y: 0 },
    getHead() {
      return { x: 1, y: 3 };
    },
    isBody(x, y) {
      return bodyCells.has(y * bodyAiGrid.size + x);
    }
  };
  const bodyAiItems = {
    items: [{ x: 5, y: 3, type: 'roach', id: 1 }]
  };
  const bodyPilot = new AIPilot(bodyAiGrid, bodyAiSnake, bodyAiItems);
  bodyPilot.setAlgorithm(AIAlgorithm.ASTAR);
  bodyPilot.toggle(true);
  bodyPilot.update();
  const bodyTargetKey = bodyAiItems.items[0].y * bodyAiGrid.size + bodyAiItems.items[0].x;
  assert(bodyPilot.currentPath.length > 0, 'A* finds a path around snake body');
  assert(
    bodyPilot.currentPath[bodyPilot.currentPath.length - 1] === bodyTargetKey,
    'A* reaches target around snake body'
  );
  let bodyPathOk = true;
  for (const key of bodyPilot.currentPath) {
    if (bodyCells.has(key)) {
      bodyPathOk = false;
      break;
    }
  }
  assert(bodyPathOk, 'A* path avoids snake body cells');

  const scratchGrid = new Grid(6, false);
  const scratchSnake = {
    direction: Direction.RIGHT,
    getHead() {
      return { x: 2, y: 3 };
    },
    isBody(x, y) {
      void x;
      void y;
      return false;
    }
  };
  /** @type {{items: {x: number, y: number, type: string, id: number}[]}} */
  const scratchItems = {
    items: [{ x: 5, y: 3, type: ItemType.ROACH, id: 1 }]
  };
  const scratchPilot = new AIPilot(scratchGrid, scratchSnake, scratchItems);
  scratchPilot.setAlgorithm(AIAlgorithm.BFS);
  scratchPilot.toggle(true);
  scratchPilot.update();

  const scratchParentRef = scratchPilot._scratchParent;
  const scratchClosedRef = scratchPilot._scratchClosed;
  const scratchQueueRef = scratchPilot._scratchQueueKeys;
  const scratchGreedyVisitedRef = scratchPilot._scratchGreedyVisited;

  scratchPilot.update();
  assert(
    scratchPilot._scratchParent === scratchParentRef,
    'BFS reuses scratch parent buffer for same grid size'
  );
  assert(
    scratchPilot._scratchClosed === scratchClosedRef,
    'BFS reuses scratch visited buffer for same grid size'
  );
  assert(
    scratchPilot._scratchQueueKeys === scratchQueueRef,
    'BFS reuses scratch queue buffer for same grid size'
  );
  assert(
    scratchPilot._scratchGreedyVisited === scratchGreedyVisitedRef,
    'BFS keeps greedy scratch buffer allocated'
  );

  scratchPilot.setAlgorithm(AIAlgorithm.GREEDY);
  scratchPilot.update();
  const scratchGreedyVisitedAfterGreedy = scratchPilot._scratchGreedyVisited;
  scratchPilot.update();
  assert(
    scratchPilot._scratchGreedyVisited === scratchGreedyVisitedAfterGreedy,
    'Greedy reuses typed visited buffer for same grid size'
  );

  scratchPilot.grid = new Grid(7, false);
  scratchItems.items = [{ x: 6, y: 3, type: ItemType.ROACH, id: 2 }];
  scratchPilot.setAlgorithm(AIAlgorithm.BFS);
  scratchPilot.update();
  assert(
    scratchPilot._scratchParent !== scratchParentRef,
    'Scratch parent buffer rebuilds when grid size changes'
  );
  assert(
    scratchPilot._scratchQueueKeys !== scratchQueueRef,
    'Scratch queue buffer rebuilds when grid size changes'
  );
  assert(
    scratchPilot._scratchQueueKeys && scratchPilot._scratchQueueKeys.length === 49,
    'Scratch queue buffer length matches resized grid'
  );

  // 11. Service Worker / i18n Cache Coverage
  console.log('\n[Service Worker]');
  const swContents = fs.readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  const localeList = /** @type {string[]} */ (
    JSON.parse(fs.readFileSync(new URL('../../i18n/index.json', import.meta.url), 'utf8'))
  );
  let localesCached = true;
  for (const locale of localeList) {
    const entry = `./i18n/${locale}.json`;
    if (!swContents.includes(entry)) {
      localesCached = false;
      break;
    }
  }
  assert(localesCached, 'Caches every locale from i18n/index.json');
  assert(
    swContents.includes('./scripts/utils/keyboard-hint.js'),
    'Caches keyboard hint utility module'
  );
  assert(
    swContents.includes('./scripts/utils/keyboard-shortcut.js'),
    'Caches keyboard shortcut utility module'
  );
  assert(
    swContents.includes('./scripts/core/daily-v1-algorithm.js'),
    'Caches the frozen daily-v1 algorithm module'
  );
  assert(
    swContents.includes("const CACHE_NAME = 'bug-snake-v2';"),
    'Bumps the cache namespace when the precached application shell changes'
  );

  const mainContents = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert(
    mainContents.includes('const playUrl = new URL(window.location.href);') &&
      mainContents.includes("playUrl.search = '';") &&
      mainContents.includes('const href = playUrl.href;'),
    'About play URL excludes query parameters'
  );

  const gameContents = fs.readFileSync(new URL('../core/game.js', import.meta.url), 'utf8');
  assert(
    gameContents.includes('const activeTickStep = this.loop.step || 1 / 15;'),
    'Timed gameplay rules use the nominal loop step instead of adaptive frame pacing'
  );
  const waitingGuardIndex = gameContents.indexOf('if (this.waitingForInput && !this.ai.enabled)');
  const particleUpdateIndex = gameContents.indexOf('this.particles.update();', waitingGuardIndex);
  assert(
    waitingGuardIndex >= 0 && particleUpdateIndex > waitingGuardIndex,
    'Waiting for first input returns before particle or gameplay updates'
  );
  const aiShortcutStart = gameContents.indexOf("isPlainLetterShortcut(e, 'i')");
  const pathShortcutStart = gameContents.indexOf("isPlainLetterShortcut(e, 'p')");
  const aiShortcutBlock = gameContents.slice(aiShortcutStart, pathShortcutStart);
  assert(
    aiShortcutStart >= 0 &&
      pathShortcutStart > aiShortcutStart &&
      !aiShortcutBlock.includes('!this.waitingForInput'),
    'Ordinary AI shortcut remains available before the first manual move'
  );

  console.log(`\nTests Complete: ${passed} Passed, ${failed} Failed`);
  return failed === 0;
}

if (typeof process !== 'undefined' && process.argv && process.argv[1]) {
  const entryUrl = pathToFileURL(resolvePath(process.argv[1])).href;
  if (import.meta.url === entryUrl) {
    // Only run if executed directly
    runCoreTests();
  }
}
