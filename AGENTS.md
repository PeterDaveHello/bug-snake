# Repository Guidelines for AI Agents

## Project Overview

SerpentOS: Bug Buster Snake is a Vanilla JS web game using ES Modules and Canvas 2D. It features advanced mechanics (skins, AI, multiple modes) without external build tools or frameworks.

## 🛠️ Build, Test, and Development Commands

This project uses **Native ES Modules**, so no build step is required for development.

- **Prerequisites**:
  - Node.js (v20.20+ recommended) for local tools and checks.
  - `npm install` to fetch dev dependencies for `npm run check:js`.

- **Run Locally**:
  - `npx serve .`
  - Open `http://localhost:3000` (or appropriate port).
  - _Note:_ File:// protocol will fail due to CORS/ESM restrictions.

- **Type Checking**:
  - `npm run check:js`
  - Uses TypeScript compiler (`tsc`) on JS files via JSDoc comments (`// @ts-check`).

- **Verification Scripts**:
  - `node scripts/tools/check-i18n.js` - Verifies all 22 locale files against `en-US.json` as the reference (reads locale list from `i18n/index.json`).
  - `node scripts/tests/core-test.js` - Runs core logic smoke tests.

- **NPM Script Aliases** (prefer these over raw `node` commands):
  - `npm run check:i18n` - same as `node scripts/tools/check-i18n.js`
  - `npm run test:core` - same as `node scripts/tests/core-test.js`
  - `npm run check:js` - TypeScript type checking
  - `npm run lint` - runs ESLint + stylelint + html-validate
  - `npm run lint:md` - runs markdownlint for Markdown docs
  - `npm run format:check` - runs Prettier check (no rewrite)
  - `npm run format` - runs Prettier write
  - `npm run lint:fix` - runs ESLint/stylelint fixes + Prettier write
  - `npm run check:quality` - runs lint + markdown lint + format check (opt-in during migration)
  - `npm run check` - **runs all checks** (`check:js` + `check:i18n` + `test:core` + `lint`)

## 🏗️ Architecture & Structure

### Modular Design (ESM)

The codebase follows a separation of concerns pattern, linked via `scripts/main.js`.

- **Core Logic (`scripts/core/`)**:
  - `Game`: Central coordinator/Facade. Delegates logic to specific managers.
  - `ScoreManager`: Handles scoring, stats, and high-score persistence.
  - `TimeManager`: Manages game time, speed calculations, and time-attack logic.
  - `ItemManager`: Manages item spawning weights, lifecycle, and collision checks.
  - `Snake`: Core data structure for body segments and movement.
  - `SeededRandom` (`random.js`): Deterministic PRNG for reproducible item spawns.
  - `GameLoop`: Fixed timestep loop using `requestAnimationFrame`.
  - `StateMachine`: Manages game states (`TITLE`, `LOBBY`, `PLAYING`, `PAUSED`, `DYING`, `GAME_OVER`, `LEVEL_CLEAR`, `TIME_UP`).
  - `Grid`: 1D array backing a 2D coordinate system.
  - `config.js`: Central constants and defaults (GameConfig, enums).

- **Rendering (`scripts/render/`)**:
  - `Renderer`: Pure Canvas 2D implementation.
  - **Skins**: Implemented as methods (e.g., `_drawNeonSnake`) toggled by settings.
  - **Particles**: Simple particle system for visual feedback. Includes a separate `textParticles` array - `emitText(gridX, gridY, text, color)` creates floating score deltas (e.g., "+10") that rise and fade.
  - **Item sprite cache guardrails**: Cached glyphs that use blur/offset animations must reserve enough offscreen padding to avoid clipping.
  - **High-motion cache exceptions**: Highly dynamic item animations may remain on direct draw if bucketed cache introduces visible stepping/jitter.

- **AI (`scripts/ai/`)**:
  - `ai-pilot.js`: Greedy, BFS, and A\* pathfinding for autopilot.

- **Maps (`scripts/maps/`)**:
  - `map-generator.js`: Template-based obstacles (EMPTY, CROSS_WALL, PILLARS, MAZE_SIMPLE).
  - Obstacles are stored as `"x,y"` keys in a Set for O(1) lookup.

