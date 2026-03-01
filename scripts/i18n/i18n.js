// @ts-check
export class I18nManager {
  /** @type {ReadonlySet<string>} */
  static RTL_LOCALES = new Set(['ar-SA', 'fa-IR', 'ur-PK']);

  constructor() {
    this.locale = 'zh-TW';
    this.fallbackLocale = 'zh-TW';
    this.strings = {};
    this.fallbackStrings = {};
    this.listeners = [];
    this.availableLocales = ['zh-TW', 'en-US'];
  }

  async init() {
    await this._loadLocaleIndex();

    let stored = null;
    try {
      stored = localStorage.getItem('serpentos_locale');
    } catch (e) {
      /* storage unavailable */
    }
    if (stored) {
      this.locale = stored;
    } else {
      const navLang = navigator.language;
      if (navLang.startsWith('en')) {
        this.locale = 'en-US';
      } else {
        this.locale = 'zh-TW';
      }
    }

    console.log(`[I18n] Initializing with locale: ${this.locale}`);

    const fallbackLoaded = await this.loadStrings(this.fallbackLocale, true);
    if (!fallbackLoaded) {
      throw new Error(`[I18n] Failed to load fallback locale: ${this.fallbackLocale}`);
    }

    if (this.locale !== this.fallbackLocale) {
      await this.loadStrings(this.locale, false);
      // this.locale may have been reset to fallbackLocale on load failure
    }

    document.documentElement.lang = this.locale;
    document.documentElement.dir = I18nManager.RTL_LOCALES.has(this.locale) ? 'rtl' : 'ltr';
  }

  async loadStrings(locale, isFallback = false) {
    try {
      const response = await fetch(`./i18n/${locale}.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      if (isFallback) {
        this.fallbackStrings = data;
      } else {
        this.strings = data;
      }
      console.log(`[I18n] Loaded ${locale}`);
      return true;
    } catch (e) {
      console.error(`[I18n] Failed to load ${locale}:`, e);
      if (!isFallback) {
        console.warn(`[I18n] Reverting to fallback ${this.fallbackLocale}`);
        this.locale = this.fallbackLocale;
        this.strings = this.fallbackStrings;
      }
      return false;
    }
  }

  async setLocale(newLocale) {
    if (this.locale === newLocale) return;

    const loaded = await this.loadStrings(newLocale, false);
    const effectiveLocale = loaded ? newLocale : this.locale;
    this.locale = effectiveLocale;
    document.documentElement.lang = effectiveLocale;
    document.documentElement.dir = I18nManager.RTL_LOCALES.has(effectiveLocale) ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('serpentos_locale', effectiveLocale);
    } catch (e) {
      /* storage unavailable */
    }

    this.notifyListeners(effectiveLocale);
  }

  addListener(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
    }
  }

  /**
   * @returns {Record<string, string>}
   */
  getLocaleOptions() {
    const options = /** @type {Record<string, string>} */ ({});
    this.availableLocales.forEach((locale) => {
      const label = this.t(`locale.${locale}`);
      const key = label.startsWith('[[') ? locale : label;
      options[key] = locale;
    });
    return options;
  }

  async _loadLocaleIndex() {
    try {
      const response = await fetch('./i18n/index.json');
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        this.availableLocales = data;
      }
    } catch (e) {
      // Ignore optional locale index load failures
    }
  }

  notifyListeners(locale) {
    this.listeners.forEach((cb) => cb(locale));
  }

  t(key, params = {}) {
    const keys = key.split('.');
    let value = this._getValue(this.strings, keys);

    if (value === undefined) {
      value = this._getValue(this.fallbackStrings, keys);
    }

    if (value === undefined) {
      return `[[${key}]]`;
    }

    if (typeof value === 'string' && Object.keys(params).length > 0) {
      return value.replace(/\{(\w+)\}/g, (match, paramKey) => {
        return params[paramKey] !== undefined ? params[paramKey] : match;
      });
    }

    return value;
  }

  _getValue(obj, keys) {
    let current = obj;
    for (const k of keys) {
      if (current === undefined || current === null) return undefined;
      current = current[k];
    }
    return current;
  }
}

export const i18n = new I18nManager();
