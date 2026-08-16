// @ts-check
import { DailyChallengeStore } from '../core/daily-challenge-store.js';
import {
  createDailyChallenge,
  decodeDailyShare,
  encodeDailyShare,
  getLocalDateKey,
  isDailyShareSupported
} from '../core/daily-challenge.js';
import { game } from '../core/game.js';
import { gameState, GameState } from '../core/state-machine.js';
import { i18n } from '../i18n/i18n.js';
import { returnToTitleScreen } from '../main.js';

const STYLE_ID = 'daily-challenge-style';
const STYLE_HREF = './styles/daily-challenge.css';
const SHARE_PARAM = 'c';
const READY_TIMEOUT_MS = 8000;
const METRIC_VALUE_MARKER = '__DAILY_METRIC_VALUE__';

class DailyChallengeController {
  constructor() {
    this.store = new DailyChallengeStore();
    this.challenge = createDailyChallenge(getLocalDateKey());
    /** @type {number | null} */
    this.sharedScore = null;
    this.invalidShare = false;
    this.shareUnavailable = false;
    this.sharedChallenge = false;
    this.active = false;
    this.completed = false;
    /** @type {{seed: number, gameMode: string, pendingMode: string, aiEnabled: boolean, challengeAlgorithmVersion: number | null, gameplayRules: typeof game.gameplayRules, itemDefinitions: typeof game.itemDefinitions, settings: {mapTemplate: string, wrapWalls: boolean, obstacleDensity: number, mapSize: number, startLength: number, speedMode: string, randomRestart: boolean, dangerEnabled: boolean, dangerSpawnRate: number, dangerTimeoutSec: number, poisonMode: string, itemEnabled: Record<string, boolean>, itemWeights: Record<string, number>}} | null} */
    this.snapshot = null;
    this.record = this.store.getRecord(this.challenge.challengeId);
    /** @type {Record<string, HTMLElement>} */
    this.elements = {};
    this._keydownHandler = this._handleKeydown.bind(this);
    this._previewRefreshHandler = this._refreshAndRescheduleLocalChallengePreview.bind(this);
    this._visibilityHandler = this._handleVisibilityChange.bind(this);
    /** @type {number | null} */
    this._midnightRefreshTimer = null;
  }

  async init() {
    await this._waitForAppReady();
    this._ensureStylesheet();
    await this._readSharedChallenge();
    this.record = this.store.getRecord(this.challenge.challengeId);
    this._createTitleCard();
    this._createResultPanel();
    this._createHudBadge();
    this._bindEvents();
    // Re-check the local date after asynchronous readiness/share decoding. If
    // initialization crossed midnight, schedule from the corrected day rather
    // than leaving yesterday's preview visible until the following midnight.
    this._refreshLocalChallengePreview();
    this._scheduleMidnightRefresh();
  }

