// @ts-check

/**
 * @typedef {{
 *   key?: unknown,
 *   repeat?: unknown,
 *   ctrlKey?: unknown,
 *   metaKey?: unknown,
 *   altKey?: unknown,
 *   shiftKey?: unknown,
 *   isComposing?: unknown
 * }} ShortcutKeyboardEventLike
 */

/**
 * Returns true only for a plain single-letter shortcut key press.
 * Uses event.key (locale-aware character) instead of physical key code.
 *
 * @param {ShortcutKeyboardEventLike} event
 * @param {string} letter
 * @returns {boolean}
 */
export function isPlainLetterShortcut(event, letter) {
  if (!letter || typeof letter !== 'string' || letter.length !== 1) return false;

  const normalizedLetter = letter.toLowerCase();
  if (normalizedLetter < 'a' || normalizedLetter > 'z') return false;

  if (!event || typeof event.key !== 'string') return false;
  if (Boolean(event.repeat) || Boolean(event.isComposing)) return false;
  if (
    Boolean(event.ctrlKey) ||
    Boolean(event.metaKey) ||
    Boolean(event.altKey) ||
    Boolean(event.shiftKey)
  )
    return false;

  return event.key.toLowerCase() === normalizedLetter;
}
