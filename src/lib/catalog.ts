// Catalog types and helpers shared by the build scripts, the app and the tests.
// Pure: no DOM and no file access.

export const VALUE_TYPES = [
  'bool', 'int', 'number', 'text', 'text_list', 'url', 'date', 'date_list', 'enum', 'multi_enum',
  'range', 'time_range', 'money', 'fee_item', 'rating', 'offering', 'service', 'link',
] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

export const SCOPE_KEYS = ['year', 'grade', 'site'] as const;
export type ScopeKey = (typeof SCOPE_KEYS)[number];

export const SOURCE_KINDS = ['visit', 'call', 'manual', 'user-edit', 'extracted', 'imported', 'derived'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Reasons a value is flagged. `manual` = needs a phone call or visit to confirm. */
export const CHECK_FLAGS = ['manual', 'conflict', 'unconfirmed', 'stale'] as const;
export type CheckFlag = (typeof CHECK_FLAGS)[number];

/** Enums used inside structured value types (labels: enum.<set>.<value>). */
export const BUILTIN_SETS = {
  currency: ['EUR', 'BGN'],
  per: ['month', 'year', 'once'],
  location: ['on_site', 'off_site', 'both'],
} as const;

export type Cadence = 'once' | 'yearly' | 'each_term' | 'monthly';

export interface Retrieval {
  methods?: string[];
  cadence?: Cadence;
  automatable?: boolean;
  steps?: string[];
  note?: string;
}

export interface Dimension {
  id: string;
  group: string;
  type: ValueType;
  values?: string;
  unit?: string;
  scopable?: ScopeKey[];
  filter?: boolean;
  retrieval?: Retrieval;
}

export interface Family {
  prefix: string;
  group: string;
  type: ValueType;
  members: string[];
  scopable?: ScopeKey[];
  retrieval?: Retrieval;
}

export interface RawCatalog {
  groups: string[];
  default_context: { year: string; grade: string };
  retrieval_methods: Record<string, { automatable: boolean; steps: string[] }>;
  value_sets: Record<string, string[]>;
  families: Family[];
  dimensions: Dimension[];
}

export interface Grade {
  id: string;
  age?: number;
  age_min?: number;
  age_max?: number;
}

export interface Neighborhood {
  id: string;
  district?: string;
}

export interface Catalog {
  groups: string[];
  defaultContext: { year: string; grade: string };
  methods: RawCatalog['retrieval_methods'];
  valueSets: Record<string, readonly string[]>;
  dimensions: Dimension[];
  byId: Map<string, Dimension>;
  grades: Grade[];
  neighborhoods: Neighborhood[];
}

/** Expand families into dimensions and index everything. */
export function buildCatalog(raw: RawCatalog, grades: Grade[], neighborhoods: Neighborhood[]): Catalog {
  const dimensions: Dimension[] = [];
  for (const f of raw.families) {
    for (const m of f.members) {
      dimensions.push({
        id: `${f.prefix}.${m}`,
        group: f.group,
        type: f.type,
        ...(f.scopable ? { scopable: f.scopable } : {}),
        ...(f.retrieval ? { retrieval: f.retrieval } : {}),
      });
    }
  }
  dimensions.push(...raw.dimensions);
  // Keep the catalog order within each group, groups in declared order.
  dimensions.sort((a, b) => raw.groups.indexOf(a.group) - raw.groups.indexOf(b.group));
  return {
    groups: raw.groups,
    defaultContext: raw.default_context,
    methods: raw.retrieval_methods,
    valueSets: { ...raw.value_sets, ...BUILTIN_SETS },
    dimensions,
    byId: new Map(dimensions.map((d) => [d.id, d])),
    grades,
    neighborhoods,
  };
}

/** Problems inside the catalog itself (the JSON Schema checks the shape). */
export function checkCatalog(raw: RawCatalog, cat: Catalog): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const d of cat.dimensions) {
    if (seen.has(d.id)) errors.push(`catalog: duplicate dimension id "${d.id}"`);
    seen.add(d.id);
    if (!raw.groups.includes(d.group)) errors.push(`catalog: ${d.id}: unknown group "${d.group}"`);
    const needsSet = d.type === 'enum' || d.type === 'multi_enum';
    if (needsSet && !(d.values && raw.value_sets[d.values])) errors.push(`catalog: ${d.id}: needs a known value set`);
    if (!needsSet && d.values) errors.push(`catalog: ${d.id}: "values" only applies to enum types`);
    for (const m of d.retrieval?.methods ?? []) {
      if (!raw.retrieval_methods[m]) errors.push(`catalog: ${d.id}: unknown retrieval method "${m}"`);
    }
    if (!d.retrieval?.steps?.length) errors.push(`catalog: ${d.id}: retrieval steps are required`);
  }
  if (!cat.grades.some((g) => g.id === raw.default_context.grade)) errors.push('catalog: default_context.grade is not a known grade');
  return errors;
}

/**
 * Retrieval instructions for one dimension, with an optional per-school override.
 * The override's steps come first; `replace: true` drops the catalog steps.
 */
export function retrievalFor(
  cat: Catalog,
  dimId: string,
  override?: Retrieval & { replace?: boolean },
): { methods: { id: string; steps: string[] }[]; steps: string[]; cadence?: Cadence; automatable?: boolean; note?: string } {
  const base = cat.byId.get(dimId)?.retrieval ?? {};
  const methodsIds = override?.methods ?? base.methods ?? [];
  const steps = override?.replace ? (override.steps ?? []) : [...(override?.steps ?? []), ...(base.steps ?? [])];
  return {
    methods: methodsIds.map((id) => ({ id, steps: cat.methods[id]?.steps ?? [] })),
    steps,
    cadence: override?.cadence ?? base.cadence,
    automatable: override?.automatable ?? base.automatable,
    note: override?.note ?? base.note,
  };
}

/** Every i18n key the catalog needs, so tests can require them in every dictionary. */
export function catalogLabelKeys(cat: Catalog): string[] {
  const keys = new Set<string>();
  for (const g of cat.groups) keys.add(`group.${g}`);
  for (const d of cat.dimensions) keys.add(`dim.${d.id}`);
  for (const [set, values] of Object.entries(cat.valueSets)) for (const v of values) keys.add(`enum.${set}.${v}`);
  for (const g of cat.grades) keys.add(`grade.${g.id}`);
  for (const n of cat.neighborhoods) keys.add(`neighborhood.${n.id}`);
  for (const k of SOURCE_KINDS) keys.add(`kind.${k}`);
  for (const c of CHECK_FLAGS) keys.add(`check.${c}`);
  for (const m of Object.keys(cat.methods)) keys.add(`method.${m}`);
  return [...keys];
}