- **Audio (`scripts/audio/`)**:
  - `AudioEngine`: Synthesizes sound (Oscillators/GainNodes) at runtime. No external assets.
  - Dynamic music: pitch/tempo/combo adapt via `setSnakeLength(n)` called each tick; `_resetCombo()` on restart.
  - **Audio ducking**: `duck(true)` ramps volume down on death; `duck(false)` restores it. See ⚠️ Pitfalls below.

- **UI & Input**:
  - `scripts/ui/panel-manager.js`: Integration with `lil-gui` for debug/settings.
  - `scripts/input/input-manager.js`: Unified keyboard, touch, and on-screen D-pad input.
  - `scripts/utils/keyboard-shortcut.js`: Shared guard for plain letter shortcuts (`A`, `L`, etc.) with modifier filtering.
  - `scripts/utils/dom.js`: Utility for detecting editable form elements (keyboard input guard).
  - `scripts/utils/min-heap.js`: MinHeap priority queue used by A\* pathfinding.
  - `index.html` + `styles/main.css`: Overlays for HUD, Pause, and Menus.
  - `#error-screen` in `index.html`: Handles init failures with i18n'd text and a retry button (`location.reload()`).
  - `scripts/i18n/i18n.js`: JSON-based localization, hot-swappable at runtime.

### Entry Points

- `index.html`: Main HTML entry and DOM structure.
- `scripts/main.js`: App initialization and UI wiring.
- `scripts/core/game.js`: Exports the singleton `game` instance.

## 📝 Coding Style & Conventions

- **Type Safety**:
  - ALL files must start with `// @ts-check`.
  - Use JSDoc for type definitions (`/** @type {number} */`, `/** @param {string} */`).
  - **Forbidden**: `any`, `@ts-ignore` (unless absolutely necessary and documented).

- **No Build Tools**:
  - Do not introduce Webpack, Vite, or Babel.
  - Use standard browser APIs compatible with modern browsers.

- **Import Extensions**:
  - ESLint enforces `.js` extensions on all local imports (`import/extensions: always`). Omitting them will fail linting.

- **Localization**:
  - New UI text MUST be added to **all 22 locale files** under `i18n/` (use `en-US.json` as reference; run `npm run check:i18n` to verify).
  - Use `i18n.t('key.path')` in code.
  - If adding a new locale, update `i18n/index.json` and include `locale.*` names.
  - If new locale files are added, update the cached assets in `sw.js`.
  - If `scripts/main.js` adds new static imports, ensure related core assets are listed in `sw.js` `CORE_ASSETS`.

## 🧪 Testing Guidelines

- **Core Logic**: Run `node scripts/tests/core-test.js` to verify scoring, timing, and manager logic.
- **Input Flow Regression Checks**: Manually verify `waitingForInput`, `heldDirection`, and `directionQueue` interactions (including multi-key hold/release and restart-first-tick behavior).
- **Keyboard Default Handling**: Verify gameplay keys (`WASD`, `Arrow`, `Space`) are properly prevented from leaking to browser/extension shortcuts during play.
- **Overlay Shortcut Guards**: Verify title/about/legend shortcuts only trigger on plain letter keys (no `Ctrl`/`Cmd`/`Alt` modifiers).
- **Visuals & UI**: Manual testing is required for Canvas rendering and DOM overlays.
- **HUD Controls**: Verify HUD `Pause`/`Legend`/`Restart` buttons match keyboard behavior and mobile fallbacks.
- **Panel Layout**: Verify AI `pathLength` slider labels/widgets do not overlap across common viewport widths.
- **I18n**: Run `node scripts/tools/check-i18n.js` to ensure translation keys are synced.
- **Visual Verification**: Check different skins and modes after rendering changes.
- **Death flow regression**: Verify DYING state shows screen shake + snake flash + audio ducking → transitions to GAME_OVER → audio unducks on overlay close (both button and Escape).
- **Overlay UX regression**: Verify `.active` CSS transitions, `inert` focus trap on open, first-button auto-focus, and `inert` removal on close.
- **Init failure regression**: Force an init error and verify `#error-screen` shows with i18n'd message and Retry button works.
- **Text particles regression**: Verify `emitText` floating score text appears on item pickup.
- **Audio duck regression**: Verify music is not permanently ducked after restart or any overlay close path, and remains ducked while moving between Game Over and Death Review.

