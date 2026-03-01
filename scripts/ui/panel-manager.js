// @ts-check
/// <reference path="./lil-gui.d.ts" />
import { GUI } from 'https://cdn.jsdelivr.net/npm/lil-gui@0.18.0/dist/lil-gui.esm.min.js';

import { audio } from '../audio/audio-engine.js';
import { GameConfig, SpeedMode, PoisonMode, ItemType } from '../core/config.js';
import { gameState, GameState } from '../core/state-machine.js';
import { i18n } from '../i18n/i18n.js';
import { MapTemplate } from '../maps/map-generator.js';
import { isEditableElement } from '../utils/dom.js';

export class PanelManager {
  constructor(game) {
    this.game = game;
    this.gui = null;
    this.folders = {};
    this._panelPointerHandler = this._handlePanelPointerUp.bind(this);
    this._panelPointerContainer = null;
    this._containerId = null;
  }

  init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
    }

    // Clear container to ensure clean state (removes old buttons/GUI)
    container.innerHTML = '';

    // Add Mobile Close Button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-panel-btn';
    closeBtn.textContent = '✕ ' + i18n.t('ui.close'); // "Close"
    closeBtn.onclick = () => {
      container.classList.remove('active');
    };
    container.appendChild(closeBtn);

    this._containerId = containerId;
    // Append GUI to the container. It will be added after the button.
    this.gui = new GUI({ container: container, width: '100%' });
    this.gui.title(i18n.t('panel.title'));

    // Force relative positioning via JS as well just in case
    this.gui.domElement.style.position = 'relative';

    this._setupGameSettings();
    this._setupItems();
    this._setupAI();
    this._setupVisuals();
    this._setupAudio();
    this._setupPreferences();
    this._collapseFolders();

    if (this._panelPointerContainer) {
      this._panelPointerContainer.removeEventListener('pointerup', this._panelPointerHandler);
    }
    this._panelPointerContainer = container;
    container.addEventListener('pointerup', this._panelPointerHandler);

    // Prevent adding multiple listeners on re-init
    if (!this._i18nListenerAdded) {
      i18n.addListener(() => this._updateLabels());
      this._i18nListenerAdded = true;
    }
  }

  _setupGameSettings() {
    const folder = this.gui.addFolder(i18n.t('panel.settings'));
    this.folders.settings = folder;

    const modeOptions = {
      [i18n.t('mode.classic')]: 'classic',
      [i18n.t('mode.level')]: 'level',
      [i18n.t('mode.timeAttack')]: 'timeAttack'
    };

    folder
      .add(this.game, 'pendingMode', modeOptions)
      .name(this._withRestart('panel.gameMode'))
      .onChange(() => {
        this._needsRestart();
      });

    const templateOptions = {
      [i18n.t('mapTemplate.empty')]: MapTemplate.EMPTY,
      [i18n.t('mapTemplate.crossWall')]: MapTemplate.CROSS_WALL,
      [i18n.t('mapTemplate.pillars')]: MapTemplate.PILLARS,
      [i18n.t('mapTemplate.mazeSimple')]: MapTemplate.MAZE_SIMPLE
    };

    folder
      .add(this.game.settings, 'mapTemplate', templateOptions)
      .name(this._withRestart('panel.difficulty'))
      .onChange(() => this._needsRestart());

    folder
      .add(
        this.game.settings,
        'mapSize',
        GameConfig.map.minSize,
        GameConfig.map.maxSize,
        GameConfig.map.step
      )
      .name(this._withRestart('panel.mapSize'))
      .onChange(() => this._needsRestart());

    folder
      .add(
        this.game.settings,
        'startLength',
        GameConfig.snake.minLength,
        GameConfig.snake.maxLength,
        1
      )
      .name(this._withRestart('panel.startLength'))
      .onChange(() => this._needsRestart());

    folder
      .add(this.game.settings, 'timeLimit', 30, 120, 30)
      .name(this._withRestart('panel.timeLimit'))
      .onChange(() => this._needsRestart());

    folder
      .add(this.game.settings, 'wrapWalls')
      .name(this._withRestart('panel.wallWrap'))
      .onChange(() => this._needsRestart());

    const densityUi = {
      obstacleDensityPercent: Math.round(this.game.settings.obstacleDensity * 100)
    };
    folder
      .add(densityUi, 'obstacleDensityPercent', 0, 15, 1)
      .name(`${i18n.t('panel.obstacleDensity')} (%) *`)
      .onChange((v) => {
        const normalized = Math.max(0, Math.min(15, v)) / 100;
        this.game.settings.obstacleDensity = normalized;
        this._needsRestart();
      });

    const speedModes = {
      [i18n.t('speedMode.fixed')]: SpeedMode.FIXED,
      [i18n.t('speedMode.score')]: SpeedMode.SCORE,
      [i18n.t('speedMode.time')]: SpeedMode.TIME,
      [i18n.t('speedMode.manual')]: SpeedMode.MANUAL
    };

    folder
      .add(this.game.settings, 'speedMode', speedModes)
      .name(i18n.t('panel.speedMode'))
      .onChange(() => {
        this.game.timeManager.elapsedSeconds = 0;
        this.game.timeManager._lastSpeedCheck = 0;
        if (gameState.currentState === GameState.PLAYING) {
          this.game._updateHUD(); // Reflect change
          // Speed update is handled in game loop
        }
      });

    folder
      .add(
        this.game.settings,
        'manualSpeed',
        GameConfig.rules.minSpeed,
        GameConfig.rules.maxSpeed,
        1
      )
      .name(i18n.t('panel.manualSpeed'))
      .onChange((v) => {
        if (
          this.game.settings.speedMode === SpeedMode.MANUAL &&
          gameState.currentState === GameState.PLAYING
        ) {
          this.game.timeManager.currentSpeed = v;
          this.game.loop.setSpeed(v);
          this.game._updateHUD();
        }
      });

    folder
      .add(this.game.config, 'seed')
      .name(this._withRestart('panel.seed'))
      .onChange(() => this._needsRestart());

    folder
      .add({ resetHighScore: () => this._resetHighScore() }, 'resetHighScore')
      .name(i18n.t('ui.resetHighScore'));

    this._renderRestartFootnote(folder);
  }

  _setupVisuals() {
    const folder = this.gui.addFolder(i18n.t('panel.visuals'));
    this.folders.visuals = folder;

    const skinOptions = {
      [i18n.t('skin.classic')]: 'classic',
      [i18n.t('skin.neon')]: 'neon',
      [i18n.t('skin.quantum')]: 'quantum',
      [i18n.t('skin.chrome')]: 'chrome',
      [i18n.t('skin.void')]: 'void'
    };
    if (!this.game.settings.snakeSkin) {
      this.game.settings.snakeSkin = 'classic';
    }

    folder.add(this.game.settings, 'snakeSkin', skinOptions).name(i18n.t('panel.skin'));
  }

  _setupAudio() {
    const folder = this.gui.addFolder(i18n.t('panel.audio'));
    this.folders.audio = folder;

    folder
      .add(this.game.config, 'musicEnabled')
      .name(i18n.t('panel.musicEnabled'))
      .onChange((v) => {
        audio.play('ui_toggle', { enabled: v });
        audio.setMusicEnabled(v);
        if (v && audio.needsMusicGesture()) {
          this.game.showToast(i18n.t('ui.audioUnlock'));
        }
      });

    const audioUi = {
      musicVolumePercent: Math.round(this.game.config.musicVolume * 100),
      sfxVolumePercent: Math.round(this.game.config.sfxVolume * 100)
    };

    folder
      .add(audioUi, 'musicVolumePercent', 0, 100, 1)
      .name(`${i18n.t('panel.musicVolume')} (%)`)
      .onChange((v) => {
        const normalized = Math.max(0, Math.min(100, v)) / 100;
        this.game.config.musicVolume = normalized;
        audio.setMusicVolume(normalized);
      });

    folder
      .add(audioUi, 'sfxVolumePercent', 0, 100, 1)
      .name(`${i18n.t('panel.sfxVolume')} (%)`)
      .onChange((v) => {
        const normalized = Math.max(0, Math.min(100, v)) / 100;
        this.game.config.sfxVolume = normalized;
        audio.setSfxVolume(normalized);
      });
  }

  _setupPreferences() {
    const folder = this.gui.addFolder(i18n.t('panel.preferences'));
    this.folders.preferences = folder;

    folder.add(this.game.settings, 'randomRestart').name(i18n.t('panel.randomRestart'));

    const localeState = { locale: i18n.locale };
    const localeOptions = i18n.getLocaleOptions();
    folder
      .add(localeState, 'locale', localeOptions)
      .name(i18n.t('panel.language'))
      .onChange((value) => {
        i18n.setLocale(value);
      });
  }

  _needsRestart() {
    this.game.showToast(i18n.t('ui.restartRequired'));
    this.game._updateHUD();
  }

  _setupItems() {
    const folder = this.gui.addFolder(i18n.t('panel.items'));
    this.folders.items = folder;

    const foodFolder = folder.addFolder(i18n.t('panel.foodItems'));
    const dangerFolder = folder.addFolder(i18n.t('panel.dangerItems'));

    this._addItemControls(foodFolder, ItemType.ROACH);
    this._addItemControls(foodFolder, ItemType.ANT);
    this._addItemControls(foodFolder, ItemType.MOSQUITO);
    this._addItemControls(foodFolder, ItemType.EGG);
    this._addItemControls(foodFolder, ItemType.MOUSE);

    dangerFolder.add(this.game.settings, 'dangerEnabled').name(i18n.t('panel.dangerEnabled'));

    dangerFolder
      .add(this.game.settings, 'dangerSpawnRate', 1, 10, 1)
      .name(i18n.t('panel.dangerRate'))
      .onChange(() => {
        this.game.itemManager.nextDangerThreshold =
          this.game.itemManager.foodEatenCount + this.game.settings.dangerSpawnRate;
      });

    dangerFolder
      .add(this.game.settings, 'dangerTimeoutSec', 0, 30, 1)
      .name(i18n.t('panel.dangerTimeout'));

    const poisonOptions = {
      [i18n.t('poisonMode.death')]: PoisonMode.DEATH,
      [i18n.t('poisonMode.shrink')]: PoisonMode.SHRINK
    };

    dangerFolder
      .add(this.game.settings, 'poisonMode', poisonOptions)
      .name(i18n.t('panel.poisonMode'));

    this._addItemControls(dangerFolder, ItemType.TRASH);
    this._addItemControls(dangerFolder, ItemType.POISON);
  }

  _setupAI() {
    const folder = this.gui.addFolder(i18n.t('panel.ai'));
    this.folders.ai = folder;

    const aiToggle = folder
      .add(this.game.ai, 'enabled')
      .name(i18n.t('panel.aiControl'))
      .onChange((value) => {
        this.game.ai.toggle(value);
        this.game.resetAiPerformance();
        this.game._updateHUD();
      });
    aiToggle.listen();

    const algoOptions = {
      [i18n.t('ai.greedy')]: 'greedy',
      [i18n.t('ai.bfs')]: 'bfs',
      [i18n.t('ai.astar')]: 'astar'
    };

    folder
      .add(this.game.ai, 'algorithm', algoOptions)
      .name(i18n.t('panel.aiAlgo'))
      .onChange((value) => {
        this.game.ai.setAlgorithm(value);
        this.game.ai.currentPath = [];
      });

    const showPathToggle = folder
      .add(this.game.ai, 'showPath')
      .name(i18n.t('panel.showPath'))
      .onChange((value) => {
        this.game.setPathDisplay(value);
      });
    showPathToggle.listen();

    const pathLengthCtrl = folder
      .add(this.game.ai, 'pathLength', 5, this.game.ai.maxPathLength, 1)
      .name(i18n.t('panel.pathLength'));
    if (pathLengthCtrl?.domElement instanceof HTMLElement) {
      pathLengthCtrl.domElement.classList.add('path-length-control');
    }
  }

  _addItemControls(folder, type) {
    folder.add(this.game.settings.itemEnabled, type).name(i18n.t(`item.${type}`));

    folder
      .add(this.game.settings.itemWeights, type, 0, 100, 1)
      .name(`${i18n.t(`item.${type}`)} ${i18n.t('panel.itemWeight')}`);
  }

  _withRestart(key) {
    return `${i18n.t(key)} *`;
  }

  _renderRestartFootnote(folder) {
    const children = folder?.domElement?.querySelector('.children');
    if (!(children instanceof HTMLElement)) return;

    const note = document.createElement('div');
    note.className = 'panel-restart-footnote';
    note.textContent = `* ${i18n.t('panel.needRestart')}`;
    children.appendChild(note);
  }

  _resetHighScore() {
    if (!confirm(i18n.t('ui.resetHighScoreConfirm'))) return;
    if (!confirm(i18n.t('ui.resetHighScoreConfirmAgain'))) return;
    this.game.resetHighScore(this.game.pendingMode || this.game.gameMode);
  }

  _collapseFolders() {
    for (const folder of Object.values(this.folders)) {
      if (folder) folder.close();
    }
  }

  _handlePanelPointerUp(event) {
    if (isEditableElement(event.target) || isEditableElement(document.activeElement)) {
      return;
    }
    this.game.focusCanvas();
  }

  _updateLabels() {
    this.init('controls-panel');
  }

  refresh() {
    const targetId = this._containerId || 'controls-panel';
    this.init(targetId);
  }
}
