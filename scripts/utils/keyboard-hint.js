// @ts-check

/**
 * @typedef {'arrowKeys' | 'wasd' | 'escape' | 'restart' | 'randomRestart' | 'space' | 'toggleAI' | 'togglePath'} KeyboardHintToken
 * @typedef {{ keys: readonly string[], separator: '' | '+', labelKey?: string }} KeyboardHint
 * @typedef {{ type: 'text', value: string } | { type: 'keys', keys: readonly string[], separator: '' | '+', labelKey?: string }} KeyboardHintPart
 */

/**
 * @param {string[]} keys
 * @param {'' | '+'} [separator]
 * @param {string} [labelKey]
 * @returns {KeyboardHint}
 */
function createKeyboardHint(keys, separator = '', labelKey = undefined) {
  return Object.freeze({ keys: Object.freeze(keys), separator, labelKey });
}

/** @type {Readonly<Record<KeyboardHintToken, KeyboardHint>>} */
const KEYBOARD_HINTS = Object.freeze({
  arrowKeys: createKeyboardHint(['↑', '↓', '←', '→'], '', 'ui.keyArrowKeys'),
  wasd: createKeyboardHint(['W', 'A', 'S', 'D']),
  escape: createKeyboardHint(['Esc']),
  restart: createKeyboardHint(['R']),
  randomRestart: createKeyboardHint(['Shift', 'R'], '+'),
  space: createKeyboardHint(['Space']),
  toggleAI: createKeyboardHint(['I']),
  togglePath: createKeyboardHint(['P'])
});

/** @type {readonly KeyboardHintToken[]} */
export const KEYBOARD_HINT_TOKENS = Object.freeze(
  /** @type {KeyboardHintToken[]} */ (Object.keys(KEYBOARD_HINTS))
);

/**
 * @param {string} value
 * @returns {value is KeyboardHintToken}
 */
export function isKeyboardHintToken(value) {
  return Object.prototype.hasOwnProperty.call(KEYBOARD_HINTS, value);
}

/**
 * @param {string} shortcut
 * @returns {string[]}
 */
export function splitKeyboardShortcut(shortcut) {
  return shortcut.split('+').map((key) => key.trim());
}

/**
 * Splits translated guide text into text and trusted keyboard-hint parts.
 * Unknown placeholders remain text so malformed translations fail visibly.
 *
 * @param {string} text
 * @returns {KeyboardHintPart[]}
 */
export function tokenizeKeyboardHints(text) {
  /** @type {KeyboardHintPart[]} */
  const parts = [];
  const tokenPattern = /\{(\w+)\}/g;
  let textStart = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const token = match[1];
    const index = match.index;
    if (!isKeyboardHintToken(token) || index === undefined) continue;

    if (index > textStart) {
      parts.push({ type: 'text', value: text.slice(textStart, index) });
    }

    const hint = KEYBOARD_HINTS[token];
    parts.push({
      type: 'keys',
      keys: hint.keys,
      separator: hint.separator,
      labelKey: hint.labelKey
    });
    textStart = index + match[0].length;
  }

  if (textStart < text.length) {
    parts.push({ type: 'text', value: text.slice(textStart) });
  }

  return parts;
}