  _waitForAppReady() {
    let remainingVisibleMs = READY_TIMEOUT_MS;
    let lastCheckedAt = performance.now();
    let wasVisible = !document.hidden;
    return new Promise((resolve, reject) => {
      const check = () => {
        const now = performance.now();
        const visible = !document.hidden;
        if (visible && wasVisible) {
          remainingVisibleMs -= Math.min(now - lastCheckedAt, 250);
        }
        lastCheckedAt = now;
        wasVisible = visible;

        const translatedTitle = i18n.t('ui.title');
        if (game.renderer && translatedTitle && !translatedTitle.startsWith('[[')) {
          resolve(undefined);
          return;
        }
        if (remainingVisibleMs <= 0) {
          reject(new Error('Daily challenge initialization timed out'));
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
  }

  _ensureStylesheet() {
    if (document.getElementById(STYLE_ID)) return;
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = STYLE_HREF;
    document.head.append(link);
  }

  async _readSharedChallenge() {
    const token = new URL(window.location.href).searchParams.get(SHARE_PARAM);
    if (!token) return;
    if (!isDailyShareSupported()) {
      this.shareUnavailable = true;
      return;
    }

    try {
      const decoded = await decodeDailyShare(token);
      if (!decoded) {
        this.invalidShare = true;
        return;
      }
      this.challenge = decoded.challenge;
      this.sharedScore = decoded.score;
      this.sharedChallenge = true;
    } catch {
      this.invalidShare = true;
    }
  }

  _createTitleCard() {
    const titleScreen = document.getElementById('title-screen');
    const startButton = document.getElementById('btn-start-game');
    if (!titleScreen || !startButton) return;

    const card = document.createElement('section');
    card.id = 'daily-challenge-card';
    card.className = 'daily-challenge-card';
    card.setAttribute('aria-labelledby', 'daily-challenge-title');

    const heading = document.createElement('h2');
    heading.id = 'daily-challenge-title';
    const date = document.createElement('p');
    date.id = 'daily-challenge-date';
    date.className = 'daily-challenge-date';

    const metrics = document.createElement('div');
    metrics.className = 'daily-challenge-metrics';
    const best = createMetric('daily-challenge-best');
    const completedRuns = createMetric('daily-challenge-completed-runs');
    const friendScore = createMetric(
      'daily-challenge-friend-score',
      'daily-challenge-metric daily-challenge-metric-friend'
    );
    friendScore.hidden = true;
    metrics.append(best, completedRuns, friendScore);

    const rulesTitle = document.createElement('h3');
    rulesTitle.id = 'daily-challenge-rules-title';
    rulesTitle.className = 'daily-challenge-section-title';

    const rules = document.createElement('dl');
    rules.id = 'daily-challenge-rules';
    rules.className = 'daily-challenge-rules';
    rules.setAttribute('aria-labelledby', rulesTitle.id);
    const mapRule = createRule('daily-rule-map-label', 'daily-rule-map-value');
    const speedRule = createRule('daily-rule-speed-label', 'daily-rule-speed-value');
    const poisonRule = createRule('daily-rule-poison-label', 'daily-rule-poison-value');
    rules.append(mapRule.item, speedRule.item, poisonRule.item);

    const sharedDisclaimer = document.createElement('p');
    sharedDisclaimer.id = 'daily-challenge-share-disclaimer';
    sharedDisclaimer.className = 'daily-result-disclaimer';
    sharedDisclaimer.hidden = true;

    const warning = document.createElement('p');
    warning.id = 'daily-challenge-warning';
    warning.className = 'daily-challenge-warning';
    warning.setAttribute('role', 'status');

    const button = document.createElement('button');
    button.id = 'btn-daily-challenge';
    button.type = 'button';

    card.append(
      heading,
      date,
      metrics,
      rulesTitle,
      rules,
      sharedDisclaimer,
      warning,
      button
    );
    const guide = titleScreen.querySelector('.title-guide');
    titleScreen.insertBefore(card, guide);

    this.elements.card = card;
    this.elements.title = heading;
    this.elements.date = date;
    this.elements.best = best;
    this.elements.completedRuns = completedRuns;
    this.elements.friendScore = friendScore;
    this.elements.rulesTitle = rulesTitle;
    this.elements.ruleMapLabel = mapRule.label;
    this.elements.ruleMapValue = mapRule.value;
    this.elements.ruleSpeedLabel = speedRule.label;
    this.elements.ruleSpeedValue = speedRule.value;
    this.elements.rulePoisonLabel = poisonRule.label;
    this.elements.rulePoisonValue = poisonRule.value;
    this.elements.sharedDisclaimer = sharedDisclaimer;
    this.elements.warning = warning;
    this.elements.startButton = button;
  }

  _createResultPanel() {
    const gameOver = document.getElementById('game-over-screen');
    const prompt = document.getElementById('game-over-prompt');
    if (!gameOver || !prompt) return;

    const panel = document.createElement('section');
    panel.id = 'daily-result-panel';
    panel.className = 'daily-result-panel';
    panel.hidden = true;

    const title = document.createElement('h3');
    title.id = 'daily-result-title';

    const metrics = document.createElement('div');
    metrics.className = 'daily-result-metrics';
    const best = createMetric('daily-result-best', 'daily-result-metric');
    const completedRuns = createMetric(
      'daily-result-completed-runs',
      'daily-result-metric'
    );
    metrics.append(best, completedRuns);

    const newBest = document.createElement('p');
    newBest.id = 'daily-result-new-best';
    newBest.className = 'daily-result-new-best';
    newBest.setAttribute('aria-live', 'polite');
    const disclaimer = document.createElement('p');
    disclaimer.id = 'daily-result-disclaimer';
    disclaimer.className = 'daily-result-disclaimer';

    const shareStatus = document.createElement('div');
    shareStatus.id = 'daily-share-status';
    shareStatus.className = 'daily-share-status';
    shareStatus.hidden = true;
    shareStatus.setAttribute('role', 'status');
    shareStatus.setAttribute('aria-live', 'polite');
    shareStatus.setAttribute('aria-atomic', 'true');
    const shareStatusMessage = document.createElement('span');
    shareStatusMessage.id = 'daily-share-status-message';
    shareStatusMessage.className = 'daily-share-status-message';
    const shareStatusUrl = document.createElement('code');
    shareStatusUrl.id = 'daily-share-status-url';
    shareStatusUrl.className = 'daily-share-status-url';
    shareStatusUrl.dir = 'ltr';
    shareStatus.append(shareStatusMessage, shareStatusUrl);

    const actions = document.createElement('div');
    actions.className = 'daily-result-actions';
    const share = document.createElement('button');
    share.id = 'btn-daily-share';
    share.type = 'button';
    const exit = document.createElement('button');
    exit.id = 'btn-daily-exit';
    exit.type = 'button';
    actions.append(share, exit);
    panel.append(title, metrics, newBest, disclaimer, shareStatus, actions);
    gameOver.insertBefore(panel, prompt);

    this.elements.resultPanel = panel;
    this.elements.resultTitle = title;
    this.elements.resultBest = best;
    this.elements.resultCompletedRuns = completedRuns;
    this.elements.resultNewBest = newBest;
    this.elements.resultDisclaimer = disclaimer;
    this.elements.shareStatus = shareStatus;
    this.elements.shareStatusMessage = shareStatusMessage;
    this.elements.shareStatusUrl = shareStatusUrl;
    this.elements.shareButton = share;
    this.elements.exitButton = exit;
  }

  _createHudBadge() {
    const hud = document.getElementById('hud');
    if (!hud) return;
    const badge = document.createElement('div');
    badge.id = 'hud-daily-challenge';
    badge.className = 'hud-item hud-daily-challenge';
    badge.hidden = true;
    hud.append(badge);
    this.elements.hudBadge = badge;
  }

  _bindEvents() {
    this.elements.startButton?.addEventListener('click', () => this._startChallenge());
    this.elements.shareButton?.addEventListener('click', () => {
      this._shareResult().catch((error) => {
        if (isAbortError(error)) return;
        console.warn('[Daily] Share failed:', error);
        game.showToast(i18n.t('ui.error'));
      });
    });
    this.elements.exitButton?.addEventListener('click', () => this._exitChallenge());
    window.addEventListener('keydown', this._keydownHandler, true);
    window.addEventListener('focus', this._previewRefreshHandler);
    window.addEventListener('pageshow', this._previewRefreshHandler);
    document.addEventListener('visibilitychange', this._visibilityHandler);
    i18n.addListener(() => this._updateUI());
    gameState.onStateChange((current, previous) => {
      if (!this.active) return;
      if (current === GameState.PLAYING && previous === GameState.GAME_OVER) {
        // Restarting from a completed result intentionally starts another daily
        // run. Re-arm completion for that run and lock the result-only retry
        // button again until its GAME_OVER result has been recorded.
        this.completed = false;
        this.record = this.store.getRecord(this.challenge.challengeId);
        game.scoreManager.setHighScoreOverride(this.record.bestScore);
        game._updateHUD();
        this._setRetryEnabled(false);
        this._hideShareStatus();
        if (this.elements.resultPanel instanceof HTMLElement)
          this.elements.resultPanel.hidden = true;
        this._updateUI();
      }
      if (current === GameState.GAME_OVER) this._completeChallenge();
    });
  }

  _handleVisibilityChange() {
    if (!document.hidden) this._refreshAndRescheduleLocalChallengePreview();
  }

  _refreshAndRescheduleLocalChallengePreview() {
    this._refreshLocalChallengePreview();
    this._scheduleMidnightRefresh();
  }

  _scheduleMidnightRefresh() {
    if (this._midnightRefreshTimer !== null) {
      window.clearTimeout(this._midnightRefreshTimer);
    }

    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const delay = Math.max(1_000, nextMidnight.getTime() - now.getTime() + 100);
    this._midnightRefreshTimer = window.setTimeout(() => {
      this._midnightRefreshTimer = null;
      this._refreshLocalChallengePreview();
      this._scheduleMidnightRefresh();
    }, delay);
  }

  _refreshLocalChallengePreview() {
    if (this.active) return;

    // Shared links keep their encoded date/rules, but their local best and
    // completed-run count can still change in another tab.
    if (!this.sharedChallenge) {
      const today = getLocalDateKey();
      if (this.challenge.dateKey !== today) {
        this.challenge = createDailyChallenge(today);
      }
    }
    this.record = this.store.getRecord(this.challenge.challengeId);
    this._updateUI();
  }

  _startChallenge() {
    if (this.active) return;

    this._refreshLocalChallengePreview();

    this.record = this.store.getRecord(this.challenge.challengeId);
    this.snapshot = this._captureSettings();
    this._applyChallengeSettings();
    this.active = true;
    this.completed = false;
    this._hideShareStatus();
    document.body.classList.add('daily-challenge-active');
    this._lockSettings(true);
    game.scoreManager.setHighScoreOverride(this.record.bestScore);
    game.ai.toggle(false);
    game.pendingMode = 'classic';
    game.config.seed = this.challenge.seed;
    this._updateUI();

    const normalStart = document.getElementById('btn-start-game');
    if (normalStart instanceof HTMLButtonElement) normalStart.click();
  }

  _completeChallenge() {
    if (this.completed) return;
    this.completed = true;
    this._hideShareStatus();
    const result = this.store.recordResult(this.challenge.challengeId, game.scoreManager.score);
    this.record = result.record;
    game.scoreManager.setHighScoreOverride(this.record.bestScore);
    if (this.elements.resultPanel instanceof HTMLElement) this.elements.resultPanel.hidden = false;
    this._setRetryEnabled(true);
    if (this.elements.resultNewBest instanceof HTMLElement) {
      this.elements.resultNewBest.hidden = !result.isNewBest;
    }
    this._updateUI();

    setTimeout(() => {
      if (!this.active || !this.completed) return;
      if (this.elements.resultPanel instanceof HTMLElement && this.elements.resultPanel.hidden)
        return;
      if (
        this.elements.shareButton instanceof HTMLButtonElement &&
        !this.elements.shareButton.disabled
      ) {
        this.elements.shareButton.focus();
      }
    }, 75);
  }

  async _shareResult() {
    if (!this.active || !this.completed) return;
    if (!isDailyShareSupported()) {
      game.showToast(i18n.t('daily.shareUnavailable'), 5000);
      return;
    }
    const score = game.scoreManager.score;
    const dateKey = this.challenge.dateKey;
    const token = await encodeDailyShare(dateKey, score);
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set(SHARE_PARAM, token);
    const urlString = url.toString();

    const title = i18n.t('daily.title');
    const text = i18n.t('ui.scoreWithValue', { score });
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: urlString });
        this._hideShareStatus();
        return;
      } catch (error) {
        if (isAbortError(error)) throw error;
        console.warn('[Daily] Native share failed, using a fallback:', error);
      }
    }
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(urlString);
        this._showCopiedShareStatus(urlString);
        return;
      } catch (error) {
        console.warn('[Daily] Clipboard write failed, using manual copy:', error);
      }
    }
    window.prompt(i18n.t('daily.shareFallback'), urlString);
  }

  /** @param {string} url */
  _showCopiedShareStatus(url) {
    setText(this.elements.shareStatusMessage, i18n.t('daily.shareCopied'));
    setText(this.elements.shareStatusUrl, url);
    if (this.elements.shareStatus instanceof HTMLElement) {
      this.elements.shareStatus.hidden = false;
      this.elements.shareStatus.scrollIntoView({ block: 'nearest' });
    }
  }

  _hideShareStatus() {
    if (this.elements.shareStatus instanceof HTMLElement) {
      this.elements.shareStatus.hidden = true;
    }
    setText(this.elements.shareStatusUrl, '');
  }

  _exitChallenge() {
    if (!this.active) return;
    this._restoreSettings();
    this.active = false;
    this.completed = false;
    this._hideShareStatus();
    document.body.classList.remove('daily-challenge-active');
    this._lockSettings(false);
    game.scoreManager.clearHighScoreOverride();
    game.scoreManager.reset(game.gameMode);
    game._updateHUD();

    if (this.elements.resultPanel instanceof HTMLElement) this.elements.resultPanel.hidden = true;
    if (gameState.currentState !== GameState.TITLE) gameState.transitionTo(GameState.TITLE);
    returnToTitleScreen();

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete(SHARE_PARAM);
    history.replaceState(null, '', cleanUrl);
    this.challenge = createDailyChallenge(getLocalDateKey());
    this.sharedScore = null;
    this.invalidShare = false;
    this.shareUnavailable = false;
    this.sharedChallenge = false;
    this.record = this.store.getRecord(this.challenge.challengeId);
    this._updateUI();
  }

  _captureSettings() {
    return {
      seed: game.config.seed,
      gameMode: game.gameMode,
      pendingMode: game.pendingMode,
      aiEnabled: game.ai.enabled,
      challengeAlgorithmVersion: game.challengeAlgorithmVersion,
      gameplayRules: game.gameplayRules,
      itemDefinitions: game.itemDefinitions,
      settings: {
        mapTemplate: game.settings.mapTemplate,
        wrapWalls: game.settings.wrapWalls,
        obstacleDensity: game.settings.obstacleDensity,
        mapSize: game.settings.mapSize,
        startLength: game.settings.startLength,
        speedMode: game.settings.speedMode,
        randomRestart: game.settings.randomRestart,
        dangerEnabled: game.settings.dangerEnabled,
        dangerSpawnRate: game.settings.dangerSpawnRate,
        dangerTimeoutSec: game.settings.dangerTimeoutSec,
        poisonMode: game.settings.poisonMode,
        itemEnabled: { ...game.settings.itemEnabled },
        itemWeights: { ...game.settings.itemWeights }
      }
    };
  }

  _applyChallengeSettings() {
    const descriptor = this.challenge;
    game.settings.mapTemplate = descriptor.mapTemplate;
    game.settings.wrapWalls = descriptor.wrapWalls;
    game.settings.obstacleDensity = descriptor.obstacleDensity;
    game.settings.mapSize = descriptor.mapSize;
    game.settings.startLength = descriptor.startLength;
    game.settings.speedMode = descriptor.speedMode;
    game.settings.randomRestart = false;
    game.settings.dangerEnabled = descriptor.dangerEnabled;
    game.settings.dangerSpawnRate = descriptor.dangerSpawnRate;
    game.settings.dangerTimeoutSec = descriptor.dangerTimeoutSec;
    game.settings.poisonMode = descriptor.poisonMode;
    game.challengeAlgorithmVersion = descriptor.algorithmVersion;
    game.gameplayRules = descriptor.gameplayRules;
    game.itemDefinitions = descriptor.itemDefinitions;
    Object.assign(game.settings.itemEnabled, descriptor.itemEnabled);
    Object.assign(game.settings.itemWeights, descriptor.itemWeights);
  }

  _restoreSettings() {
    if (!this.snapshot) return;
    game.config.seed = this.snapshot.seed;
    game.gameMode = this.snapshot.gameMode;
    game.pendingMode = this.snapshot.pendingMode;
    game.challengeAlgorithmVersion = this.snapshot.challengeAlgorithmVersion;
    game.gameplayRules = this.snapshot.gameplayRules;
    game.itemDefinitions = this.snapshot.itemDefinitions;
    const settings = this.snapshot.settings;
    game.settings.mapTemplate = settings.mapTemplate;
    game.settings.wrapWalls = settings.wrapWalls;
    game.settings.obstacleDensity = settings.obstacleDensity;
    game.settings.mapSize = settings.mapSize;
    game.settings.startLength = settings.startLength;
    game.settings.speedMode = settings.speedMode;
    game.settings.randomRestart = settings.randomRestart;
    game.settings.dangerEnabled = settings.dangerEnabled;
    game.settings.dangerSpawnRate = settings.dangerSpawnRate;
    game.settings.dangerTimeoutSec = settings.dangerTimeoutSec;
    game.settings.poisonMode = settings.poisonMode;
    Object.assign(game.settings.itemEnabled, settings.itemEnabled);
    Object.assign(game.settings.itemWeights, settings.itemWeights);
    game.ai.toggle(this.snapshot.aiEnabled);
    this.snapshot = null;
  }

  /** @param {boolean} enabled */
  _setRetryEnabled(enabled) {
    const button = document.getElementById('btn-restart-over');
    if (button instanceof HTMLButtonElement) button.disabled = !enabled;
  }

  /** @param {boolean} locked */
  _lockSettings(locked) {
    const panel = document.getElementById('controls-panel');
    if (panel) panel.inert = locked;
    for (const id of [
      'btn-hud-settings',
      'btn-mobile-settings',
      'btn-restart-over',
      'btn-restart-random-over',
      'btn-close-over'
    ]) {
      const button = document.getElementById(id);
      if (button instanceof HTMLButtonElement) button.disabled = locked;
    }
  }

  /** @param {KeyboardEvent} event */
  _handleKeydown(event) {
    if (!this.active) return;

    const gameOverActive = document
      .getElementById('game-over-screen')
      ?.classList.contains('active');
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    const isModified = event.ctrlKey || event.metaKey || event.altKey || event.isComposing;
    const isRepeated = event.repeat;

    if (event.key === 'Escape' && gameOverActive) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!isModified && !isRepeated) this._exitChallenge();
      return;
    }

    if (key === 'r' && gameState.currentState === GameState.DYING && !isModified && !isRepeated) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (isModified || isRepeated) return;
    if (key === 'i' || key === 'p') {
      // Daily mode locks both AI activation and its path-display state. Keeping
      // P out here also prevents a daily run from leaking a changed AI setting
      // back into the normal mode after exit.
      event.preventDefault();
      event.stopImmediatePropagation();
      game.showToast(i18n.t('daily.rulesLocked'));
      return;
    }

    if (key === 'r' && event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const buttonId = gameOverActive ? 'btn-restart-over' : 'btn-hud-restart';
      const restartButton = document.getElementById(buttonId);
      if (restartButton instanceof HTMLButtonElement) restartButton.click();
    }
  }

  _updateUI() {
    const formattedDate = this._formatDate(this.challenge.dateKey);
    const completedRunCount = this._getCompletedRunCount();
    setText(this.elements.title, i18n.t('daily.title'));
    setText(this.elements.date, formattedDate);
    setMetricText(this.elements.best, 'daily.best', 'score', this.record.bestScore);
    setMetricText(
      this.elements.completedRuns,
      'daily.completedRuns',
      'count',
      completedRunCount
    );
    setText(this.elements.rulesTitle, i18n.t('tutorial.rules'));
    this._updateRules();
    setText(this.elements.startButton, i18n.t('daily.start'));

    if (this.elements.friendScore instanceof HTMLElement) {
      this.elements.friendScore.hidden = this.sharedScore === null;
      if (this.sharedScore !== null) {
        setMetricText(
          this.elements.friendScore,
          'daily.friendScore',
          'score',
          this.sharedScore
        );
      }
    }
    if (this.elements.sharedDisclaimer instanceof HTMLElement) {
      this.elements.sharedDisclaimer.hidden = this.sharedScore === null;
      this.elements.sharedDisclaimer.textContent =
        this.sharedScore === null ? '' : i18n.t('daily.disclaimer');
    }
    if (this.elements.warning instanceof HTMLElement) {
      const warningText = this.shareUnavailable
        ? i18n.t('daily.shareUnavailable')
        : this.invalidShare
          ? i18n.t('daily.invalidShare')
          : '';
      this.elements.warning.hidden = !warningText;
      this.elements.warning.textContent = warningText;
    }

    setText(this.elements.resultTitle, i18n.t('daily.resultTitle'));
    setMetricText(
      this.elements.resultBest,
      'daily.best',
      'score',
      this.record.bestScore
    );
    setMetricText(
      this.elements.resultCompletedRuns,
      'daily.completedRuns',
      'count',
      completedRunCount
    );
    setText(this.elements.resultNewBest, i18n.t('daily.newBest'));
    setText(this.elements.resultDisclaimer, i18n.t('daily.disclaimer'));
    setText(this.elements.shareStatusMessage, i18n.t('daily.shareCopied'));
    setText(this.elements.shareButton, i18n.t('daily.share'));
    setText(this.elements.exitButton, i18n.t('daily.exit'));

    if (this.elements.hudBadge instanceof HTMLElement) {
      this.elements.hudBadge.hidden = !this.active;
      this.elements.hudBadge.textContent = this.active
        ? i18n.t('daily.best', { score: this.record.bestScore })
        : '';
    }
  }

  /** @returns {string | number} */
  _getCompletedRunCount() {
    return this.record.attemptsCapped ? `${this.record.attempts}+` : this.record.attempts;
  }

  _updateRules() {
    const mapKey = {
      cross_wall: 'mapTemplate.crossWall',
      pillars: 'mapTemplate.pillars',
      maze_simple: 'mapTemplate.mazeSimple'
    }[this.challenge.mapTemplate];
    setText(this.elements.ruleMapLabel, i18n.t('panel.difficulty'));
    setText(
      this.elements.ruleMapValue,
      mapKey ? i18n.t(mapKey) : this.challenge.mapTemplate
    );
    setText(this.elements.ruleSpeedLabel, i18n.t('panel.speedMode'));
    setText(
      this.elements.ruleSpeedValue,
      i18n.t(`speedMode.${this.challenge.speedMode}`)
    );
    setText(this.elements.rulePoisonLabel, i18n.t('panel.poisonMode'));
    setText(
      this.elements.rulePoisonValue,
      i18n.t(`poisonMode.${this.challenge.poisonMode}`)
    );
  }

  /** @param {string} dateKey @returns {string} */
  _formatDate(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day, 12, 0, 0);
    try {
      return new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium' }).format(date);
    } catch {
      return dateKey;
    }
  }
}

