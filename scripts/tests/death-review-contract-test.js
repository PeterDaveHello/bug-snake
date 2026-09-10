// @ts-check
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const [
  html,
  mainSource,
  gameSource,
  itemManagerSource,
  recorderSource,
  rendererSource,
  controllerSource,
  workerSource,
  agentsSource
] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('scripts/main.js', root), 'utf8'),
  readFile(new URL('scripts/core/game.js', root), 'utf8'),
  readFile(new URL('scripts/core/item-manager.js', root), 'utf8'),
  readFile(new URL('scripts/core/death-review-recorder.js', root), 'utf8'),
  readFile(new URL('scripts/render/renderer.js', root), 'utf8'),
  readFile(new URL('scripts/ui/death-review-controller.js', root), 'utf8'),
  readFile(new URL('sw.js', root), 'utf8'),
  readFile(new URL('AGENTS.md', root), 'utf8')
]);

let passed = 0;

/** @param {boolean} condition @param {string} message */
function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✅ PASS: ${message}`);
  passed++;
}

for (const id of [
  'btn-open-death-review',
  'game-over-review-summary',
  'death-review-screen',
  'death-review-timeline',
  'btn-death-review-play',
  'btn-death-review-back'
]) {
  assert(html.includes(`id="${id}"`), `Death review markup includes #${id}`);
}

assert(
  html.includes('styles/death-review.css'),
  'Death review stylesheet is loaded by the main document'
);
assert(
  mainSource.includes("'death-review-screen'") &&
    mainSource.includes('DeathReviewController') &&
    mainSource.includes('game.getDeathReview()'),
  'Main application integrates the review controller and overlay lifecycle'
);
assert(
  gameSource.includes('deathReviewRecorder.markDecision') &&
    gameSource.includes('deathReviewRecorder.captureFrame') &&
    gameSource.includes('deathReviewRecorder.finish'),
  'Game records decisions, snapshots, and the fatal result'
);
assert(
  gameSource.indexOf('deathReviewRecorder.markDecision') < gameSource.indexOf('this.snake.tick();'),
  'Fatal decision metadata is captured before the snake mutates'
);
assert(
  gameSource.includes('safeDirectionMask: this._getSafeDirectionMask(activeTickStep)') &&
    gameSource.includes('inspection: this.inspectMove(attemptedDirection, activeTickStep)'),
  'Review analysis projects the same active-play interval as the upcoming game step'
);
assert(
  gameSource.includes('!this.itemManager.willItemExpireAfter(item, activeTickStep)') &&
    /willItemExpireAfter\(item, deltaTime\) \{[\s\S]*?normalizeElapsedMs\(deltaTime\)[\s\S]*?this\._isExpiredDangerAt\(item, projectedTime\)/.test(
      itemManagerSource
    ) &&
    itemManagerSource.includes('if (this._isExpiredDangerAt(item, currentTime)) continue;'),
  'Review and gameplay share one danger-item expiry rule'
);
assert(
  itemManagerSource.includes('const MAX_ACTIVE_TIME_MS = Number.MAX_SAFE_INTEGER;') &&
    itemManagerSource.includes('Math.min(deltaTime * 1000, MAX_ACTIVE_TIME_MS)'),
  'Danger timing remains finite for extreme elapsed-time inputs'
);
assert(
  gameSource.includes('return !this.snake.inspectMove(dir).allowed;') &&
    agentsSource.includes('Gameplay turn assist intentionally uses `snake.inspectMove()`'),
  'Existing one-step steering assistance keeps its intentional map-and-body semantics'
);
assert(
  recorderSource.includes("snakeSkin: game.settings.snakeSkin || 'classic'") &&
    controllerSource.includes(
      'this._scene.settings.snakeSkin = frame.snakeSkin || this.review.snakeSkin;'
    ),
  'Every replay frame preserves and renders the snake skin active at that moment'
);
assert(
  rendererSource.includes('frameTime = performance.now()'),
  'Renderer accepts a deterministic review frame time without changing existing callers'
);
assert(
  !rendererSource.includes('this._frameTime || performance.now()'),
  'Renderer preserves a zero replay timestamp across every animation path'
);
assert(
  workerSource.includes("'./styles/death-review.css'") &&
    workerSource.includes("'./scripts/core/death-review-recorder.js'") &&
    workerSource.includes("'./scripts/ui/death-review-controller.js'"),
  'Service worker pre-caches every death review runtime asset'
);
assert(
  !/\blocalStorage\b|\bsessionStorage\b|\bfetch\s*\(/.test(controllerSource),
  'Review controller remains local-only and does not persist or transmit replay data'
);
assert(
  controllerSource.includes("window.addEventListener('keydown', this._keydownHandler, true)"),
  'Review keyboard handling runs in capture phase to isolate gameplay shortcuts'
);
assert(
  /if \(onControl && event\.key !== 'Escape'\) \{\s*\/\/[\s\S]*?event\.stopImmediatePropagation\(\);\s*return;\s*\}/.test(
    controllerSource
  ),
  'Review keyboard handling isolates focused controls without cancelling native defaults'
);
assert(
  !controllerSource.includes('.focus()') &&
    mainSource.includes('if (firstBtn instanceof HTMLButtonElement) firstBtn.focus();'),
  'Shared overlay handling owns autofocus without a competing review-controller timer'
);
assert(
  controllerSource.includes('subview of the GAME_OVER result flow') &&
    !controllerSource.includes('audio.duck(') &&
    agentsSource.includes('Moving between `game-over-screen` and `death-review-screen` is **not**'),
  'Death review stays inside the ducked Game Over result flow'
);
assert(
  controllerSource.includes("const DAILY_ACTIVE_CLASS = 'daily-challenge-active'") &&
    controllerSource.includes('randomButton.hidden = locked;') &&
    controllerSource.includes(
      'const safeRandomize = randomize && !this._isDailyChallengeActive();'
    ),
  'Daily challenge review hides random restart and defensively routes it to a locked retry'
);
assert(
  controllerSource.includes('function getCollisionMarkerRect(') &&
    controllerSource.includes('if (rawTarget.x >= gridSize) x = boardMaxX - markerSize;') &&
    !controllerSource.includes('const clampedX ='),
  'Wall collisions render at the crossed board boundary instead of the snake head cell'
);
assert(
  controllerSource.includes("game.showToast(i18n.t('review.unavailable'))"),
  'Review controller provides a localized fallback when replay data is unavailable'
);
assert(
  controllerSource.includes("i18n.t('ui.gameOverReason', { reason: translatedReason })") &&
    !controllerSource.includes('`${translatedReason}. `'),
  'Review summary delegates reason formatting and punctuation to localization'
);
assert(
  controllerSource.includes("'(prefers-reduced-motion: reduce)'"),
  'Review honors reduced-motion preferences'
);

console.log(`\nDeath review contract tests: ${passed} passed`);
