// @ts-check
import { audio } from './audio/audio-engine.js';
import { game } from './core/game.js';
import { i18n } from './i18n/i18n.js';
import { isEditableElement, setElementText } from './utils/dom.js';
import { isPlainLetterShortcut } from './utils/keyboard-shortcut.js';

const ABOUT_REPO_URL = 'https://github.com/PeterDaveHello/bug-snake/';

class GameApp {
  constructor() {
    this.initialized = false;
    this.panelManager = null;
    this._gameState = null;
    this._GameState = null;
    this._panelAutoPaused = false;
    this._aboutReturnToTitle = false;
    this._errorRetryBound = false;
    this._overlayKeyHandler = this._handleOverlayKeydown.bind(this);
    this._panelLoadErrorHandler = this._handlePanelLoadError.bind(this);
    this._windowFocusHandler = this._handleWindowFocus.bind(this);
    this._windowBlurHandler = this._handleWindowBlur.bind(this);
    this._skipRepeatGuardForLetterShortcuts = false;
  }

  /**
   * @param {string} id
   * @param {() => void} handler
   */
  _bindButton(id, handler) {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', handler);
  }

  /**
   * @param {string} screenId
   */
  _hideScreen(screenId) {
    const screen = document.getElementById(screenId);
    if (screen) {
      screen.classList.remove('active');
    }
    // Only remove inert if no overlays are active
    const overlayIds = [
      'title-screen',
      'game-over-screen',
      'time-up-screen',
      'pause-screen',
      'level-clear-screen',
      'about-screen',
      'error-screen'
    ];
    const anyActive = overlayIds.some((id) =>
      document.getElementById(id)?.classList.contains('active')
    );
    if (!anyActive) {
      const container = document.getElementById('game-container');
      if (container) container.inert = false;
    }
  }

  /**
   * @param {string} screenId
   */
  _showScreen(screenId) {
    const screen = document.getElementById(screenId);
    if (screen) {
      screen.classList.add('active');
      // Focus trap: make game container inert when overlay is shown
      const container = document.getElementById('game-container');
      if (container && screenId !== 'loading-screen') {
        container.inert = true;
      }
      // Auto-focus first button for accessibility
      const firstBtn = screen.querySelector('button');
      if (firstBtn) {
        setTimeout(() => firstBtn.focus(), 50);
      }
    }
  }

  _handleWindowBlur() {
    this._skipRepeatGuardForLetterShortcuts = true;
  }

  _handleWindowFocus() {
    this._skipRepeatGuardForLetterShortcuts = true;
    const gameCanvas = document.getElementById('game-canvas');
    if (gameCanvas instanceof HTMLCanvasElement) {
      try {
        gameCanvas.focus({ preventScroll: true });
      } catch {
        gameCanvas.focus();
      }
    }
  }

  /**
   * @param {string} letter
   * @param {KeyboardEvent} event
   * @returns {boolean}
   */
  _isPlainShortcut(letter, event) {
    if (isPlainLetterShortcut(event, letter)) {
      this._skipRepeatGuardForLetterShortcuts = false;
      return true;
    }
    if (!this._skipRepeatGuardForLetterShortcuts) return false;
    if (!event || typeof event.key !== 'string') return false;
    if (Boolean(event.isComposing)) return false;
    if (
      Boolean(event.shiftKey) ||
      Boolean(event.ctrlKey) ||
      Boolean(event.metaKey) ||
      Boolean(event.altKey)
    )
      return false;

    const current = event.key.toLowerCase();
    const target = letter.toLowerCase();
    if (current !== target || current.length !== 1 || target.length !== 1) return false;

    this._skipRepeatGuardForLetterShortcuts = false;
    return true;
  }

