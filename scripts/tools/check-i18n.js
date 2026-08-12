// @ts-check
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isKeyboardHintToken } from '../utils/keyboard-hint.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const i18nDir = path.join(__dirname, '../../i18n');
const indexPath = path.join(i18nDir, 'index.json');
const baseLocale = 'en-US';
const basePath = path.join(i18nDir, `${baseLocale}.json`);

function flattenKeys(obj, prefix = '') {
  let keys = [];
  for (const k in obj) {
    if (typeof obj[k] === 'object' && obj[k] !== null) {
      keys = keys.concat(flattenKeys(obj[k], prefix + k + '.'));
    } else {
      keys.push(prefix + k);
    }
  }
  return keys;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string} key
 * @returns {unknown}
 */
function getValue(obj, key) {
  /** @type {unknown} */
  let value = obj;
  for (const part of key.split('.')) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    value = /** @type {Record<string, unknown>} */ (value)[part];
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function getPlaceholders(value) {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

try {
  /** @type {string[]} */
  const locales = readJson(indexPath);
  const baseContent = readJson(basePath);
  const baseKeys = new Set(flattenKeys(baseContent));

  let hasError = false;

  for (const key of [...baseKeys].filter((candidate) => candidate.startsWith('ui.guide'))) {
    for (const placeholder of getPlaceholders(getValue(baseContent, key))) {
      if (!isKeyboardHintToken(placeholder)) {
        console.error(`Error: Unknown keyboard hint placeholder {${placeholder}} in ${key}`);
        hasError = true;
      }
    }
  }

  for (const locale of locales) {
    const localePath = path.join(i18nDir, `${locale}.json`);
    if (!fs.existsSync(localePath)) {
      console.error(`Error: Missing locale file for ${locale}: ${localePath}`);
      hasError = true;
      continue;
    }

    const localeContent = readJson(localePath);
    const localeKeys = new Set(flattenKeys(localeContent));

    const missingKeys = [...baseKeys].filter((k) => !localeKeys.has(k));
    const extraKeys = [...localeKeys].filter((k) => !baseKeys.has(k));

    if (missingKeys.length > 0) {
      console.error(`Error: Keys missing in ${locale}.json:`, missingKeys);
      hasError = true;
    }

    if (extraKeys.length > 0) {
      console.error(`Error: Extra keys in ${locale}.json:`, extraKeys);
      hasError = true;
    }

    for (const key of baseKeys) {
      if (!localeKeys.has(key)) continue;
      const expected = getPlaceholders(getValue(baseContent, key));
      const actual = getPlaceholders(getValue(localeContent, key));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        console.error(
          `Error: Placeholder mismatch for ${key} in ${locale}.json:`,
          `expected [${expected.join(', ')}], got [${actual.join(', ')}]`
        );
        hasError = true;
      }
    }
  }

  if (hasError) {
    process.exit(1);
  } else {
    console.log(`Success: All i18n keys match ${baseLocale}.json.`);
  }
} catch (err) {
  console.error('Error reading or parsing JSON files:', err);
  process.exit(1);
}
