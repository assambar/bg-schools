// Personal status layer: the user's own state on top of the public data (status per
// entity, notes, gut feeling, chosen criteria sets, areas, reference point, budget).
// Defined generically by the domain config (`status`), validated with a generated JSON
// Schema like entity files and criteria sets. Pure: no DOM; `fetch` is passed in.
import type { ValidateFunction } from 'ajv';
import { parseDocument } from 'yaml';
import type { Domain } from './domain.ts';
import type { Money } from './entity.ts';

export interface EntityStatus {
  status: string;
  notes?: string;
  /** 1 (poor) .. 5 (great). */
  gut_feeling?: number;
  updated?: string;
}

export interface StatusFile {
  kind: 'status';
  domain: string;
  entities: Record<string, EntityStatus>;
  criteria?: string[];
  near?: string[];
  place?: [number, number];
  budget?: Money;
}

export interface LoadedStatus {
  file: StatusFile;
  /** Where it came from: `owner/repo` (or undefined for the public default file). */
  repo?: string;
  path?: string;
}

/** Problems the schema can't see: unknown entity ids, criteria sets and areas. */
export function checkStatus(s: StatusFile, dom: Domain, entityIds: readonly string[], criteriaIds: readonly string[]): string[] {
  const errors: string[] = [];
  if (s.domain !== dom.config.id) errors.push(`domain is "${s.domain}", expected "${dom.config.id}"`);
  for (const id of Object.keys(s.entities)) if (!entityIds.includes(id)) errors.push(`entities: unknown id "${id}"`);
  for (const id of s.criteria ?? []) if (!criteriaIds.includes(id)) errors.push(`criteria: unknown set "${id}"`);
  for (const n of s.near ?? []) if (!dom.areas.some((a) => a.id === n)) errors.push(`near: unknown area "${n}"`);
  return errors;
}

/** Parses and checks one status file's text. */
export function parseStatus(text: string, dom: Domain, validate: ValidateFunction, entityIds: readonly string[], criteriaIds: readonly string[]): { file?: StatusFile; errors: string[] } {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) return { errors: doc.errors.map((e) => `YAML: ${e.message.split('\n')[0]}`) };
  const data = doc.toJS();
  if (!validate(data)) return { errors: (validate.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}${e.keyword === 'additionalProperties' ? ` ("${e.params.additionalProperty}")` : ''}`) };
  const file = data as StatusFile;
  const errors = checkStatus(file, dom, entityIds, criteriaIds);
  return errors.length ? { errors } : { file, errors };
}

// ---- reading a status file from the user's private GitHub repository ------------------

export const API = 'https://api.github.com';

/** Status file convention: `<name>.status.yaml` at the repository root, or any `.yaml` in `status/`. */
export const STATUS_FILE = /^[^/]+\.status\.ya?ml$/;
export const STATUS_DIR = 'status';

export type ConnectError =
  | { key: 'status.err.token_invalid' }
  | { key: 'status.err.network'; params: { why: string } }
  | { key: 'status.err.no_private' }
  | { key: 'status.err.too_wide'; params: { n: number } }
  | { key: 'status.err.no_files'; params: { repo: string; found: string } }
  | { key: 'status.err.none_valid'; params: { repo: string; why: string } };

export type ConnectResult = { ok: true; status: LoadedStatus } | { ok: false; error: ConnectError };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Finds the single private repository the token can read and loads the first valid status
 * file from it. Only ever calls https://api.github.com, read-only. Fine-grained tokens can
 * read every public repository too, so only private repositories count.
 */
export async function connectStatus(
  token: string,
  dom: Domain,
  validate: ValidateFunction,
  entityIds: readonly string[],
  criteriaIds: readonly string[],
  fetchFn: Fetch = (u, i) => fetch(u, i),
): Promise<ConnectResult> {
  const headers = { Authorization: `Bearer ${token.trim()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const get = async (path: string, raw = false): Promise<Response> => {
    const url = path.startsWith(API + '/') ? path : `${API}${path}`;
    if (!url.startsWith(API + '/')) throw new Error('refusing to send the token outside api.github.com');
    return fetchFn(url, { headers: raw ? { ...headers, Accept: 'application/vnd.github.raw+json' } : headers, cache: 'no-store' });
  };
  try {
    // 1. Private repositories the token can access (paginated).
    const repos: { full_name: string; private: boolean }[] = [];
    let next: string | undefined = '/user/repos?visibility=private&per_page=100';
    for (let page = 0; next && page < 20; page++) {
      const res = await get(next);
      if (res.status === 401) return { ok: false, error: { key: 'status.err.token_invalid' } };
      if (!res.ok) return { ok: false, error: { key: 'status.err.network', params: { why: `GitHub answered ${res.status}` } } };
      repos.push(...((await res.json()) as typeof repos));
      next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1];
    }
    const priv = repos.filter((r) => r.private === true);
    if (priv.length === 0) return { ok: false, error: { key: 'status.err.no_private' } };
    if (priv.length > 1) return { ok: false, error: { key: 'status.err.too_wide', params: { n: priv.length } } };
    const repo = priv[0].full_name;

    // 2. Candidate files: <name>.status.yaml at the root, *.yaml in status/.
    const list = async (dir: string): Promise<{ name: string; path: string; type: string }[]> => {
      const res = await get(`/repos/${repo}/contents/${dir}`);
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${dir || '/'}`);
      const body = await res.json();
      return Array.isArray(body) ? body : [];
    };
    const root = await list('');
    const candidates = root.filter((f) => f.type === 'file' && STATUS_FILE.test(f.name)).map((f) => f.path);
    if (root.some((f) => f.type === 'dir' && f.name === STATUS_DIR)) {
      candidates.push(...(await list(STATUS_DIR)).filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name)).map((f) => f.path));
    }
    if (candidates.length === 0) {
      const found = root.map((f) => (f.type === 'dir' ? `${f.name}/` : f.name)).join(', ') || '—';
      return { ok: false, error: { key: 'status.err.no_files', params: { repo, found } } };
    }

    // 3. The first file (in path order) that validates.
    const why: string[] = [];
    for (const path of candidates.sort()) {
      const res = await get(`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, true);
      if (!res.ok) { why.push(`${path}: GitHub answered ${res.status}`); continue; }
      const { file, errors } = parseStatus(await res.text(), dom, validate, entityIds, criteriaIds);
      if (file) return { ok: true, status: { file, repo, path } };
      why.push(`${path}: ${errors.slice(0, 3).join('; ')}`);
    }
    return { ok: false, error: { key: 'status.err.none_valid', params: { repo, why: why.join(' | ') } } };
  } catch (e) {
    return { ok: false, error: { key: 'status.err.network', params: { why: (e as Error).message } } };
  }
}