  /**
   * @param {string} id
   * @param {string} text
   */
  _setGuideText(id, text) {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = this._formatGuideText(text);
    }
  }

  /**
   * @param {string} id
   * @param {string} label
   * @param {string} shortcut
   */
  _setButtonTextWithShortcut(id, label, shortcut) {
    const btn = document.getElementById(id);
    if (!(btn instanceof HTMLButtonElement)) return;

    btn.textContent = '';
    btn.append(document.createTextNode(label), document.createTextNode(' '));

    const keys = shortcut
      .split('+')
      .map((key) => key.trim())
      .filter(Boolean);

    keys.forEach((key, index) => {
      if (index > 0) btn.append(document.createTextNode('+'));
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      btn.append(kbd);
    });

    btn.setAttribute('aria-label', label);
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  _escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  _formatGuideText(text) {
    if (!text) return '';
    const arrowGroup = this._renderKbdGroup(['↑', '↓', '←', '→']);
    const wasdGroup = this._renderKbdGroup(['W', 'A', 'S', 'D']);

    /** @type {Array<{ regex: RegExp, token: string, html: string }>} */
    const replacements = [
      { regex: /方向鍵/g, token: '__KBD_ARROWS__', html: arrowGroup },
      { regex: /Arrow Keys/gi, token: '__KBD_ARROWS__', html: arrowGroup },
      { regex: /\bWASD\b/g, token: '__KBD_WASD__', html: wasdGroup },
      { regex: /\bW\/A\/S\/D\b/g, token: '__KBD_WASD__', html: wasdGroup },
      { regex: /\bEsc\b/g, token: '__KBD_ESC__', html: '<kbd>Esc</kbd>' },
      { regex: /\bShift\+R\b/g, token: '__KBD_SHIFT_R__', html: '<kbd>Shift</kbd>+<kbd>R</kbd>' },
      { regex: /\bR\b/g, token: '__KBD_R__', html: '<kbd>R</kbd>' },
      { regex: /\bSpace\b/g, token: '__KBD_SPACE__', html: '<kbd>Space</kbd>' },
      { regex: /空白鍵/g, token: '__KBD_SPACE_ZH__', html: '<kbd>空白鍵</kbd>' },
      { regex: /空格键/g, token: '__KBD_SPACE_CN__', html: '<kbd>空格键</kbd>' },
      { regex: /按\s*I/g, token: '__KBD_I_ZH__', html: '按 <kbd>I</kbd>' },
      { regex: /按\s*P/g, token: '__KBD_P_ZH__', html: '按 <kbd>P</kbd>' },
      { regex: /\bPress\s+I\b/gi, token: '__KBD_I_EN__', html: 'Press <kbd>I</kbd>' },
      { regex: /\bPress\s+P\b/gi, token: '__KBD_P_EN__', html: 'Press <kbd>P</kbd>' },
      { regex: /\bP\b(?=\s+to\b)/g, token: '__KBD_P_TO__', html: '<kbd>P</kbd>' },
      { regex: /\bI\b(?=\s+to\b)/g, token: '__KBD_I_TO__', html: '<kbd>I</kbd>' }
    ];

    let formatted = text;
    for (const item of replacements) {
      formatted = formatted.replace(item.regex, item.token);
    }

    formatted = this._escapeHtml(formatted);

    for (const item of replacements) {
      formatted = formatted.split(item.token).join(item.html);
    }

    return formatted;
  }

  /**
   * @param {string[]} keys
   * @returns {string}
   */
  _renderKbdGroup(keys) {
    let markup = '<span class="kbd-group">';
    for (const key of keys) {
      markup += `<kbd>${key}</kbd>`;
    }
    markup += '</span>';
    return markup;
  }

  _isMobileLayout() {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return (
      window.matchMedia('(max-width: 900px)').matches ||
      window.matchMedia('(hover: none) and (pointer: coarse)').matches
    );
  }

  _shouldAutoPausePanel() {
    return this._isMobileLayout();
  }

  _isLegendVisible() {
    const legend = document.getElementById('legend-panel');
    if (!legend) return false;
    if (this._isMobileLayout()) {
      return legend.classList.contains('active');
    }
    return !legend.classList.contains('hidden');
  }

  _syncLegendButtons(isActive) {
    const mobileLegendBtn = document.getElementById('btn-mobile-legend');
    if (mobileLegendBtn) {
      mobileLegendBtn.setAttribute('aria-pressed', String(isActive));
    }

    const hudLegendBtn = document.getElementById('btn-hud-legend');
    if (hudLegendBtn) {
      hudLegendBtn.setAttribute('aria-pressed', String(isActive));
    }
  }

  _toggleLegendPanel() {
    const legend = document.getElementById('legend-panel');
    if (!legend) return;

    let isActive;
    if (this._isMobileLayout()) {
      legend.classList.remove('hidden');
      isActive = legend.classList.toggle('active');
    } else {
      legend.classList.remove('active');
      legend.classList.toggle('hidden');
      isActive = !legend.classList.contains('hidden');
    }

    this._syncLegendButtons(isActive);

    if (isActive) {
      requestAnimationFrame(() => game.renderer.renderLegendIcons());
    }
  }

  _handlePanelClosed() {
    if (!this._panelAutoPaused) return;
    if (this._gameState?.currentState === this._GameState?.PAUSED) {
      game.pause();
    }
    this._panelAutoPaused = false;
  }

  _toggleSettingsPanel() {
    const panel = document.getElementById('controls-panel');
    if (!panel) return;
    const willOpen = !panel.classList.contains('active');
    panel.classList.toggle('active');

    if (!this._shouldAutoPausePanel()) return;

    if (willOpen) {
      if (this._gameState?.currentState === this._GameState?.PLAYING) {
        game.pause();
        this._panelAutoPaused = true;
      }
      return;
    }

    this._handlePanelClosed();
  }

  async init() {
    console.log('[App] Starting initialization...');

    await i18n.init();
    this.updateUIText();

    i18n.addListener((newLocale) => {
      console.log(`[App] Locale changed to ${newLocale}`);
      this.updateUIText();
    });

    game.init('game-canvas');
    game.renderer.renderLegendIcons();
    window.addEventListener('resize', () => game.renderer.renderLegendIcons());

    const panelModule = await import('./ui/panel-manager.js').catch(this._panelLoadErrorHandler);
    if (panelModule?.PanelManager) {
      this.panelManager = new panelModule.PanelManager(game);
      this.panelManager.init('controls-panel');
    }

    const loadingScreen = document.getElementById('loading-screen');

    if (loadingScreen) {
      setTimeout(() => {
        this._hideScreen('loading-screen');
        setTimeout(() => {
          this._showScreen('title-screen');
        }, 300); // Wait for loading fade-out before showing title fade-in
        console.log('[App] Ready!');
      }, 500);
    }

    this._bindButton('btn-start-game', () => {
      this._hideScreen('title-screen');
      const shouldRandomize = Boolean(game.settings.randomRestart);
      game.start({ randomize: shouldRandomize });
      if (shouldRandomize && this.panelManager) {
        this.panelManager.refresh();
      }
    });

    this._bindButton('btn-about', () => {
      this._openAbout();
    });

    this._bindButton('btn-next-level', () => {
      this._hideScreen('level-clear-screen');
      game.startNextLevel();
    });

    this._bindButton('btn-resume', () => game.pause());
    this._bindButton('btn-mobile-pause', () => game.pause());
    this._bindButton('btn-hud-pause', () => game.pause());

    this._bindButton('btn-mobile-legend', () => {
      this._toggleLegendPanel();
    });

    this._bindButton('btn-mobile-restart', () => {
      this._closeOverlayScreens();
      this._restartWithDefault();
    });

    this._bindButton('btn-restart-pause', () => {
      this._hideScreen('pause-screen');
      this._restartWithDefault();
    });

    this._bindButton('btn-hud-restart', () => {
      this._closeOverlayScreens();
      this._restartWithDefault();
    });

    this._bindButton('btn-hud-settings', () => {
      this._toggleSettingsPanel();
    });

    this._bindButton('btn-hud-legend', () => {
      this._toggleLegendPanel();
    });

    const controlsPanel = document.getElementById('controls-panel');
    if (controlsPanel) {
      controlsPanel.addEventListener('click', (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.classList.contains('close-panel-btn')) {
          this._handlePanelClosed();
        }
      });
    }

    this._bindButton('btn-restart-over', () => {
      this._hideScreen('game-over-screen');
      game.restartCurrent({ randomize: false });
    });

    this._bindButton('btn-restart-random-over', () => {
      this._hideScreen('game-over-screen');
      this._restartWithDefault({ randomize: true });
    });

    this._bindButton('btn-restart-time', () => {
      this._hideScreen('time-up-screen');
      game.restartCurrent({ randomize: false });
    });

    this._bindButton('btn-restart-random-time', () => {
      this._hideScreen('time-up-screen');
      this._restartWithDefault({ randomize: true });
    });

    this._bindButton('btn-close-over', () => {
      this._hideScreen('game-over-screen');
      audio.duck(false);
    });
    this._bindButton('btn-close-time', () => {
      this._hideScreen('time-up-screen');
      audio.duck(false);
    });
    this._bindButton('btn-close-about', () => this._closeAbout());

    window.addEventListener('keydown', this._overlayKeyHandler);
    window.addEventListener('focus', this._windowFocusHandler);
    window.addEventListener('blur', this._windowBlurHandler);

    import('./core/state-machine.js').then(({ gameState, GameState }) => {
      this._gameState = gameState;
      this._GameState = GameState;
      gameState.onStateChange((current, prev) => {
        switch (current) {
          case GameState.LEVEL_CLEAR:
            this._showScreen('level-clear-screen');
            setElementText(
              'level-clear-score',
              i18n.t('ui.scoreWithValue', { score: game.scoreManager.score })
            );
            break;

          case GameState.GAME_OVER:
            this._showScreen('game-over-screen');
            setElementText(
              'game-over-score',
              i18n.t('ui.finalScore', { score: game.scoreManager.score })
            );
            setElementText('game-over-reason', this._getDeathReasonText());
            this._updateDeathDetail();
            break;

          case GameState.TIME_UP:
            this._showScreen('time-up-screen');
            setElementText(
              'time-up-score',
              i18n.t('ui.finalScore', { score: game.scoreManager.score })
            );
            break;

          case GameState.PAUSED: {
            // On mobile, the settings panel is the full-screen overlay — showing
            // the pause screen on top would set game-container.inert and block all
            // panel interactions (folders, close button). Skip it when panel is open.
            const panelActive = document.getElementById('controls-panel')?.classList.contains('active');
            if (!(panelActive && this._isMobileLayout())) {
              this._showScreen('pause-screen');
            }
            this._updateMobilePauseLabel(true);
            audio.duck(true);
            break;
          }

          case GameState.PLAYING:
            if (prev === GameState.PAUSED) {
              this._hideScreen('pause-screen');
              this._updateMobilePauseLabel(false);
              audio.duck(false);
            }
            if (prev === GameState.GAME_OVER || prev === GameState.DYING) {
              audio.duck(false);
            }
            break;
        }
      });
    });

    this.initialized = true;
  }

  updateUIText() {
    // 1. Static Text via data-i18n
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = i18n.t(key);
    });

    // 2. Keyboard shortcut hints on title screen buttons (must run after data-i18n above)
    this._setButtonTextWithShortcut('btn-start-game', i18n.t('ui.start'), 'Enter');
    this._setButtonTextWithShortcut('btn-about', i18n.t('ui.about'), 'A');

    this._setGuideText('guide-move', i18n.t('ui.guideMove'));
    this._setGuideText('guide-settings', i18n.t('ui.guideSettings'));
    this._setGuideText('guide-pause', i18n.t('ui.guidePause'));
    this._setGuideText('guide-restart', i18n.t('ui.guideRestart'));
    this._setGuideText('guide-boost', i18n.t('ui.guideBoost'));
    this._setGuideText('guide-legend', i18n.t('ui.guideLegend'));
    this._setGuideText('guide-ai', i18n.t('ui.guideAI'));

    this._setGuideText('seo-guide-move', i18n.t('ui.guideMove'));
    this._setGuideText('seo-guide-pause', i18n.t('ui.guidePause'));
    this._setGuideText('seo-guide-restart', i18n.t('ui.guideRestart'));
    this._setGuideText('seo-guide-boost', i18n.t('ui.guideBoost'));
    this._setGuideText('seo-guide-ai', i18n.t('ui.guideAI'));

    document.title = i18n.t('ui.title');

    // Update dynamic screens if active
    if (document.getElementById('level-clear-screen')?.classList.contains('active')) {
      setElementText(
        'level-clear-score',
        i18n.t('ui.scoreWithValue', { score: game.scoreManager.score })
      );
    }

    if (document.getElementById('game-over-screen')?.classList.contains('active')) {
      setElementText(
        'game-over-score',
        i18n.t('ui.finalScore', { score: game.scoreManager.score })
      );
      setElementText('game-over-reason', this._getDeathReasonText());
      this._updateDeathDetail();
    }

    if (document.getElementById('time-up-screen')?.classList.contains('active')) {
      setElementText('time-up-score', i18n.t('ui.finalScore', { score: game.scoreManager.score }));
    }

    // Update overlay buttons
    this._setButtonTextWithShortcut('btn-restart-over', i18n.t('ui.restartCurrent'), 'R');
    this._setButtonTextWithShortcut(
      'btn-restart-random-over',
      i18n.t('ui.restartRandom'),
      'Shift+R'
    );
    this._setButtonTextWithShortcut('btn-close-over', i18n.t('ui.close'), 'Esc');

    this._setButtonTextWithShortcut('btn-restart-time', i18n.t('ui.restartCurrent'), 'R');
    this._setButtonTextWithShortcut(
      'btn-restart-random-time',
      i18n.t('ui.restartRandom'),
      'Shift+R'
    );
    this._setButtonTextWithShortcut('btn-close-time', i18n.t('ui.close'), 'Esc');
    this._setButtonTextWithShortcut('btn-close-about', i18n.t('ui.close'), 'Esc');

    // Update Mobile/HUD buttons with aria-labels
    const updateAriaBtn = (id, key, pressed = null) => {
      const btn = document.getElementById(id);
      if (btn) {
        const label = i18n.t(key);
        btn.textContent = label;
        btn.setAttribute('aria-label', label);
        if (pressed !== null) btn.setAttribute('aria-pressed', String(pressed));
      }
    };

    const isPaused = document.getElementById('pause-screen')?.classList.contains('active');
    this._updateMobilePauseLabel(isPaused);
    updateAriaBtn('btn-mobile-restart', 'ui.restart');
    updateAriaBtn('btn-hud-settings', 'ui.settings');
    this._setButtonTextWithShortcut(
      'btn-hud-pause',
      i18n.t(isPaused ? 'ui.resume' : 'ui.pause'),
      'Esc'
    );
    this._setButtonTextWithShortcut('btn-hud-restart', i18n.t('ui.restart'), 'R');

    const legendVisible = this._isLegendVisible();
    updateAriaBtn('btn-mobile-legend', 'ui.legend', legendVisible);
    this._setButtonTextWithShortcut('btn-hud-legend', i18n.t('ui.legend'), 'L');
    const hudLegendBtn = document.getElementById('btn-hud-legend');
    if (hudLegendBtn) {
      hudLegendBtn.setAttribute('aria-pressed', String(legendVisible));
    }

    // D-pad: only update aria-label, preserve the arrow symbol textContent
    for (const [id, key] of [
      ['btn-up', 'ui.moveUp'],
      ['btn-down', 'ui.moveDown'],
      ['btn-left', 'ui.moveLeft'],
      ['btn-right', 'ui.moveRight']
    ]) {
      document.getElementById(id)?.setAttribute('aria-label', i18n.t(key));
    }

    this._updateAboutInfo();
    game._updateHUD();
  }

  _getDeathReasonText() {
    const reasonKey = game.lastDeathReason || 'unknown';
    const reasonLabel = i18n.t(`deathReason.${reasonKey}`);
    return i18n.t('ui.gameOverReason', { reason: reasonLabel });
  }

  _getDeathDetailText() {
    const detailKey = game.lastDeathReason || 'unknown';
    const detail = i18n.t(`deathDetail.${detailKey}`);
    if (!detail || detail.startsWith('[[')) return '';
    return i18n.t('ui.gameOverDetail', { detail: detail });
  }

  _updateDeathDetail() {
    const detailEl = document.getElementById('game-over-detail');
    if (!detailEl) return;
    const detailText = this._getDeathDetailText();
    detailEl.textContent = detailText;
    detailEl.style.display = detailText ? 'block' : 'none';
  }

  /**
   * @param {{ randomize?: boolean }} options
   */
  _restartWithDefault(options = {}) {
    const shouldRandomize =
      typeof options.randomize === 'boolean'
        ? options.randomize
        : Boolean(game.settings.randomRestart);
    game.restartCurrent({ randomize: shouldRandomize });
    if (shouldRandomize && this.panelManager) {
      this.panelManager.refresh();
    }
  }

  _updateMobilePauseLabel(isPaused) {
    const label = isPaused ? i18n.t('ui.resume') : i18n.t('ui.pause');
    const mobilePauseBtn = document.getElementById('btn-mobile-pause');
    if (mobilePauseBtn) {
      mobilePauseBtn.textContent = label;
      mobilePauseBtn.setAttribute('aria-label', label);
    }

    const hudPauseBtn = document.getElementById('btn-hud-pause');
    if (hudPauseBtn instanceof HTMLButtonElement) {
      this._setButtonTextWithShortcut('btn-hud-pause', label, 'Esc');
      hudPauseBtn.setAttribute('aria-pressed', String(isPaused));
    }
  }

  _closeOverlayScreens() {
    const ids = [
      'title-screen',
      'game-over-screen',
      'time-up-screen',
      'pause-screen',
      'level-clear-screen',
      'about-screen'
    ];
    ids.forEach((id) => this._hideScreen(id));
  }

  _disableSettingsUI() {
    const panel = document.getElementById('controls-panel');
    if (panel) {
      panel.style.display = 'none';
    }

    for (const id of ['btn-hud-settings', 'btn-mobile-settings']) {
      const btn = document.getElementById(id);
      if (btn instanceof HTMLElement) {
        btn.style.display = 'none';
      }
    }
  }

  /**
   * @param {unknown} err
   * @returns {null}
   */
  _handlePanelLoadError(err) {
    console.warn('[App] Panel unavailable:', err);
    this._disableSettingsUI();
    return null;
  }

  _bindErrorRetryButton() {
    if (this._errorRetryBound) return;
    const retryBtn = document.getElementById('btn-error-retry');
    if (!(retryBtn instanceof HTMLButtonElement)) return;
    retryBtn.addEventListener('click', () => location.reload(), { once: true });
    this._errorRetryBound = true;
  }

  /**
   * @param {unknown} err
   */
  _handleInitError(err) {
    console.error('[App] Init failed:', err);
    const errScreen = document.getElementById('error-screen');
    const loadScreen = document.getElementById('loading-screen');
    if (errScreen) {
      const msg = errScreen.querySelector('.error-message');
      if (msg) {
        const fallback =
          err &&
          typeof err === 'object' &&
          'message' in err &&
          typeof err.message === 'string' &&
          err.message
            ? err.message
            : 'Initialization failed. Please try again.';
        const translated = typeof i18n.t === 'function' ? i18n.t('ui.initFailed') : null;
        msg.textContent = translated && !translated.startsWith('[[') ? translated : fallback;
      }
      const retryBtn = errScreen.querySelector('#btn-error-retry');
      if (retryBtn && typeof i18n.t === 'function') {
        const retryText = i18n.t('ui.retry');
        if (retryText && !retryText.startsWith('[[')) {
          retryBtn.textContent = retryText;
        }
      }
      if (loadScreen) loadScreen.classList.remove('active');
      errScreen.classList.add('active');
    }
    this._bindErrorRetryButton();
  }

  _updateAboutInfo() {
    const authorEl = document.getElementById('about-author');
    if (authorEl) {
      const authorName = i18n.t('ui.aboutAuthorName');
      authorEl.textContent = authorName && !authorName.startsWith('[[') ? authorName : '';
    }

    const playUrlEl = document.getElementById('about-play-url');
    if (playUrlEl instanceof HTMLAnchorElement) {
      const href = window.location.href;
      playUrlEl.href = href;
      playUrlEl.textContent = href;
    }

    const repoRow = document.getElementById('about-repo-row');
    const repoEl = document.getElementById('about-repo-url');
    if (repoEl instanceof HTMLAnchorElement && repoRow) {
      if (!ABOUT_REPO_URL) {
        repoRow.style.display = 'none';
      } else {
        repoRow.style.display = '';
        repoEl.href = ABOUT_REPO_URL;
      }
    }
  }

  _openAbout() {
    this._aboutReturnToTitle = Boolean(
      document.getElementById('title-screen')?.classList.contains('active')
    );
    this._hideScreen('title-screen');
    this._updateAboutInfo();
    this._showScreen('about-screen');
  }

  _closeAbout() {
    this._hideScreen('about-screen');
    if (!this._aboutReturnToTitle) return;
    this._showScreen('title-screen');
    this._aboutReturnToTitle = false;
  }

  /**
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  _handleOverlayKeydown(event) {
    if (isEditableElement(event.target) && event.key !== 'Escape') {
      return;
    }

    const isPlainA = this._isPlainShortcut('a', event);
    const isPlainL = this._isPlainShortcut('l', event);

    const overActive = document.getElementById('game-over-screen')?.classList.contains('active');
    const timeActive = document.getElementById('time-up-screen')?.classList.contains('active');
    const titleActive = document.getElementById('title-screen')?.classList.contains('active');
    const aboutActive = document.getElementById('about-screen')?.classList.contains('active');
    if (titleActive && event.key === 'Enter') {
      if (event.repeat) {
        event.preventDefault();
        return;
      }

      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (
          tag === 'BUTTON' ||
          tag === 'A' ||
          tag === 'INPUT' ||
          tag === 'SELECT' ||
          tag === 'TEXTAREA'
        ) {
          return;
        }
      }

      const btn = document.getElementById('btn-start-game');
      if (btn instanceof HTMLButtonElement) {
        event.preventDefault();
        btn.click();
      }
      return;
    }

    if (aboutActive && isPlainA) {
      event.preventDefault();
      this._closeAbout();
      return;
    }

    if (titleActive && isPlainA) {
      event.preventDefault();
      const btn = document.getElementById('btn-about');
      if (btn instanceof HTMLButtonElement) btn.click();
      return;
    }

    if (isPlainL) {
      event.preventDefault();
      this._toggleLegendPanel();
      return;
    }

    if (event.key === 'Escape') {
      if (aboutActive) {
        this._closeAbout();
        return;
      }
      if (overActive || timeActive) {
        this._closeOverlayScreens();
        audio.duck(false);
      }
      return;
    }

    if (event.key === 'R' || event.key === 'r') {
      // Handle restart from overlay screens
      if (overActive || timeActive) {
        const btnId = event.shiftKey
          ? overActive
            ? 'btn-restart-random-over'
            : 'btn-restart-random-time'
          : overActive
            ? 'btn-restart-over'
            : 'btn-restart-time';
        const btn = document.getElementById(btnId);
        if (btn instanceof HTMLButtonElement) {
          btn.click();
        }
        return;
      }

      // Handle restart during gameplay
      if (!this._gameState || !this._GameState) return;
      const state = this._gameState.currentState;
      if (
        state === this._GameState.PLAYING ||
        state === this._GameState.PAUSED ||
        state === this._GameState.DYING
      ) {
        this._closeOverlayScreens();
        this._restartWithDefault({ randomize: event.shiftKey });
      }
    }
  }
}

const app = new GameApp();
window.addEventListener('DOMContentLoaded', () => {
  app.init().catch((err) => {
    app._handleInitError(err);
  });
});
