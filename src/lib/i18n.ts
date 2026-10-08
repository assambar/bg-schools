// String dictionaries: one JSON file per language in src/i18n/. Adding a language =
// adding a file with the same keys (tests check completeness). Missing keys fall back
// to English, then to the key itself.
const modules = import.meta.glob<Record<string, string>>('../i18n/*.json', { eager: true, import: 'default' });

export const dictionaries: Record<string, Record<string, string>> = {};
for (const [path, dict] of Object.entries(modules)) dictionaries[path.replace(/^.*\/|\.json$/g, '')] = dict;

export const LANGS = Object.keys(dictionaries).sort();
export const DEFAULT_LANG = 'bg';

let current = DEFAULT_LANG;

/** Saved choice, else the first browser language we have, else Bulgarian. */
export function detectLang(saved: string | null, browser: readonly string[]): string {
  if (saved && dictionaries[saved]) return saved;
  for (const l of browser) {
    const base = l.toLowerCase().split('-')[0];
    if (dictionaries[base]) return base;
  }
  return DEFAULT_LANG;
}

export function setLang(lang: string): void {
  if (dictionaries[lang]) current = lang;
}

export const getLang = (): string => current;

export function t(key: string, params: Record<string, string | number> = {}): string {
  const text = dictionaries[current]?.[key] ?? dictionaries.en?.[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** Label lookup that returns undefined instead of the key when missing. */
export const has = (key: string): boolean => key in (dictionaries[current] ?? {}) || key in (dictionaries.en ?? {});
