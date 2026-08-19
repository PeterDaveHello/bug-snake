// @ts-check
import { AIPilot } from '../ai/ai-pilot.js';
import { audio } from '../audio/audio-engine.js';
import { i18n } from '../i18n/i18n.js';
import { inputManager, Direction } from '../input/input-manager.js';
import { MapGenerator, MapTemplate } from '../maps/map-generator.js';
import { ParticleSystem } from '../render/particles.js';
import { Renderer } from '../render/renderer.js';
import { isEditableElement, setElementText, setElementVisible } from '../utils/dom.js';
import { isPlainLetterShortcut } from '../utils/keyboard-shortcut.js';

import { GameConfig, SpeedMode, PoisonMode, ItemType } from './config.js';
import { createDailyV1ItemAlgorithm } from './daily-v1-algorithm.js';
import { DeathReviewRecorder, directionToMask } from './death-review-recorder.js';
import { GameLoop } from './game-loop.js';
import { Grid } from './grid.js';
import { ItemManager } from './item-manager.js';
import { ScoreManager } from './score-manager.js';
import { Snake } from './snake.js';
import { gameState, GameState } from './state-machine.js';
import { TimeManager } from './time-manager.js';

const ALL_DIRECTIONS = [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT];

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

/**
 * @typedef {Object} ItemDefinition
 * @property {number} score
 * @property {number} length
 * @property {number} weight
 * @property {string} color
 * @property {number} [speedBoost]
 * @property {boolean} [isPoison]
 */

export class Game {
  constructor() {
    this.config = { ...GameConfig.defaults };
    this.grid = new Grid(GameConfig.map.defaultSize);
    this.snake = new Snake(this.grid);

    this.gameMode = 'classic';
    this.pendingMode = this.gameMode;
    /** @type {number | null} */
    this.challengeAlgorithmVersion = null;

    this.scoreManager = new ScoreManager();
    this.timeManager = new TimeManager();
    /** @type {Readonly<GameplayRules>} */
    this.gameplayRules = GameConfig.rules;
    /** @type {Readonly<Record<string, Readonly<ItemDefinition>>>} */
    this.itemDefinitions = GameConfig.items;

    this.settings = {
      mapTemplate: MapTemplate.EMPTY,
      wrapWalls: GameConfig.rules.defaultWrap,
      obstacleDensity: 0,
      mapSize: GameConfig.map.defaultSize,
      startLength: GameConfig.snake.defaultLength,
      timeLimit: 60,
      snakeSkin: 'classic',
      speedMode: SpeedMode.FIXED,
      manualSpeed: GameConfig.rules.defaultSpeed,
      randomRestart: false,
      dangerEnabled: true,
      dangerSpawnRate: GameConfig.dangerSpawnRate,
      dangerTimeoutSec: GameConfig.dangerTimeoutSec,
      poisonMode: PoisonMode.DEATH,
      itemEnabled: {
        [ItemType.ROACH]: true,
        [ItemType.ANT]: true,
        [ItemType.MOSQUITO]: true,
        [ItemType.EGG]: true,
        [ItemType.MOUSE]: true,
        [ItemType.TRASH]: true,
        [ItemType.POISON]: true
      },
      itemWeights: {
        [ItemType.ROACH]: GameConfig.items[ItemType.ROACH].weight,
        [ItemType.ANT]: GameConfig.items[ItemType.ANT].weight,
        [ItemType.MOSQUITO]: GameConfig.items[ItemType.MOSQUITO].weight,
        [ItemType.EGG]: GameConfig.items[ItemType.EGG].weight,
        [ItemType.MOUSE]: GameConfig.items[ItemType.MOUSE].weight,
        [ItemType.TRASH]: GameConfig.items[ItemType.TRASH].weight,
        [ItemType.POISON]: GameConfig.items[ItemType.POISON].weight
      }
    };

    this.itemManager = new ItemManager(
      this.grid,
      this.snake,
      this.settings,
      this.itemDefinitions,
      null
    );
    this.mapGenerator = new MapGenerator(this.grid);
    this.ai = new AIPilot(this.grid, this.snake, this.itemManager);

    this.level = 1;

    this.renderer = null;
    this.particles = null;

    this.lowFps45Time = 0;
    this.toastTimer = null;
    this.lastDeathReason = null;
    this.waitingForInput = false;
    this._smoothedSpeed = GameConfig.rules.defaultSpeed;
    this._speedSmoothingLastAt = performance.now();
    this._lastInputGraceAppliedAt = 0;
    this._dyingTimer = 0;
    this.deathReviewRecorder = new DeathReviewRecorder();

    this.loop = new GameLoop(this._update.bind(this), this._render.bind(this));
    this.loop.setSpeed(GameConfig.rules.defaultSpeed);

    this.ai.showPath = true;
    this.ai.pathLength = this.ai.maxPathLength;

    this._bindInput();
  }