## ⚠️ Critical Invariants & Pitfalls

These are easy-to-miss requirements. Violating them causes subtle, hard-to-debug issues.

### DYING State Semantics

- On collision, game transitions to `DYING` (NOT directly to `GAME_OVER`).
- The game loop **continues running** during DYING for ~1 second (`_dyingTimer` countdown). Particles update, renderer applies screen shake and snake flash animation.
- After the timer expires, transitions to `GAME_OVER` and loop stops.
- **`DYING → PAUSED` is explicitly blocked** in `StateMachine`. Do not add this transition.
- If adding new state transitions, test that DYING is not interrupted.

### Audio Ducking Must Be Cleared on All Result-Flow Exit Paths

- `audio.duck(true)` is called on death entry (in `_handleGameOver`).
- `audio.duck(false)` MUST be called on **every** path that leaves the result flow and returns to gameplay/title or fully dismisses the result overlay:
  - `game._initializeGameState()` (reset/restart)
  - Game-over close button, time-up close button
  - Escape key that closes the result flow
  - State transitions from `PAUSED`/`DYING` back to `PLAYING`
- Moving between `game-over-screen` and `death-review-screen` is **not** a result-flow dismissal. Review playback remains in `GAME_OVER`, so death audio stays ducked while entering Review and while returning to the Game Over result.
- **If you add a new way to leave the game-over/time-up result flow, you MUST add `audio.duck(false)`.** Forgetting this leaves audio permanently ducked (quiet).

### Overlay `inert` Focus Trap

- When any overlay (pause, game-over, etc.) is shown via `_showScreen()`, `#game-container.inert = true` blocks all interaction with the game.
- When hidden via `_hideScreen()`, inert is removed **only if NO other overlay is still active** (checked via `overlayIds` list).
- **Always use `_showScreen()`/`_hideScreen()`** for overlays. Direct DOM manipulation of `.active` class will break inert state.
- New overlays MUST be added to the `overlayIds` array in `main.js`.
- Shared overlay code owns autofocus. Overlay controllers must not schedule a second delayed focus that competes with `_showScreen()`.

### `waitingForInput` State

- `game.waitingForInput = true` before first player input after start/restart. During this state, `_update()` returns early (time is frozen) and renderer pulses the snake head alpha.
- Cleared on first directional input. If modifying input handling, ensure this flag is still respected.

### Service Worker (`sw.js`) Asset List

- Any new `.js` module imported by `scripts/main.js` (or its static dependency tree) MUST be added to `CORE_ASSETS` in `sw.js`, or the app will break offline.
- Same for new locale files added to `i18n/`.

### Death Review Replay Semantics

- The review is a bounded, in-memory snapshot only. Do not persist it, place it in URLs, or treat it as score verification.
- Capture the attempted move and safe-direction mask before `Snake.tick()`; fatal wall/self movement does not mutate the body.
- Each recorded frame captures the active snake skin so a mid-run visual change replays with the same appearance that was shown live.
- Review playback stays in `GAME_OVER` and uses its own `requestAnimationFrame`. It must never advance game time, item timers, RNG, scores, or daily-run counters.
- Keep `death-review-screen` in the shared overlay list and use the existing show/hide helpers so `inert` and focus remain correct.
- Gameplay turn assist intentionally uses `snake.inspectMove()` and preserves its historic one-step map/body behavior; review analysis may additionally classify lethal poison as unsafe. Do not unify those calls without deliberately changing gameplay.
- New review modules and styles must remain in `sw.js` `CORE_ASSETS`.

## 📦 Commit & PR Guidelines

- **Commit Messages**:
  - Separate subject from body with a blank line.
  - Capitalize the subject line.
  - Do not end the subject line with a period.
  - Use the imperative mood in the subject line.
  - Wrap the body at 72 characters.
  - Use the body to explain what and why vs. how.
- **PRs**: Run `npm run check` (all checks) before submitting. Ensure `check:js`, `lint`, and `check:i18n` all pass.
