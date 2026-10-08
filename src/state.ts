// App-wide state kept in the browser only (language, school year / group context,
// selected criteria sets and the user's neighbourhoods).
import data from 'virtual:catalog';
import { buildCatalog, mergeRetrieval } from './lib/catalog.ts';
import { detectLang, setLang } from './lib/i18n.ts';
import type { Context } from './lib/school.ts';

export const catalog = buildCatalog(data.raw, data.grades, data.neighborhoods);
for (const overlay of data.overlays) mergeRetrieval(catalog, overlay); // checked at build time

const KEY_LANG = 'bg-schools.lang';
const KEY_CTX = 'bg-schools.context';
const KEY_CRITERIA = 'bg-schools.criteria';
const KEY_NEAR = 'bg-schools.near';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: keep in memory only */
  }
}

// ?lang=en in the URL wins (handy for sharing a link in a given language).
const urlLang = new URLSearchParams(location.search).get('lang');

export const state = {
  lang: detectLang(urlLang ?? read(KEY_LANG), navigator.languages ?? [navigator.language]),
  ctx: { ...catalog.defaultContext, ...(JSON.parse(read(KEY_CTX) ?? '{}') as Partial<Context>) } as Context,
  /** Selected criteria set ids (Criteria page). */
  criteria: JSON.parse(read(KEY_CRITERIA) ?? '["basics","budget-medium","anywhere"]') as string[],
  /** The user's neighbourhoods for location rules. Stays in this browser only. */
  near: JSON.parse(read(KEY_NEAR) ?? '[]') as string[],
};
setLang(state.lang);
document.documentElement.lang = state.lang;

export function changeLang(lang: string): void {
  state.lang = lang;
  setLang(lang);
  document.documentElement.lang = lang;
  write(KEY_LANG, lang);
}

export function changeContext(ctx: Context): void {
  state.ctx = ctx;
  write(KEY_CTX, JSON.stringify(ctx));
}

export function changeCriteria(ids: string[]): void {
  state.criteria = ids;
  write(KEY_CRITERIA, JSON.stringify(ids));
}

export function changeNear(ids: string[]): void {
  state.near = ids;
  write(KEY_NEAR, JSON.stringify(ids));
}