  init(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      throw new Error(`Canvas not found: ${canvasId}`);
    }

    this.canvas = canvas;
    this.canvas.tabIndex = 0;

    this.renderer = new Renderer(canvas);
    this.particles = new ParticleSystem(this.renderer);
    audio.init();
    audio.setMusicEnabled(this.config.musicEnabled);
    audio.setMusicVolume(this.config.musicVolume);
    audio.setSfxVolume(this.config.sfxVolume);
    if (this.config.musicEnabled && audio.needsMusicGesture()) {
      this.showToast(i18n.t('ui.audioUnlock'));
    }
    this.scoreManager.reset(this.gameMode);

    this.renderer.render(this, 0);
    this._updateHUD();
  }

  start({ randomize = false } = {}) {
    this._startGameSession(randomize, 'ui_start', () => this._reset());
  }

  restartCurrent({ randomize = false } = {}) {
    this._startGameSession(randomize, 'ui', () => {
      if (this.gameMode === 'level') {
        this._restartLevel();
      } else {
        this._reset();
      }
    });
  }

  _startGameSession(randomize, audioCue, resetAction) {
    this.loop.stop();
    this.gameMode = this.pendingMode || this.gameMode;
    this.pendingMode = this.gameMode;

    if (randomize) {
      this._randomizeSettings();
      this.showToast(i18n.t('ui.randomizedSettings'));
    }

    resetAction();

    audio.play(audioCue);
    audio.startMusic();
    gameState.transitionTo(GameState.PLAYING);
    this.loop.start();
  }

  pause() {
    if (gameState.currentState === GameState.PLAYING) {
      gameState.transitionTo(GameState.PAUSED);
      audio.play('ui_back');
    } else if (gameState.currentState === GameState.PAUSED) {
      gameState.transitionTo(GameState.PLAYING);
      audio.play('ui_start');
      this.timeManager._lastSpeedCheck = 0;
      this.timeManager._lastTimeCheck = 0;
    }
  }

  _reset() {
    if (this.gameMode === 'level') {
      this.level = 1;
    }
    this._initializeGameState(this.config.seed, this.settings.obstacleDensity);
  }

  /**
   * @param {number} seed
   * @param {number} density
   */
  _initializeGameState(seed, density) {
    this.grid.size = this.settings.mapSize;
    this.grid.wrapWalls = this.settings.wrapWalls;

    const itemAlgorithm =
      this.challengeAlgorithmVersion === 1
        ? createDailyV1ItemAlgorithm(this.grid, this.settings.mapTemplate, seed, density)
        : null;
    if (!itemAlgorithm) this.mapGenerator.generate(this.settings.mapTemplate, seed, density);
    audio.setMusicProfile({
      seed,
      density,
      template: this.settings.mapTemplate,
      size: this.grid.size
    });

    this.snake = new Snake(this.grid, this.settings.startLength);
    this._clearSnakeObstacles();
    this.itemManager = new ItemManager(
      this.grid,
      this.snake,
      this.settings,
      this.itemDefinitions,
      itemAlgorithm
    );
    this.itemManager.snake = this.snake;

    this.ai.grid = this.grid;
    this.ai.snake = this.snake;
    this.ai.itemManager = this.itemManager;
    this.ai.currentPath = [];

    this.scoreManager.reset(this.gameMode);
    this.timeManager.reset(this.gameMode, this.settings, this.gameplayRules);
    this.resetAiPerformance();
    audio.duck(false);
    audio._resetCombo();

    this.lastDeathReason = null;
    this.waitingForInput = !this.ai.enabled;

    inputManager.clearQueue();

    const speed = this.timeManager.calculateSpeed(performance.now(), 0);
    this._smoothedSpeed = speed;
    this._speedSmoothingLastAt = performance.now();
    this._lastInputGraceAppliedAt = 0;
    this.loop.setSpeed(speed);
    this.deathReviewRecorder.beginRun(this);

    this._updateHUD();
  }

  _update() {
    if (gameState.currentState === GameState.DYING) {
      this.particles.update();
      const dt = this.loop.tickStep != null ? this.loop.tickStep : this.loop.step || 1 / 15;
      this._dyingTimer -= dt;
      if (this._dyingTimer <= 0) {
        gameState.transitionTo(GameState.GAME_OVER);
        this.loop.stop();
        this._updateHUD();
      }
      return;
    }
    if (gameState.currentState !== GameState.PLAYING) return;

    let waitingHeldDirection = null;
    if (this.waitingForInput && !this.ai.enabled) {
      if (!inputManager.hasQueuedDirection() && !inputManager.heldDirection) return;
      if (!inputManager.hasQueuedDirection() && inputManager.heldDirection) {
        waitingHeldDirection = inputManager.heldDirection;
      }
      this.waitingForInput = false;
    }

    // Timed rules advance by the nominal gameplay step, not GameLoop's
    // frame-pacing tickStep. Slow rendering may reduce wall-clock throughput,
    // but it must not change how many rule-seconds each snake move consumes.
    const activeTickStep = this.loop.step || 1 / 15;
    const rules = this.gameplayRules;
    const now = performance.now();

    this.particles.update();

    const targetSpeed = this.timeManager.calculateSpeed(now, this.scoreManager.score);
    const manualBoosting = inputManager.isBoostActive();
    const straightBoosting = this.ai.enabled
      ? inputManager.isHoldingAnyDirection()
      : inputManager.isHoldingCurrentDirection(this.snake.direction);
    let boostDelta = 0;
    if (manualBoosting) {
      boostDelta = rules.manualBoostSpeedDelta;
    } else if (straightBoosting) {
      boostDelta = rules.boostSpeedDelta;
    }
    const targetSpeedWithBoost = boostDelta
      ? Math.min(targetSpeed + boostDelta, rules.maxSpeed)
      : targetSpeed;
    const speedSmoothingOverride = manualBoosting || straightBoosting ? 0 : null;
    // Normal play keeps the existing wall-clock feel. Versioned daily runs
    // advance smoothing from simulation time so catch-up rendering cannot
    // change the speed/active-time sequence for the same gameplay inputs.
    const smoothingElapsedMs =
      this.challengeAlgorithmVersion === null
        ? Math.max(0, now - this._speedSmoothingLastAt)
        : activeTickStep * 1000;
    this._speedSmoothingLastAt = now;
    const finalSpeed = this._getSmoothedSpeed(
      targetSpeedWithBoost,
      smoothingElapsedMs,
      speedSmoothingOverride
    );
    if (Math.abs(this.loop.fpsTarget - finalSpeed) > 0.01) {
      this.loop.setSpeed(finalSpeed);
      this._updateHUD();
    }

    if (this.ai.enabled) {
      this._updateAiPerformance();
    }

    if (this.gameMode === 'timeAttack') {
      const prevTimeLeft = this.timeManager.timeLeft;
      const isTimeUp = this.timeManager.checkTimeAttack(now);
      if (this.timeManager.timeLeft !== prevTimeLeft) {
        this._updateHUD();
      }

      if (isTimeUp) {
        this.scoreManager.checkHighScore();
        gameState.transitionTo(GameState.TIME_UP);
        this.loop.stop();
        return;
      }
    }

    this.ai.update();

    let inputDir = null;
    let consumedQueuedInput = false;
    for (let i = 0; i < 3; i++) {
      const queued = inputManager.getNextDirection();
      if (!queued) break;
      consumedQueuedInput = true;
      // Drop illegal immediate-reverse inputs so they don't delay a valid turn.
      if (this.snake.direction.x + queued.x === 0 && this.snake.direction.y + queued.y === 0) {
        continue;
      }
      inputDir = queued;
      break;
    }

    if (this.ai.enabled && !inputDir) {
      inputDir = this.ai.getNextMove();
    }

    if (!this.ai.enabled && !inputDir) {
      inputDir = waitingHeldDirection || inputManager.heldDirection;
    }

    if (!this.ai.enabled && !inputDir && !consumedQueuedInput) {
      const lastInputAt = inputManager.getLastDirectionInputAt();
      if (
        lastInputAt > 0 &&
        lastInputAt !== this._lastInputGraceAppliedAt &&
        Date.now() - lastInputAt <= rules.inputGraceMs
      ) {
        this._lastInputGraceAppliedAt = lastInputAt;
        return;
      }
    }

    const hadDirectPlayerInput = !this.ai.enabled && Boolean(inputDir);

    if (!this.ai.enabled) {
      const plannedDirection = inputDir || this.snake.direction;
      inputDir = this._getAssistedDirection(plannedDirection);
    }

    if (hadDirectPlayerInput) {
      const lastInputAt = inputManager.getLastDirectionInputAt();
      if (lastInputAt > 0) {
        this._lastInputGraceAppliedAt = lastInputAt;
      }
    }

    if (inputDir) {
      this.snake.setDirection(inputDir);
    }

    const attemptedDirection = this.snake.nextDirection;
    this.deathReviewRecorder.markDecision({
      attemptedDirection,
      safeDirectionMask: this._getSafeDirectionMask(activeTickStep),
      inspection: this.inspectMove(attemptedDirection, activeTickStep),
      stepDurationMs: activeTickStep * 1000
    });

    this.snake.tick();

    if (this.snake.isDead) {
      this._handleGameOver();
      return;
    }

    this.itemManager.tick(activeTickStep, now);
    this.timeManager.advanceActiveTime(activeTickStep);

    const head = this.snake.getHead();
    const hitItemType = this.itemManager.checkCollision(head.x, head.y);

    if (hitItemType) {
      const def = this.itemDefinitions[hitItemType];
      if (def && def.score > 0) {
        this.itemManager.recordConsumption();
      }
      this._handleItemCollection(hitItemType, head, now);
    }

    if (!this.snake.isDead) {
      this.deathReviewRecorder.captureFrame(this, activeTickStep * 1000);
    }
  }

  _handleItemCollection(type, head, now) {
    const def = this.itemDefinitions[type];
    if (!def) return;

    this.scoreManager.add(def.score);
    if (def.score > 0) {
      this.scoreManager.incrementItemsCollected();
    }

    this._updateAudioContext(type, def);

    if (type === ItemType.POISON) {
      this._handlePoison(head, def);
      if (this.snake.isDead) return;
    } else {
      this._handleStandardItem(type, head, def);
    }

    if (def.speedBoost) {
      this.timeManager.activateSpeedBoost(def.speedBoost);
    }

    this._checkLevelProgress();
    this._updateHUD();
  }

  _updateAudioContext(type, def) {
    const currentLength = this.snake.body.length;
    let lengthChange = def.length;

    if (type === ItemType.POISON && this.settings.poisonMode === PoisonMode.SHRINK) {
      lengthChange = -this.gameplayRules.poisonShrinkAmount;
    }

    const projectedLength = Math.max(1, currentLength + lengthChange);
    audio.setSnakeLength(projectedLength);
  }

  _handlePoison(head, def) {
    audio.play('poison');
    this.particles.emit(head.x, head.y, def.color, 12);
    if (this.particles.emitText) {
      this.particles.emitText(head.x, head.y, '' + def.score, def.color);
    }

    if (this.settings.poisonMode === PoisonMode.DEATH) {
      this.snake.deathReason = 'poison';
      this.snake.isDead = true;
      this._handleGameOver();
      return;
    }

    this.snake.shrink(this.gameplayRules.poisonShrinkAmount);
  }

  _handleStandardItem(type, head, def) {
    if (def.length > 0) {
      this.snake.grow(def.length);
      const foodSounds = {
        [ItemType.ROACH]: 'eat_roach',
        [ItemType.ANT]: 'eat_ant',
        [ItemType.MOSQUITO]: 'eat_mosquito',
        [ItemType.EGG]: 'eat_egg',
        [ItemType.MOUSE]: 'eat_mouse'
      };
      audio.play(foodSounds[type] || 'eat');
      this.particles.emit(head.x, head.y, def.color, 8);
      if (this.particles.emitText) {
        this.particles.emitText(head.x, head.y, '+' + def.score, def.color);
      }
    } else if (def.length < 0) {
      this.snake.shrink(Math.abs(def.length));
      audio.play('eat_bad');
      this.particles.emit(head.x, head.y, def.color, 12);
      if (this.particles.emitText) {
        this.particles.emitText(head.x, head.y, '' + def.length, def.color);
      }
    }
  }

  _checkLevelProgress() {
    if (this.gameMode !== 'level') return;

    const levelTarget = this.level * 10;
    if (this.scoreManager.itemsCollected >= levelTarget) {
      audio.play('level_clear');
      this.scoreManager.checkHighScore();
      gameState.transitionTo(GameState.LEVEL_CLEAR);
      this.loop.stop();
      // Increment after transition so listeners see the completed level number
      this.level++;
    }
  }

  startNextLevel() {
    this.scoreManager.itemsCollected = 0;

    const levelSeed = this.config.seed + this.level;
    const levelDensity = Math.min(0.25, this.settings.obstacleDensity + 0.02 * this.level);

    const itemAlgorithm =
      this.challengeAlgorithmVersion === 1
        ? createDailyV1ItemAlgorithm(this.grid, this.settings.mapTemplate, levelSeed, levelDensity)
        : null;
    if (!itemAlgorithm) {
      this.mapGenerator.generate(this.settings.mapTemplate, levelSeed, levelDensity);
    }
    audio.setMusicProfile({
      seed: levelSeed,
      density: levelDensity,
      template: this.settings.mapTemplate,
      size: this.grid.size
    });

    this.snake = new Snake(this.grid, this.settings.startLength);
    this._clearSnakeObstacles();
    this.itemManager = new ItemManager(
      this.grid,
      this.snake,
      this.settings,
      this.itemDefinitions,
      itemAlgorithm
    );
    this.itemManager.snake = this.snake;

    this.ai.grid = this.grid;
    this.ai.snake = this.snake;
    this.ai.itemManager = this.itemManager;
    this.ai.currentPath = [];

    this.waitingForInput = !this.ai.enabled;
    this.resetAiPerformance();

    const now = performance.now();
    this.timeManager._lastSpeedCheck = now;
    const speed = this.timeManager.calculateSpeed(now, this.scoreManager.score);
    this._smoothedSpeed = speed;
    this._speedSmoothingLastAt = now;
    this._lastInputGraceAppliedAt = 0;
    this.loop.setSpeed(speed);

    inputManager.clearQueue();
    this.deathReviewRecorder.beginRun(this);
    this._updateHUD();

    gameState.transitionTo(GameState.PLAYING);
    this.loop.start();
    audio.play('ui');
  }

  _restartLevel() {
    const level = this.level;

    let levelSeed;
    let levelDensity;
    if (level <= 1) {
      levelSeed = this.config.seed;
      levelDensity = this.settings.obstacleDensity;
    } else {
      levelSeed = this.config.seed + level;
      levelDensity = Math.min(0.25, this.settings.obstacleDensity + 0.02 * level);
    }

    this._initializeGameState(levelSeed, levelDensity);
    this.level = level;
  }

  _clearSnakeObstacles() {
    if (!this.grid || !this.snake) return;
    for (const segment of this.snake.body) {
      this.grid.removeObstacle(segment.x, segment.y);
    }
  }

  _randomizeSettings() {
    const templates = [
      MapTemplate.EMPTY,
      MapTemplate.CROSS_WALL,
      MapTemplate.PILLARS,
      MapTemplate.MAZE_SIMPLE
    ];
    const maxMapSize = Math.min(GameConfig.map.maxSize, GameConfig.randomizer.maxMapSize);
    const mapSizes = [];
    for (let size = GameConfig.map.minSize; size <= maxMapSize; size += GameConfig.map.step) {
      mapSizes.push(size);
    }

    this.settings.mapTemplate = templates[Math.floor(Math.random() * templates.length)];
    this.settings.mapSize = mapSizes[Math.floor(Math.random() * mapSizes.length)];
    this.settings.wrapWalls = Math.random() < GameConfig.randomizer.wrapChance;

    const density = Math.random() * GameConfig.randomizer.densityMax;
    this.settings.obstacleDensity = Math.round(density * 100) / 100;
    this.settings.startLength = Math.min(
      GameConfig.snake.maxLength,
      GameConfig.snake.defaultLength + Math.floor(Math.random() * 3)
    );

    if (this.settings.speedMode === SpeedMode.MANUAL) {
      const minSpeed = Math.max(GameConfig.rules.minSpeed, GameConfig.randomizer.speedMin);
      const maxSpeed = Math.min(GameConfig.rules.maxSpeed, GameConfig.randomizer.speedMax);
      const speed = Math.floor(Math.random() * (maxSpeed - minSpeed + 1)) + minSpeed;
      this.settings.manualSpeed = speed;
    }

    this.config.seed = Date.now() + Math.floor(Math.random() * 1000);
  }

  _handleGameOver() {
    audio.play('die');
    audio.duck(true);

    this.scoreManager.checkHighScore();
    this.lastDeathReason = this.snake.deathReason || 'unknown';
    this.deathReviewRecorder.finish(this.lastDeathReason);

    this._dyingTimer = 1.0;
    gameState.transitionTo(GameState.DYING);
    // Loop continues — renderer draws death animation
    // _update() handles DYING countdown and transitions to GAME_OVER
  }

  getDeathReview() {
    return this.deathReviewRecorder.getReview();
  }

  resetHighScore(mode = this.gameMode) {
    this.scoreManager.setHighScore(0, mode);
    if (mode === this.gameMode) {
      this._updateHUD();
    }
  }

  focusCanvas() {
    if (this.canvas) {
      this.canvas.focus();
    }
  }

  setPathDisplay(enabled) {
    this.ai.showPath = enabled;
  }

  resetAiPerformance() {
    this.lowFps45Time = 0;
    this.ai.updateEveryNTicks = 1;
    this.ai.tickCounter = 0;
  }

  showToast(message, duration = 2000) {
    const toast = document.getElementById('status-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('active');

    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => {
      toast.classList.remove('active');
      toast.textContent = '';
    }, duration);
  }

  _updateAiPerformance() {
    const fps = this.loop.fps || 60;
    const tickStep = this.loop.tickStep || this.loop.step;
    if (fps < 45) {
      this.lowFps45Time += tickStep;
    } else {
      this.lowFps45Time = 0;
    }

    const shouldThrottleAiPathing = this.lowFps45Time >= 2 && this.ai.showPath;
    const updateEvery = shouldThrottleAiPathing ? 3 : 1;
    if (this.ai.updateEveryNTicks !== updateEvery) {
      this.ai.updateEveryNTicks = updateEvery;
      this.ai.tickCounter = 0;
    }
  }

  _render(alpha) {
    if (this.renderer) {
      this.renderer.render(this, alpha);

      if (this.ai.enabled) {
        const pathAlpha = gameState.currentState === GameState.PLAYING ? alpha : 1;
        this.ai.drawPath(
          this.renderer.ctx,
          this.renderer.cellSize,
          this.renderer.offsetX,
          this.renderer.offsetY,
          pathAlpha
        );
      }
    }
    if (this.particles && this.renderer) {
      this.particles.draw(this.renderer.ctx);
    }
  }

  _bindInput() {
    window.addEventListener('keydown', (e) => {
      if (isEditableElement(e.target) && e.key !== 'Escape') {
        return;
      }

      if (e.key === 'Escape') {
        this.pause();
      }

      if (isPlainLetterShortcut(e, 'i')) {
        if (
          gameState.currentState === GameState.PLAYING ||
          gameState.currentState === GameState.PAUSED
        ) {
          this.ai.toggle(!this.ai.enabled);
          this.resetAiPerformance();
          this._updateHUD();
        }
      }

      if (isPlainLetterShortcut(e, 'p')) {
        if (
          gameState.currentState === GameState.PLAYING ||
          gameState.currentState === GameState.PAUSED
        ) {
          this.setPathDisplay(!this.ai.showPath);
          this._updateHUD();
        }
      }
    });
  }

  /**
   * Inspect a prospective move for review analysis, including lethal items.
   * The active step is projected because danger expiry is processed after the
   * snake moves but before item collision in the actual update loop.
   * @param {{x: number, y: number}} dir
   * @param {number} [activeTickStep] Active gameplay time in seconds.
   * @returns {{
   *   allowed: boolean,
   *   reason: string | null,
   *   target: {x: number, y: number} | null,
   *   normalizedTarget: {x: number, y: number} | null
   * }}
   */
  inspectMove(dir, activeTickStep = 0) {
    const inspection = this.snake.inspectMove(dir);
    if (!inspection.allowed || !inspection.normalizedTarget) return inspection;

    const item = this.itemManager.getItemAt(
      inspection.normalizedTarget.x,
      inspection.normalizedTarget.y
    );
    if (
      item?.type === ItemType.POISON &&
      this.settings.poisonMode === PoisonMode.DEATH &&
      !this.itemManager.willItemExpireAfter(item, activeTickStep)
    ) {
      return { ...inspection, allowed: false, reason: 'poison' };
    }
    return inspection;
  }

  /**
   * @param {number} [activeTickStep] Active gameplay time in seconds.
   * @returns {number}
   */
  _getSafeDirectionMask(activeTickStep = 0) {
    let mask = 0;
    for (const direction of ALL_DIRECTIONS) {
      if (this.inspectMove(direction, activeTickStep).allowed) {
        mask |= directionToMask(direction);
      }
    }
    return mask;
  }

  /**
   * Turn assist intentionally checks map and body collisions with
   * `snake.inspectMove()`. Review analysis uses `this.inspectMove()` so lethal
   * poison is reported as unsafe without changing existing gameplay behavior.
   * @param {{x: number, y: number}} dir
   * @returns {boolean}
   */
  _isImmediateDeathDirection(dir) {
    return !this.snake.inspectMove(dir).allowed;
  }

  /**
   * @param {{x: number, y: number}} plannedDirection
   * @returns {{x: number, y: number}}
   */
  _getAssistedDirection(plannedDirection) {
    if (!this._isImmediateDeathDirection(plannedDirection)) {
      return plannedDirection;
    }

    let safeCount = 0;
    let safeDir = null;
    for (let i = 0; i < ALL_DIRECTIONS.length; i++) {
      const dir = ALL_DIRECTIONS[i];
      if (dir.x === plannedDirection.x && dir.y === plannedDirection.y) {
        continue;
      }
      if (this.snake.direction.x + dir.x === 0 && this.snake.direction.y + dir.y === 0) {
        continue;
      }
      if (!this._isImmediateDeathDirection(dir)) {
        safeCount++;
        safeDir = dir;
        if (safeCount > 1) break;
      }
    }

    return safeCount === 1 ? safeDir : plannedDirection;
  }

  /**
   * @param {number} targetSpeed
   * @param {number} elapsedMs
   * @param {number | null} [smoothingMsOverride]
   * @returns {number}
   */
  _getSmoothedSpeed(targetSpeed, elapsedMs, smoothingMsOverride = null) {
    const smoothingMs =
      smoothingMsOverride === null ? this.gameplayRules.speedSmoothingMs : smoothingMsOverride;
    if (smoothingMs <= 0) {
      this._smoothedSpeed = targetSpeed;
      return targetSpeed;
    }

    const normalizedElapsedMs = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
    const ratio = Math.min(1, normalizedElapsedMs / smoothingMs);
    this._smoothedSpeed += (targetSpeed - this._smoothedSpeed) * ratio;
    if (Math.abs(this._smoothedSpeed - targetSpeed) < 0.05) {
      this._smoothedSpeed = targetSpeed;
    }
    return this._smoothedSpeed;
  }

  _updateHUD() {
    setElementText('hud-score-val', this.scoreManager.score.toString());
    setElementText('hud-high-val', this.scoreManager.highScore.toString());
    setElementText('hud-mode-val', i18n.t(`mode.${this.gameMode}`));
    setElementText('hud-length-val', this.snake.body.length.toString());
    setElementText('hud-level-val', this.level.toString());
    setElementText('hud-time-val', this.timeManager.timeLeft.toString());
    const speedStep = this.loop.tickStep || this.loop.step;
    setElementText('hud-speed-val', Math.round(1 / speedStep).toString());
    setElementText('hud-ai-val', this.ai.enabled ? i18n.t('ui.on') : i18n.t('ui.off'));

    setElementVisible('hud-time-container', this.gameMode === 'timeAttack');
    setElementVisible('hud-level-container', this.gameMode === 'level');
  }
}

export const game = new Game();
