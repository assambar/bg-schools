// The generic model: a domain config (domains/<name>/domain.yaml) plus its dimension
// catalog. Shared by the build scripts, the app and the tests. Pure: no DOM, no file access.
// Nothing here is specific to one domain; school-specific names live in domains/schools/
// and the data it points to.

/** Generic value types. A dimension's `type` is one of these or a record name from the catalog. */
export const BASE_TYPES = [
  'bool', 'int', 'number', 'text', 'text_list', 'url', 'date', 'date_list', 'enum', 'multi_enum',
  'range', 'time_range', 'money',
] as const;
export type BaseType = (typeof BASE_TYPES)[number];

export const SOURCE_KINDS = ['visit', 'call', 'manual', 'user-edit', 'extracted', 'imported', 'derived'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Reasons a value is flagged. `manual` = needs a phone call or visit to confirm. */
export const CHECK_FLAGS = ['manual', 'conflict', 'unconfirmed', 'stale'] as const;
export type CheckFlag = (typeof CHECK_FLAGS)[number];

/** Billing periods of a money value (labels: enum.per.<value>). */
export const PERIODS = ['month', 'year', 'once'] as const;

export const CADENCES = ['once', 'yearly', 'each_term', 'monthly'] as const;
export type Cadence = (typeof CADENCES)[number];

// ---- domain config (domain.yaml) ---------------------------------------------------------

export interface ScopeAxis {
  id: string;
  /** Free values matching this pattern (e.g. a school year). */
  pattern?: string;
  /** For `YYYY/YYYY` patterns: the second year must follow the first. */
  consecutive?: boolean;
  /** Fixed values (ids), inline. */
  values?: string[];
  /** Values from a YAML file: `path/file.yaml#key.path`, items `{ id, ... }`. */
  values_from?: string;
  /** The value may be a list. */
  list?: boolean;
  /** Numeric item field (or <measure>_min) that `covers: context` checks a range against. */
  measure?: string;
  /** Value must be one of the entity's own location ids. */
  ref?: 'sites';
  /** Shown in the header; picks the entry shown and filtered on. */
  context?: { default: string };
  fit?: { exact: number; fallback: number; fallback_unscoped: number };
}

export interface DomainConfig {
  id: string;
  entity: { route: string; id_pattern: string };
  paths: { catalog: string; overlays?: string; entities: string; criteria: string; i18n: string };
  scopes: ScopeAxis[];
  locations?: { areas_from: string; group_key?: string; area_label: string; group_label?: string };
  display: {
    title: string;
    subtitle?: string;
    sort_locale?: string;
    list_columns: { dim: string; label?: string }[];
    editor_fields?: string[];
    new_template: string;
  };
  money?: { currencies: string[]; base: string; rates?: Record<string, number> };
  criteria: {
    kinds: string[];
    default_selection: string[];
    controls: { kind: string; type: 'toggle' | 'select'; label?: string; none?: boolean }[];
  };
  repo?: { name: string; branch: string };
  storage_prefix: string;
  /** Personal status layer (see src/lib/status.ts). */
  status?: {
    /** Public fallback file used when no token is set. */
    default: string;
    /** Allowed per-entity statuses (labels: status.value.<value>). */
    values: string[];
    /** A personal `budget` becomes an extra criteria set of this kind on this money dimension. */
    budget?: { dim: string; kind: string };
  };
}

// ---- catalog (dimensions.yaml) ---------------------------------------------------------

export interface Retrieval {
  methods?: string[];
  cadence?: Cadence;
  automatable?: boolean;
  steps?: string[];
  note?: string;
}

export interface RecordField {
  type: 'bool' | 'int' | 'number' | 'text' | 'time_range' | 'enum' | 'money';
  values?: string;
  required?: boolean;
  min?: number;
  labels?: string[];
  format?: string;
  hidden?: boolean;
}

export interface RecordType {
  presence?: string;
  fields: Record<string, RecordField>;
}

export interface Dimension {
  id: string;
  group: string;
  /** A BaseType or a record name. */
  type: string;
  values?: string;
  unit?: string;
  scopable?: string[];
  filter?: boolean;
  retrieval?: Retrieval;
}

export interface Family {
  prefix: string;
  group: string;
  type: string;
  members: string[];
  scopable?: string[];
  retrieval?: Retrieval;
}

export interface RawCatalog {
  groups: string[];
  retrieval_methods: Record<string, { automatable: boolean; steps: string[] }>;
  value_sets: Record<string, string[]>;
  records?: Record<string, RecordType>;
  families?: Family[];
  dimensions: Dimension[];
}

export interface ScopeValue {
  id: string;
  [field: string]: unknown;
}

export interface Area {
  id: string;
  group?: string;
}

export type Context = Record<string, string>;

/** A loaded domain: config + catalog + resolved scope values and areas. */
export interface Domain {
  config: DomainConfig;
  groups: string[];
  methods: RawCatalog['retrieval_methods'];
  valueSets: Record<string, readonly string[]>;
  records: Record<string, RecordType>;
  dimensions: Dimension[];
  byId: Map<string, Dimension>;
  /** Scope values per axis that has fixed values (inline or from a file). */
  scopeValues: Record<string, ScopeValue[]>;
  /** Areas entity locations can be in (empty without `locations`). */
  areas: Area[];
  defaultContext: Context;
  editorFields: string[];
}

export interface DomainFiles {
  config: DomainConfig;
  catalog: RawCatalog;
  /** Resolved `values_from` per axis id. */
  scopeValues?: Record<string, ScopeValue[]>;
  /** Resolved `locations.areas_from`, with `group` taken from `group_key`. */
  areas?: Area[];
}

export const isRecordType = (d: Pick<Dimension, 'type'>): boolean => !(BASE_TYPES as readonly string[]).includes(d.type);
export const contextAxes = (dom: Domain): ScopeAxis[] => dom.config.scopes.filter((a) => a.context);

/** Expand families into dimensions and index everything. */
export function buildDomain(files: DomainFiles): Domain {
  const { config, catalog: raw } = files;
  const dimensions: Dimension[] = [];
  for (const f of raw.families ?? []) {
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
  const scopeValues: Record<string, ScopeValue[]> = { ...(files.scopeValues ?? {}) };
  for (const a of config.scopes) if (a.values) scopeValues[a.id] = a.values.map((id) => ({ id }));
  return {
    config,
    groups: raw.groups,
    methods: raw.retrieval_methods,
    valueSets: { ...raw.value_sets, per: PERIODS, ...(config.money ? { currency: config.money.currencies } : {}) },
    records: raw.records ?? {},
    dimensions,
    byId: new Map(dimensions.map((d) => [d.id, d])),
    scopeValues,
    areas: files.areas ?? [],
    defaultContext: Object.fromEntries(contextAxes({ config } as Domain).map((a) => [a.id, a.context!.default])),
    editorFields: config.display.editor_fields ?? [],
  };
}

/** Problems inside the config and catalog that the JSON Schemas can't express. */
export function checkDomain(dom: Domain): string[] {
  const errors: string[] = [];
  const { config } = dom;
  const seen = new Set<string>();
  const axes = new Set(config.scopes.map((a) => a.id));
  const usesMoney = (t: string) => t === 'money' || Object.values(dom.records[t]?.fields ?? {}).some((f) => f.type === 'money');
  for (const [name, rec] of Object.entries(dom.records)) {
    if ((BASE_TYPES as readonly string[]).includes(name)) errors.push(`catalog: record "${name}" has the name of a built-in type`);
    if (rec.presence && rec.fields[rec.presence]?.type !== 'bool') errors.push(`catalog: record ${name}: presence must name a bool field`);
    for (const [fname, f] of Object.entries(rec.fields)) {
      if (f.type === 'enum' && !(f.values && dom.valueSets[f.values])) errors.push(`catalog: record ${name}.${fname}: needs a known value set`);
    }
  }
  for (const d of dom.dimensions) {
    if (seen.has(d.id)) errors.push(`catalog: duplicate dimension id "${d.id}"`);
    seen.add(d.id);
    if (!dom.groups.includes(d.group)) errors.push(`catalog: ${d.id}: unknown group "${d.group}"`);
    if (isRecordType(d) && !dom.records[d.type]) errors.push(`catalog: ${d.id}: unknown type "${d.type}"`);
    if (usesMoney(d.type) && !config.money) errors.push(`catalog: ${d.id}: money values need \`money\` in the domain config`);
    const needsSet = d.type === 'enum' || d.type === 'multi_enum';
    if (needsSet && !(d.values && dom.valueSets[d.values])) errors.push(`catalog: ${d.id}: needs a known value set`);
    if (!needsSet && d.values) errors.push(`catalog: ${d.id}: "values" only applies to enum types`);
    for (const s of d.scopable ?? []) if (!axes.has(s)) errors.push(`catalog: ${d.id}: unknown scope axis "${s}"`);
    for (const m of d.retrieval?.methods ?? []) {
      if (!dom.methods[m]) errors.push(`catalog: ${d.id}: unknown retrieval method "${m}"`);
    }
    if (!d.retrieval?.steps?.length) errors.push(`catalog: ${d.id}: retrieval steps are required`);
  }
  for (const a of config.scopes) {
    const ways = [a.pattern, a.values ?? a.values_from, a.ref].filter((x) => x !== undefined).length;
    if (ways !== 1) errors.push(`domain: scope ${a.id}: give exactly one of pattern, values / values_from, ref`);
    if (a.ref === 'sites' && !config.locations) errors.push(`domain: scope ${a.id}: ref sites needs \`locations\``);
    if (a.context) {
      const vals = dom.scopeValues[a.id];
      if (vals && !vals.some((v) => v.id === a.context!.default)) errors.push(`domain: scope ${a.id}: context default "${a.context.default}" is not a known value`);
      if (a.pattern && !new RegExp(a.pattern).test(a.context.default)) errors.push(`domain: scope ${a.id}: context default does not match the pattern`);
      if (!a.fit) errors.push(`domain: scope ${a.id}: context axes need \`fit\``);
    }
  }
  for (const id of dom.editorFields) {
    const d = dom.byId.get(id);
    if (!d) errors.push(`domain: editor_fields: unknown dimension "${id}"`);
    else if (!['enum', 'multi_enum', 'bool'].includes(d.type)) errors.push(`domain: editor_fields: ${id} must be enum, multi_enum or bool`);
  }
  for (const c of config.display.list_columns) if (!dom.byId.has(c.dim)) errors.push(`domain: list_columns: unknown dimension "${c.dim}"`);
  for (const c of config.criteria.controls) if (!config.criteria.kinds.includes(c.kind)) errors.push(`domain: criteria control: unknown kind "${c.kind}"`);
  const st = config.status;
  if (st?.budget) {
    if (dom.byId.get(st.budget.dim)?.type !== 'money') errors.push(`domain: status.budget.dim must be a money dimension`);
    if (!config.criteria.kinds.includes(st.budget.kind)) errors.push(`domain: status.budget.kind: unknown kind "${st.budget.kind}"`);
  }
  if (config.money && !config.money.currencies.includes(config.money.base)) errors.push('domain: money.base must be one of money.currencies');
  for (const cur of Object.keys(config.money?.rates ?? {})) if (!config.money!.currencies.includes(cur)) errors.push(`domain: money.rates: unknown currency "${cur}"`);
  return errors;
}

/**
 * Retrieval instructions for one dimension, with an optional per-entity override.
 * The override's steps come first; `replace: true` drops the catalog steps.
 */
export function retrievalFor(
  dom: Domain,
  dimId: string,
  override?: Retrieval & { replace?: boolean },
): { methods: { id: string; steps: string[] }[]; steps: string[]; cadence?: Cadence; automatable?: boolean; note?: string } {
  const base = dom.byId.get(dimId)?.retrieval ?? {};
  const methodsIds = override?.methods ?? base.methods ?? [];
  const steps = override?.replace ? (override.steps ?? []) : [...(override?.steps ?? []), ...(base.steps ?? [])];
  return {
    methods: methodsIds.map((id) => ({ id, steps: dom.methods[id]?.steps ?? [] })),
    steps,
    cadence: override?.cadence ?? base.cadence,
    automatable: override?.automatable ?? base.automatable,
    note: override?.note ?? base.note,
  };
}

/**
 * Extra retrieval instructions kept in a separate file with the catalog's own shape:
 * `retrieval_methods` (added) and `dimensions: { <id>: { methods, steps, note } }`
 * (methods merged, steps appended after the catalog's). Lets source-specific steps live in
 * their own file and be added or removed by adding or removing that file.
 */
export interface RetrievalOverlay {
  retrieval_methods?: RawCatalog['retrieval_methods'];
  dimensions?: Record<string, Pick<Retrieval, 'methods' | 'steps' | 'note'>>;
}

export function mergeRetrieval(dom: Domain, overlay: RetrievalOverlay, name = 'overlay'): string[] {
  const errors: string[] = [];
  Object.assign(dom.methods, overlay.retrieval_methods ?? {});
  for (const [id, extra] of Object.entries(overlay.dimensions ?? {})) {
    const d = dom.byId.get(id);
    if (!d) { errors.push(`${name}: unknown dimension "${id}"`); continue; }
    for (const m of extra.methods ?? []) if (!dom.methods[m]) errors.push(`${name}: ${id}: unknown retrieval method "${m}"`);
    const base = d.retrieval ?? {};
    // Family members share one retrieval object; copy before changing it.
    d.retrieval = {
      ...base,
      methods: [...new Set([...(base.methods ?? []), ...(extra.methods ?? [])])],
      steps: [...(base.steps ?? []), ...(extra.steps ?? [])],
      ...(extra.note ? { note: base.note ? `${base.note} ${extra.note}` : extra.note } : {}),
    };
  }
  return errors;
}

/** Every i18n key the domain needs, so tests can require them in every dictionary. */
export function domainLabelKeys(dom: Domain): string[] {
  const { config } = dom;
  // Strings that name the kind of entity are the domain's own.
  const keys = new Set<string>([
    'app.title', 'nav.list', 'nav.add', 'list.heading', 'list.hint', 'detail.back', 'detail.not_found',
    'detail.other_cycle', 'detail.entity_override', 'editor.title_new', 'criteria.col.entity', 'criteria.intro',
  ]);
  for (const g of dom.groups) keys.add(`group.${g}`);
  for (const d of dom.dimensions) {
    keys.add(`dim.${d.id}`);
  }
  for (const [set, values] of Object.entries(dom.valueSets)) for (const v of values) keys.add(`enum.${set}.${v}`);
  for (const rec of Object.values(dom.records)) {
    for (const f of Object.values(rec.fields)) {
      for (const l of f.labels ?? []) keys.add(l);
      if (f.format) keys.add(f.format);
    }
  }
  for (const a of config.scopes) {
    if (!dom.scopeValues[a.id]) keys.add(`scope.${a.id}`); // badge "<axis> <value>"
    if (a.context) keys.add(`context.${a.id}`);
    for (const v of dom.scopeValues[a.id] ?? []) keys.add(`${a.id}.${v.id}`);
  }
  if (contextAxes(dom).length) keys.add('context.label');
  if (contextAxes(dom).some((a) => a.measure)) keys.add('criteria.rule.covers');
  if (config.locations) {
    const loc = config.locations;
    for (const k of ['list.col.area', 'detail.sites', 'criteria.rule.near', 'criteria.reason.no_area', 'criteria.distance_note', 'criteria.places.clear', 'criteria.places.empty', 'criteria.places.heading', 'criteria.places.no_district', 'criteria.places.pick', 'criteria.places.stored', 'criteria.places.use']) keys.add(k);
    for (const n of dom.areas) {
      keys.add(`${loc.area_label}.${n.id}`);
      if (n.group && loc.group_label) keys.add(`${loc.group_label}.${n.group}`);
    }
  }
  for (const c of config.display.list_columns) if (c.label) keys.add(c.label);
  for (const c of config.criteria.controls) if (c.label) keys.add(c.label);
  for (const v of config.status?.values ?? []) keys.add(`status.value.${v}`);
  for (const k of SOURCE_KINDS) keys.add(`kind.${k}`);
  for (const m of Object.keys(dom.methods)) keys.add(`method.${m}`);
  return [...keys];
}
