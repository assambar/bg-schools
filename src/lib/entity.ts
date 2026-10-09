// Entity file types (one YAML file per thing being compared) and pure helpers: value
// resolution, cross-file checks, YAML output. Generic: everything domain-specific comes
// from the Domain (config + catalog).
import { Document, isMap, isScalar, isSeq, visit } from 'yaml';
import { contextAxes, type CheckFlag, type Context, type Domain, type Retrieval, type SourceKind } from './domain.ts';

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

/** Named scope axes (domain config `scopes`), e.g. { year: 2027/2028, grade: [pg1, pg2] }. */
export type Scope = Record<string, string | string[]>;

export interface Entry {
  v: unknown;
  src?: Src;
  scope?: Scope;
  note?: string;
}

/** A location of an entity (only in domains with `locations`). `neighborhood` holds area ids. */
export interface Site {
  id: string;
  address?: string;
  neighborhood?: string | string[];
  geo?: [number, number];
  src?: Src;
}

export interface Entity {
  id: string;
  name: string;
  name_en?: string;
  sites?: Site[];
  defaults?: { src?: Src };
  values: Record<string, Entry | Entry[]>;
  retrieval?: Record<string, Retrieval & { replace?: boolean }>;
}

/** A money value (see schema-gen): an amount or a min–max range. */
export interface Money { amount?: number; min?: number; max?: number; currency: string; per: string; months?: number }

export const entriesOf = (s: Entity, dim: string): Entry[] => {
  const v = s.values[dim];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
};

/** A value's provenance with the file-level defaults applied. */
export const resolveSrc = (s: Entity, e: Entry): Src => ({ ...(s.defaults?.src ?? {}), ...(e.src ?? {}) });

const PRECEDENCE: SourceKind[] = ['visit', 'call', 'manual', 'user-edit', 'extracted', 'imported', 'derived'];

/**
 * How well an entry's scope fits the context, from each context axis's `fit` weights.
 * Unscoped = 1; matching every context axis: 1 + `exact` per named axis; otherwise
 * -3 + `fallback` / `fallback_unscoped` per axis that still matches (negative = "other").
 */
export function scopeFit(dom: Domain, scope: Scope | undefined, ctx: Context): number {
  if (!scope) return 1;
  let ok = true;
  let exact = 1;
  let fallback = -3;
  for (const a of contextAxes(dom)) {
    const v = scope[a.id];
    const named = v !== undefined;
    if (named && !([] as string[]).concat(v).includes(ctx[a.id])) { ok = false; continue; }
    fallback += named ? a.fit!.fallback : a.fit!.fallback_unscoped;
    if (named) exact += a.fit!.exact;
  }
  return ok ? exact : fallback;
}

export type Match = 'exact' | 'general' | 'other';

/**
 * The entry to show and filter on for a context: best scope fit first, then source
 * precedence (visit > call > manual > user-edit > extracted > imported > derived), then newest.
 * Entries for another context (e.g. another year) are only used when nothing else exists ("other").
 */
export function pickEntry(dom: Domain, s: Entity, dim: string, ctx: Context): { entry: Entry; src: Src; match: Match } | undefined {
  const ranked = entriesOf(s, dim)
    .map((entry) => ({ entry, src: resolveSrc(s, entry), fit: scopeFit(dom, entry.scope, ctx) }))
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
export function hasConflict(dom: Domain, s: Entity, dim: string, ctx: Context): boolean {
  const picked = pickEntry(dom, s, dim, ctx);
  if (!picked) return false;
  const key = JSON.stringify(picked.entry.scope ?? {});
  const same = entriesOf(s, dim).filter((e) => JSON.stringify(e.scope ?? {}) === key);
  return new Set(same.map((e) => JSON.stringify(e.v))).size > 1;
}

/** Area ids of all of an entity's sites. */
export function areasOf(s: Entity): string[] {
  return [...new Set((s.sites ?? []).flatMap((site) => (site.neighborhood === undefined ? [] : ([] as string[]).concat(site.neighborhood))))];
}

/** Cross-file rules the JSON Schema can't express. `refs` collects source_refs across files. */
export function checkEntity(s: Entity, dom: Domain, refs: Map<string, string> = new Map()): string[] {
  const errors: string[] = [];
  const siteIds = new Set<string>();
  for (const site of s.sites ?? []) {
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
    const dim = dom.byId.get(dimId);
    if (!dim) continue; // the schema already reports unknown dimensions
    const list = Array.isArray(raw) ? raw : [raw];
    list.forEach((e, i) => {
      const where = list.length > 1 ? `${dimId}[${i}]` : dimId;
      for (const axis of dom.config.scopes) {
        const v = e.scope?.[axis.id];
        if (v === undefined) continue;
        if (!(dim.scopable ?? []).includes(axis.id)) errors.push(`${where}: "${dimId}" can't be scoped by ${axis.id}`);
        for (const x of ([] as string[]).concat(v)) {
          if (axis.ref === 'sites' && !siteIds.has(x)) errors.push(`${where}: unknown site "${x}"`);
          if (axis.consecutive) {
            const [a, b] = x.split('/').map(Number);
            if (b !== a + 1) errors.push(`${where}: ${axis.id} must be consecutive years, e.g. 2027/2028`);
          }
        }
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
export function canonical(s: Entity, dom: Domain): Entity {
  const values: Entity['values'] = {};
  const known = dom.dimensions.map((d) => d.id).filter((id) => id in s.values);
  for (const id of [...known, ...Object.keys(s.values).filter((k) => !dom.byId.has(k))]) {
    const v = s.values[id];
    values[id] = Array.isArray(v) ? v.map(orderEntry) : orderEntry(v);
  }
  const out = ordered({ ...s, values } as unknown as Record<string, unknown>, TOP_ORDER) as unknown as Entity;
  if (out.defaults?.src) out.defaults = { src: ordered(out.defaults.src as Record<string, unknown>, SRC_ORDER) as Src };
  return out;
}

/** YAML text: maps and lists that hold only scalars are written inline (`{ a: 1 }`). */
export function toYaml(s: Entity, dom: Domain): string {
  const doc = new Document(canonical(s, dom));
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

export function filePath(dom: Domain, id: string): string {
  return `${dom.config.paths.entities}/${id}.yaml`;
}

/** GitHub's web editor with a new file prefilled (forks automatically without write access). */
export function githubNewFileUrl(dom: Domain, id: string, yaml: string): string | undefined {
  const r = dom.config.repo;
  return r && `https://github.com/${r.name}/new/${r.branch}?filename=${encodeURIComponent(filePath(dom, id))}&value=${encodeURIComponent(yaml)}`;
}

/** GitHub's editor for an existing file (can't be prefilled; paste the copied YAML). */
export function githubEditFileUrl(dom: Domain, id: string): string | undefined {
  const r = dom.config.repo;
  return r && `https://github.com/${r.name}/edit/${r.branch}/${filePath(dom, id)}`;
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
  before: Entity | undefined,
  after: Entity,
  date: string,
  nonce: string = Date.now().toString(36),
): Entity {
  const values: Entity['values'] = {};
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
