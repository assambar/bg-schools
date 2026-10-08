// School file types and pure helpers (value resolution, cross-file checks, YAML output).
import { Document, isMap, isScalar, isSeq, visit } from 'yaml';
import { SCOPE_KEYS, type Catalog, type CheckFlag, type Retrieval, type SourceKind } from './catalog.ts';

export const REPO = 'assambar/bg-schools';
export const BRANCH = 'main';
export const DATA_DIR = 'data/schools';

export interface Src {
  kind?: SourceKind;
  date?: string;
  url?: string;
  ref?: string;
  source_ref?: string;
  by?: string;
  verified?: boolean;
  check?: CheckFlag;
  note?: string;
}

export interface Scope {
  year?: string;
  grade?: string | string[];
  site?: string;
}

export interface Entry {
  v: unknown;
  src?: Src;
  scope?: Scope;
  note?: string;
}

export interface Site {
  id: string;
  address?: string;
  neighborhood?: string | string[];
  geo?: [number, number];
  src?: Src;
}

export interface School {
  id: string;
  name: string;
  name_en?: string;
  sites: Site[];
  defaults?: { src?: Src };
  values: Record<string, Entry | Entry[]>;
  retrieval?: Record<string, Retrieval & { replace?: boolean }>;
}

/** A money value (see schema-gen): an amount or a min–max range. */
export interface Money { amount?: number; min?: number; max?: number; currency: string; per: string; months?: number }

export interface Context {
  year: string;
  grade: string;
}

export const entriesOf = (s: School, dim: string): Entry[] => {
  const v = s.values[dim];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
};

/** A value's provenance with the file-level defaults applied. */
export const resolveSrc = (s: School, e: Entry): Src => ({ ...(s.defaults?.src ?? {}), ...(e.src ?? {}) });

const PRECEDENCE: SourceKind[] = ['visit', 'call', 'manual', 'user-edit', 'extracted', 'imported', 'derived'];

/** How well an entry's scope fits the current context. Higher is better; -1 = other year. */
export function scopeFit(scope: Scope | undefined, ctx: Context): number {
  if (!scope) return 1;
  const grades = scope.grade === undefined ? undefined : ([] as string[]).concat(scope.grade);
  const yearOk = !scope.year || scope.year === ctx.year;
  const gradeOk = !grades || grades.includes(ctx.grade);
  // Another year or grade: negative, but prefer the right grade from another year
  // (e.g. last year's price for the same group) over the right year for another grade.
  if (!yearOk || !gradeOk) return -3 + (gradeOk ? (grades ? 2 : 1) : 0) + (yearOk ? 0.5 : 0);
  return 1 + (scope.year ? 2 : 0) + (grades ? 1 : 0);
}

export type Match = 'exact' | 'general' | 'other';

/**
 * The entry to show and filter on for a context: best scope fit first, then source
 * precedence (visit > call > manual > user-edit > extracted > imported > derived), then newest.
 * Entries for another year or grade are only used when nothing else exists ("other");
 * among those, the same grade from another year wins.
 */
export function pickEntry(s: School, dim: string, ctx: Context): { entry: Entry; src: Src; match: Match } | undefined {
  const ranked = entriesOf(s, dim)
    .map((entry) => ({ entry, src: resolveSrc(s, entry), fit: scopeFit(entry.scope, ctx) }))
    .sort(
      (a, b) =>
        b.fit - a.fit ||
        PRECEDENCE.indexOf(a.src.kind ?? 'derived') - PRECEDENCE.indexOf(b.src.kind ?? 'derived') ||
        (b.src.date ?? '').localeCompare(a.src.date ?? ''),
    );
  const best = ranked[0];
  if (!best) return undefined;
  const match: Match = best.fit < 0 ? 'other' : best.fit > 1 ? 'exact' : 'general';
  return { entry: best.entry, src: best.src, match };
}

