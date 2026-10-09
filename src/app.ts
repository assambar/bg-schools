// The running app: one domain with its entities, criteria sets and validator, plus the
// state kept in the browser only (language, context, selected criteria sets, the user's
// areas). main.ts fills it from the build-time data; tests fill it with any domain.
import type { ValidateFunction } from 'ajv';
import type { CriteriaSet } from './lib/criteria.ts';
import type { Context, Domain } from './lib/domain.ts';
import type { Entity } from './lib/entity.ts';
import { addDictionaries, detectLang, setLang } from './lib/i18n.ts';

export interface AppData {
  domain: Domain;
  entities: Entity[];
  criteria: CriteriaSet[];
  validate: ValidateFunction;
  /** The domain's dictionaries per language. */
  i18n: Record<string, Record<string, string>>;
}

let data: AppData | undefined;

export const app = (): AppData => {
  if (!data) throw new Error('initApp() was not called');
  return data;
};

export const state = {
  lang: '',
  ctx: {} as Context,
  /** Selected criteria set ids (Criteria page). */
  criteria: [] as string[],
  /** The user's areas for location rules. Stays in this browser only. */
  near: [] as string[],
};

const key = (name: string) => `${app().domain.config.storage_prefix}.${name}`;

function read(name: string): string | null {
  try {
    return localStorage.getItem(key(name));
  } catch {
    return null;
  }
}
function write(name: string, value: string): void {
  try {
    localStorage.setItem(key(name), value);
  } catch {
    /* private mode: keep in memory only */
  }
}

export function initApp(d: AppData): void {
  data = d;
  addDictionaries(d.i18n);
  // ?lang=en in the URL wins (handy for sharing a link in a given language).
  const urlLang = new URLSearchParams(location.search).get('lang');
  state.lang = detectLang(urlLang ?? read('lang'), navigator.languages ?? [navigator.language]);
  state.ctx = { ...d.domain.defaultContext, ...(JSON.parse(read('context') ?? '{}') as Context) };
  state.criteria = JSON.parse(read('criteria') ?? JSON.stringify(d.domain.config.criteria.default_selection)) as string[];
  state.near = JSON.parse(read('near') ?? '[]') as string[];
  setLang(state.lang);
  document.documentElement.lang = state.lang;
}

export function changeLang(lang: string): void {
  state.lang = lang;
  setLang(lang);
  document.documentElement.lang = lang;
  write('lang', lang);
}

export function changeContext(ctx: Context): void {
  state.ctx = ctx;
  write('context', JSON.stringify(ctx));
}

export function changeCriteria(ids: string[]): void {
  state.criteria = ids;
  write('criteria', JSON.stringify(ids));
}

export function changeNear(ids: string[]): void {
  state.near = ids;
  write('near', JSON.stringify(ids));
}
