// App-wide state kept in the browser only (language and school year / group context).
import data from 'virtual:catalog';
import { buildCatalog } from './lib/catalog.ts';
import { detectLang, setLang } from './lib/i18n.ts';
import type { Context } from './lib/school.ts';

export const catalog = buildCatalog(data.raw, data.grades, data.neighborhoods);

const KEY_LANG = 'bg-schools.lang';
const KEY_CTX = 'bg-schools.context';

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
