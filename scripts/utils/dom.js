// @ts-check

/**
 * Checks if an element is an editable form control that should receive keyboard input.
 * @param {EventTarget | null} el
 * @returns {boolean}
 */
export function isEditableElement(el) {
  if (!(el instanceof HTMLElement)) {
    return false;
  }
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) {
    return true;
  }
  if (tag === 'INPUT' && el instanceof HTMLInputElement) {
    return el.type === 'text' || el.type === 'number';
  }
  return false;
}

/**
 * Sets an anchor URL and label after removing its query string.
 * @param {HTMLAnchorElement} anchor
 * @param {string} href
 */
export function setAnchorUrlWithoutSearch(anchor, href) {
  const url = new URL(href);
  url.search = '';
  anchor.href = url.href;
  anchor.textContent = url.href;
}

/** @type {Map<string, HTMLElement | null>} */
const _elCache = new Map();

/**
 * @param {string} id
 * @returns {HTMLElement | null}
 */
function _getEl(id) {
  if (_elCache.has(id)) return _elCache.get(id) ?? null;
  const el = document.getElementById(id);
  if (el) _elCache.set(id, el);
  return el;
}

/**
 * Sets the text content of an element by ID if it exists.
 * @param {string} id
 * @param {string} text
 */
export function setElementText(id, text) {
  const el = _getEl(id);
  if (el) {
    if (el.textContent !== text) {
      el.textContent = text;
    }
  }
}

/**
 * Shows or hides an element by ID.
 * @param {string} id
 * @param {boolean} visible
 */
export function setElementVisible(id, visible) {
  const el = _getEl(id);
  if (el) {
    el.style.display = visible ? 'block' : 'none';
  }
}
