// @ts-check
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

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

try {
  /** @type {string[]} */
  const locales = readJson(indexPath);
  const baseContent = readJson(basePath);
  const baseKeys = new Set(flattenKeys(baseContent));

  let hasError = false;

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
