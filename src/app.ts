// The running app: one domain with its entities, criteria sets and validator, plus the
// state kept in the browser only (language, context, selected criteria sets, the user's
// areas). main.ts fills it from the build-time data; tests fill it with any domain.
import type { ValidateFunction } from 'ajv';
import type { CriteriaSet } from './lib/criteria.ts';
import { connectStatus, type ConnectError, type LoadedStatus, type StatusFile } from './lib/status.ts';
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
  /** Personal status: validator and the public fallback file (domain config `status`). */
  statusValidate?: ValidateFunction;
  statusDefault?: StatusFile | null;
  /** Browse-only domain (list and detail pages, no editing), listed at `#/<domain id>`. */
  browseOnly?: boolean;
}

let data: AppData | undefined;
/** The main domain (initApp) and the browse-only ones (registerDomain), by domain id. */
let primary: AppData | undefined;
const extras = new Map<string, AppData>();

export function registerDomain(d: AppData): void {
  extras.set(d.domain.config.id, { ...d, browseOnly: true });
}
export const extraDomains = (): AppData[] => [...extras.values()];

/** Makes a domain the active one (default: the main domain); its dictionaries win. */
export function activate(id?: string): AppData {
  const d = (id && extras.get(id)) || primary;
  if (!d) throw new Error('initApp() was not called');
  if (data !== d) {
    data = d;
    addDictionaries(d.i18n);
  }
  return d;
}

/** Where the list of the active domain is: `#/` for the main one, `#/<id>` for the others. */
export const listHref = (): string => (app().browseOnly ? `#/${app().domain.config.id}` : '#/');

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
  /** The user's reference point [lat, lon] for distance rules (from the personal status). */
  place: undefined as [number, number] | undefined,
  /** Personal status in use: from the user's private repository, else the public default. */
  status: undefined as LoadedStatus | undefined,
};

/** The GitHub token, in memory only unless the user opted in to remembering it. */
let token: string | undefined;

// Settings live under the main domain's prefix, whichever domain is active.
const key = (name: string) => `${(primary ?? app()).domain.config.storage_prefix}.${name}`;

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
  primary = d;
  addDictionaries(d.i18n);
  // ?lang=en in the URL wins (handy for sharing a link in a given language).
  const urlLang = new URLSearchParams(location.search).get('lang');
  state.lang = detectLang(urlLang ?? read('lang'), navigator.languages ?? [navigator.language]);
  state.ctx = { ...d.domain.defaultContext, ...(JSON.parse(read('context') ?? '{}') as Context) };
  state.criteria = JSON.parse(read('criteria') ?? JSON.stringify(d.domain.config.criteria.default_selection)) as string[];
  state.near = JSON.parse(read('near') ?? '[]') as string[];
  state.place = undefined;
  state.status = d.statusDefault ? { file: d.statusDefault } : undefined;
  token = undefined;
  setLang(state.lang);
  document.documentElement.lang = state.lang;
}

/** A JSON setting kept in this browser (e.g. the Finance page inputs). */
export function readSetting<T>(name: string): T | undefined {
  try {
    const raw = read(name);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}
export const writeSetting = (name: string, value: unknown): void => write(name, JSON.stringify(value));

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

// ---- personal status ---------------------------------------------------------------------

/** The domain's criteria sets plus, with a personal budget, a "My budget" set. */
export function criteriaSets(): CriteriaSet[] {
  const { criteria, domain } = app();
  const budget = state.status?.file.budget;
  const cfg = domain.config.status?.budget;
  if (!budget || !cfg) return criteria;
  return [...criteria, { id: STATUS_BUDGET_SET, kind: cfg.kind, require: [{ dim: cfg.dim, lte: budget }] }];
}
export const STATUS_BUDGET_SET = 'my-budget';

export const isRemembered = (): boolean => read('status-token') !== null;
export const hasToken = (): boolean => token !== undefined;

function apply(loaded: LoadedStatus): void {
  state.status = loaded;
  const f = loaded.file;
  // In memory only: your own choices from the browser are restored on disconnect.
  if (f.criteria?.length) state.criteria = f.criteria;
  if (f.near) state.near = f.near;
  state.place = f.place;
}

/** Connects with a token; on success the status file overlays the public data. */
export async function connect(newToken: string, remember: boolean, fetchFn?: (u: string, i?: RequestInit) => Promise<Response>): Promise<ConnectError | undefined> {
  const d = app();
  if (!d.statusValidate) return { key: 'status.err.network', params: { why: 'no status schema in this domain' } };
  const r = await connectStatus(newToken, d.domain, d.statusValidate, d.entities.map((e) => e.id), [...d.criteria.map((c) => c.id), STATUS_BUDGET_SET], fetchFn);
  if (!r.ok) return r.error;
  token = newToken;
  if (remember) write('status-token', newToken);
  else forget();
  apply(r.status);
  return undefined;
}

function forget(): void {
  try {
    localStorage.removeItem(key('status-token'));
  } catch {
    /* nothing stored */
  }
}

/** Drops the token (memory and device) and goes back to the public default status. */
export function disconnect(): void {
  token = undefined;
  forget();
  const d = app();
  state.status = d.statusDefault ? { file: d.statusDefault } : undefined;
  state.criteria = JSON.parse(read('criteria') ?? JSON.stringify(d.domain.config.criteria.default_selection)) as string[];
  state.near = JSON.parse(read('near') ?? '[]') as string[];
  state.place = undefined;
}

/** On start: reconnect with a remembered token. Returns the error if it no longer works. */
export async function reconnect(fetchFn?: (u: string, i?: RequestInit) => Promise<Response>): Promise<ConnectError | undefined> {
  const saved = read('status-token');
  return saved ? connect(saved, true, fetchFn) : undefined;
}