/**
 * @param {string} id
 * @param {string} [className]
 * @returns {HTMLDivElement}
 */
function createMetric(id, className = 'daily-challenge-metric') {
  const metric = document.createElement('div');
  metric.id = id;
  metric.className = className;
  return metric;
}

/**
 * @param {string} labelId
 * @param {string} valueId
 * @returns {{item: HTMLDivElement, label: HTMLElement, value: HTMLElement}}
 */
function createRule(labelId, valueId) {
  const item = document.createElement('div');
  item.className = 'daily-rule-item';
  const label = document.createElement('dt');
  label.id = labelId;
  const value = document.createElement('dd');
  value.id = valueId;
  item.append(label, value);
  return { item, label, value };
}

/**
 * @param {unknown} element
 * @param {string} translationKey
 * @param {string} placeholder
 * @param {string | number} value
 */
function setMetricText(element, translationKey, placeholder, value) {
  if (!(element instanceof HTMLElement)) return;
  const translated = i18n.t(translationKey, { [placeholder]: METRIC_VALUE_MARKER });
  const markerIndex = translated.indexOf(METRIC_VALUE_MARKER);
  if (markerIndex < 0) {
    element.textContent = translated;
    return;
  }

  const valueElement = document.createElement('strong');
  valueElement.className = 'daily-metric-value';
  valueElement.textContent = String(value);
  element.replaceChildren(
    document.createTextNode(translated.slice(0, markerIndex)),
    valueElement,
    document.createTextNode(translated.slice(markerIndex + METRIC_VALUE_MARKER.length))
  );
}

/** @param {unknown} error @returns {boolean} */
function isAbortError(error) {
  return Boolean(
    error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'
  );
}

/** @param {unknown} element @param {string} value */
function setText(element, value) {
  if (element instanceof HTMLElement) element.textContent = value;
}

const controller = new DailyChallengeController();
window.addEventListener('DOMContentLoaded', () => {
  controller.init().catch((error) => console.warn('[Daily] Feature unavailable:', error));
});
