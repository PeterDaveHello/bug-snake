# SerpentOS: Bug Buster Snake (除蟲特攻蛇)

> An AI Vibe Coding showcase: a snake game in Vanilla JS (ES Modules), Canvas 2D,
> and Web Audio. No bundler, no framework. ~7,000 lines, mostly AI-written with
> human direction.

This repository is a demonstration project for AI-assisted development under
real product constraints: 22-language i18n, PWA offline support, keyboard
accessibility, synthesized audio, and a proper game state machine.

![Vanilla JS](https://img.shields.io/badge/Vanilla_JS-ES_Modules-F7DF1E?logo=javascript&logoColor=black)
![Canvas 2D](https://img.shields.io/badge/Rendering-Canvas_2D-4A90D9)
![No Build Step](https://img.shields.io/badge/Build_Step-None-brightgreen)
![22 Locales](https://img.shields.io/badge/I18n-22_Languages-8E44AD)
![PWA](https://img.shields.io/badge/PWA-Offline_Ready-E67E22)

## 🎮 Features

### 🕹️ Gameplay

- 3 game modes: Classic Infinite, Level Challenge (collect targets to advance), Time Attack (60-second sprint).
- Items include food (Roach, Ant, Mosquito, Egg, Mouse), trash (score penalty), and poison (shrink or game over).
- AI autopilot using A\*, BFS, or Greedy pathfinding: watch it play or let it guide you.
- 4 map templates (Empty, Cross Wall, Pillars, Maze), plus toggleable wall wrapping.

### 🎨 The Juice (Visual & Audio)

- 4 snake skins (Neon Coil, Quantum Ribbon, Chrome Warden, Void Pulse), each with its own breathing animation.
- Death sequence: `DYING` → `GAME_OVER` with screen shake, snake flash, and audio ducking.
- `+10` / `-3` text particles float up from items on pickup. Burst particles on eat and other events.
- All SFX synthesized via Web Audio API, with no audio files. Music pitch, tempo, and combo intensity react to snake length and speed.
- Snake head pulses before first move so you know it's waiting for input.
- Smooth CSS transitions between screens.

### ⚙️ Technical

- 22-locale i18n with runtime switching. HTML `lang`/`dir` updates automatically for RTL.

  <details>
  <summary>All supported locales</summary>

  `ar-SA` `bn-BD` `de-DE` `en-US` `es-ES` `fa-IR` `fr-FR` `hi-IN` `id-ID` `it-IT` `ja-JP` `ko-KR` `nl-NL` `pl-PL` `pt-BR` `ru-RU` `th-TH` `tr-TR` `ur-PK` `vi-VN` `zh-CN` `zh-TW`
  </details>

- PWA with service worker that pre-caches all core assets and locale files.
- Accessible overlays: `inert` focus trap + auto-focus on modal open; `role="application"` on canvas with ARIA labels.
- Init-failure screen with localized error message and retry button.
- HUD buttons show inline keyboard hints (`<kbd>Esc</kbd>`, `<kbd>R</kbd>`, `<kbd>L</kbd>`, `<kbd>Enter</kbd>`, `<kbd>A</kbd>`).
- Mobile: on-screen D-pad with touch-hold auto-repeat; `touch-action` scoped to interactive zones.
- Type-checked with JSDoc + `tsc`, with no TypeScript compilation step.
- Built and iterated as an AI Vibe Coding demo using small diffs and review-driven refinement.

## 🤖 Why "AI Vibe Coding"?

This project is intentionally positioned as an AI Vibe Coding demonstration.
I wanted to see how far AI-assisted development could go beyond a throwaway demo.
The architecture decisions (state machine design, module boundaries, no build tools) are mine; the implementation is mostly AI-generated, reviewed and revised by a human.

The workflow uses small diffs, each reviewed, sometimes by other AI models too.
Localization, accessibility, offline support, and error handling were built in from the start, not bolted on after the fact.

The result is ~7k lines of vanilla ES modules. Clear separation between core logic, rendering, AI, input, audio, and i18n, with no framework layer to dig through.

### 🧪 Some things to try

1. **Add a new skin**: Implement `_drawYourSkin(snake, alpha)` in `renderer.js`, add an entry to the skin selector in `panel-manager.js`.
2. **Add a new item type**: Define it in `config.js` `ItemDefs`, hook it up in `item-manager.js` and `game.js`.
3. **Add a new locale**: Create `i18n/xx-XX.json` (copy `en-US.json`), add to `i18n/index.json`, update `sw.js` `CORE_ASSETS`.
4. Run `npm run check` to verify nothing broke.

## 🚀 Running locally

ES Modules require a server, so you can't just open `index.html` directly.

1. Clone the repository.
2. Run `npx serve .` (or use VS Code's Live Server extension).
3. Open `http://localhost:3000`.

## 🕹️ Controls

| Action                          | Keyboard                                               | Mobile            |
| :------------------------------ | :----------------------------------------------------- | :---------------- |
| **Move**                        | <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> / <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> _(also <kbd>Z</kbd>+<kbd>Q</kbd>)_ | On-screen D-Pad   |
| **Boost** (hold same direction) | Hold <kbd>Space</kbd>                                 | Hold D-Pad button |
| **Start (Title Screen)**        | <kbd>Enter</kbd>                                      | Start Button      |
| **About (Title/About Screen)**  | <kbd>A</kbd>                                          | About Button      |
| **Pause / Resume**              | <kbd>Esc</kbd>                                        | Pause Button      |
| **Restart**                     | <kbd>R</kbd> (<kbd>Shift</kbd>+<kbd>R</kbd> randomize) | Restart Button    |
| **Toggle Legend**               | <kbd>L</kbd>                                          | Legend Button     |
| **Toggle AI**                   | <kbd>I</kbd>                                          | (Panel Setting)   |
| **Toggle AI Path Display**      | <kbd>P</kbd>                                          | (Panel Setting)   |

## 🛠️ Development

### Project structure

```
.
├── index.html          # Entry point and DOM structure
├── scripts/
│   ├── core/           # Game logic (Grid, Snake, GameLoop, StateMachine)
│   ├── render/         # Canvas rendering, Particles, TextParticles
│   ├── ai/             # A*, BFS, Greedy pathfinding
│   ├── audio/          # Web Audio API engine (synthesized SFX + music)
│   ├── input/          # Keyboard/touch/D-pad input handling
│   ├── i18n/           # Runtime localization loader
│   ├── ui/             # lil-gui panel & HUD management
│   ├── maps/           # Map template generator
│   ├── utils/          # DOM helpers, keyboard-shortcut guard, MinHeap
│   ├── tests/          # Node-based smoke tests (core logic)
│   └── tools/          # i18n consistency checker
├── styles/             # CSS
├── i18n/               # Localization files (22 locales; see i18n/index.json)
└── sw.js               # Service worker for offline caching
```

### LOC Snapshot (cloc)

`cloc --exclude-dir=node_modules,assets,.git,.github --timeout=1000 --by-file-by-lang .`

- Scope: project source + docs only, excluding external/build folders
- `60` files scanned
- `18,869` total lines:
  - `18,312` lines of code
  - `1,414` blank lines
  - `681` comment lines
- Language distribution:
  - JavaScript: `27` files / `7,312` code lines
  - JSON: `26` files / `10,002` code lines
  - CSS: `1` file / `892` code lines
  - Markdown: `2` files / `242` code lines
  - HTML: `1` file / `367` code lines
  - TypeScript: `1` file / `42` code lines

### Checks

- **Node**: Requires Node.js v20+ for linting tools
- **Install Dev Deps**: `npm install`
- **I18n Check**: `npm run check:i18n`
- **Type Check**: `npm run check:js`
- **Core Tests**: `npm run test:core`
- **Lint**: `npm run lint`
- **Markdown Lint**: `npm run lint:md`
- **Format Check**: `npm run format:check`
- **Format Write**: `npm run format`
- **Lint + Format Quality Check**: `npm run check:quality` (opt-in during migration)
- **Lint Auto Fix**: `npm run lint:fix`
- **All Checks**: `npm run check`
- **Note**: Node scripts run as ESM (`type: "module"` in `package.json`)

## 📝 License

GNU General Public License v3.0 or later (GPL-3.0+)