/** True if several entries with the same scope as the shown one disagree. */
export function hasConflict(s: School, dim: string, ctx: Context): boolean {
  const picked = pickEntry(s, dim, ctx);
  if (!picked) return false;
  const key = JSON.stringify(picked.entry.scope ?? {});
  const same = entriesOf(s, dim).filter((e) => JSON.stringify(e.scope ?? {}) === key);
  return new Set(same.map((e) => JSON.stringify(e.v))).size > 1;
}

export function neighborhoodsOf(s: School): string[] {
  return [...new Set(s.sites.flatMap((site) => (site.neighborhood === undefined ? [] : ([] as string[]).concat(site.neighborhood))))];
}

/** Cross-file rules the JSON Schema can't express. `refs` collects source_refs across files. */
export function checkSchool(s: School, cat: Catalog, refs: Map<string, string> = new Map()): string[] {
  const errors: string[] = [];
  const siteIds = new Set<string>();
  for (const site of s.sites) {
    if (siteIds.has(site.id)) errors.push(`sites: duplicate site id "${site.id}"`);
    siteIds.add(site.id);
    if ((site.address || site.neighborhood || site.geo) && !site.src?.source_ref) errors.push(`sites/${site.id}: needs src.source_ref`);
    const ref = site.src?.source_ref;
    if (ref) {
      if (refs.has(ref)) errors.push(`sites/${site.id}: source_ref "${ref}" is already used by ${refs.get(ref)}`);
      else refs.set(ref, `${s.id}/sites/${site.id}`);
    }
  }
  for (const [dimId, raw] of Object.entries(s.values)) {
    const dim = cat.byId.get(dimId);
    if (!dim) continue; // the schema already reports unknown dimensions
    const list = Array.isArray(raw) ? raw : [raw];
    list.forEach((e, i) => {
      const where = list.length > 1 ? `${dimId}[${i}]` : dimId;
      for (const key of SCOPE_KEYS) {
        if (e.scope?.[key] !== undefined && !(dim.scopable ?? []).includes(key)) {
          errors.push(`${where}: "${dimId}" can't be scoped by ${key}`);
        }
      }
      if (e.scope?.site && !siteIds.has(e.scope.site)) errors.push(`${where}: unknown site "${e.scope.site}"`);
      if (e.scope?.year) {
        const [a, b] = e.scope.year.split('/').map(Number);
        if (b !== a + 1) errors.push(`${where}: school year must be consecutive years, e.g. 2027/2028`);
      }
      const src = resolveSrc(s, e);
      if (!src.kind) errors.push(`${where}: provenance needs a kind (here or in defaults.src)`);
      if (!src.date) errors.push(`${where}: provenance needs a date (here or in defaults.src)`);
      if (!e.src?.source_ref) errors.push(`${where}: every value needs its own src.source_ref`);
      if ((src.kind === 'extracted' || src.kind === 'manual') && !src.url) errors.push(`${where}: kind "${src.kind}" needs a url`);
      if (src.kind === 'imported' && !src.ref) errors.push(`${where}: kind "imported" needs a ref (the batch label)`);
      const ref = e.src?.source_ref;
      if (ref) {
        const other = refs.get(ref);
        if (other) errors.push(`${where}: source_ref "${ref}" is already used by ${other}`);
        else refs.set(ref, `${s.id}/${where}`);
      }
      const v = e.v as Record<string, number> | undefined;
      if (v && typeof v === 'object' && 'min' in v && 'max' in v && v.min > v.max) errors.push(`${where}: min is greater than max`);
    });
  }
  return errors;
}

// ---- YAML output -------------------------------------------------------------

const TOP_ORDER = ['id', 'name', 'name_en', 'sites', 'defaults', 'values', 'retrieval'];
const ENTRY_ORDER = ['v', 'scope', 'src', 'note'];
const SRC_ORDER = ['kind', 'ref', 'source_ref', 'date', 'url', 'by', 'verified', 'check', 'note'];

function ordered<T extends Record<string, unknown>>(o: T, order: string[]): T {
  const out: Record<string, unknown> = {};
  for (const k of order) if (o[k] !== undefined) out[k] = o[k];
  for (const k of Object.keys(o)) if (!(k in out)) out[k] = o[k];
  return out as T;
}

const orderEntry = (e: Entry): Entry => {
  const out = ordered(e as unknown as Record<string, unknown>, ENTRY_ORDER) as unknown as Entry;
  if (out.src) out.src = ordered(out.src as Record<string, unknown>, SRC_ORDER) as Src;
  return out;
};

/** Canonical file layout: fixed key order, values in catalog order, so diffs stay small. */
export function canonical(s: School, cat: Catalog): School {
  const values: School['values'] = {};
  const known = cat.dimensions.map((d) => d.id).filter((id) => id in s.values);
  for (const id of [...known, ...Object.keys(s.values).filter((k) => !cat.byId.has(k))]) {
    const v = s.values[id];
    values[id] = Array.isArray(v) ? v.map(orderEntry) : orderEntry(v);
  }
  const out = ordered({ ...s, values } as unknown as Record<string, unknown>, TOP_ORDER) as unknown as School;
  if (out.defaults?.src) out.defaults = { src: ordered(out.defaults.src as Record<string, unknown>, SRC_ORDER) as Src };
  return out;
}

/** YAML text: maps and lists that hold only scalars are written inline (`{ a: 1 }`). */
export function toYaml(s: School, cat: Catalog): string {
  const doc = new Document(canonical(s, cat));
  visit(doc, {
    Map(_key, node) {
      if (node.items.every((p) => isScalar(p.value))) node.flow = true;
    },
    Seq(_key, node) {
      if (node.items.every((i) => isScalar(i))) node.flow = true;
    },
  });
  // The top-level document map always stays block style.
  if (isMap(doc.contents)) doc.contents.flow = false;
  for (const item of isMap(doc.contents) ? doc.contents.items : []) {
    if (isSeq(item.value) || isMap(item.value)) {
      const top = String(isScalar(item.key) ? item.key.value : '');
      if (top === 'values' || top === 'sites' || top === 'defaults' || top === 'retrieval') item.value.flow = false;
    }
  }
  return doc.toString({ lineWidth: 0, flowCollectionPadding: true });
}

export function filePath(id: string): string {
  return `${DATA_DIR}/${id}.yaml`;
}

/** GitHub's web editor with a new file prefilled (forks automatically without write access). */
export function githubNewFileUrl(id: string, yaml: string): string {
  return `https://github.com/${REPO}/new/${BRANCH}?filename=${encodeURIComponent(filePath(id))}&value=${encodeURIComponent(yaml)}`;
}

/** GitHub's editor for an existing file (can't be prefilled; paste the copied YAML). */
export function githubEditFileUrl(id: string): string {
  return `https://github.com/${REPO}/edit/${BRANCH}/${filePath(id)}`;
}

/** "Maple Bear Sofia" -> "maple-bear-sofia". Non-Latin names need a manual id. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/**
 * Mark values changed in the editor as user edits: new provenance with today's date
 * and a fresh source_ref. Unchanged values keep their provenance.
 */
export function stampUserEdits(
  before: School | undefined,
  after: School,
  date: string,
  nonce: string = Date.now().toString(36),
): School {
  const values: School['values'] = {};
  let n = 0;
  for (const [dim, raw] of Object.entries(after.values)) {
    const old = before ? JSON.stringify(entriesOfRaw(before.values[dim]).map((e) => [e.v, e.scope ?? null])) : '';
    const list = entriesOfRaw(raw);
    const changed = old !== JSON.stringify(list.map((e) => [e.v, e.scope ?? null]));
    const mapped = list.map((e) => {
      if (!changed) return e;
      const prev = before && entriesOfRaw(before.values[dim]).find((p) => JSON.stringify(p) === JSON.stringify(e));
      if (prev) return e;
      n += 1;
      return { ...e, src: { kind: 'user-edit' as const, source_ref: `src-u${nonce}-${n}`, date } };
    });
    values[dim] = Array.isArray(raw) ? mapped : mapped[0];
  }
  return { ...after, values };
}

const entriesOfRaw = (v: Entry | Entry[] | undefined): Entry[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
