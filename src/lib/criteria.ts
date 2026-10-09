// Criteria sets (generic): hard rules (`require`) exclude an entity only when the value is
// known and fails; unknown values keep the entity but mark it "unverified". Soft rules (`prefer`)
// score it: score = weight of passed rules / weight of rules with a known value, and
// coverage = weight known / weight of all soft rules. Ranking uses score × coverage.
import { contextAxes, isRecordType, type Context, type Domain } from './domain.ts';
import { pickEntry, type Money, type Entity } from './entity.ts';

export interface Rule {
  dim?: string;
  is?: unknown;
  in?: unknown[];
  has?: string | string[];
  gte?: number | Money;
  lte?: number | Money;
  exists?: boolean;
  where?: Record<string, unknown>;
  covers?: 'context';
  neighborhood?: { in: string[]; editable?: boolean };
  within_km?: { km: number };
  weight?: number;
}

export interface CriteriaSet {
  id: string;
  /** One of the domain config's `criteria.kinds`. */
  kind: string;
  require?: Rule[];
  prefer?: Rule[];
}

export type Outcome = 'pass' | 'fail' | 'unknown';
export interface RuleResult {
  rule: Rule;
  hard: boolean;
  weight: number;
  outcome: Outcome;
  /** Known, but from an unverified, flagged or other-year/grade entry. */
  unverified: boolean;
  reason?: 'missing' | 'range' | 'no_coordinates' | 'no_area';
}
export interface EntityResult {
  entity: Entity;
  excluded: boolean;
  /** A hard rule is unknown or rests on an unverified value. */
  unverified: boolean;
  score: number | null;
  coverage: number;
  results: RuleResult[];
}
export interface EvalOptions {
  ctx: Context;
  /** The user's neighbourhood list (stored in the browser), used by editable neighbourhood rules. */
  near?: string[];
  /** The user's chosen point [lat, lon], used by within_km rules. */
  place?: [number, number];
}

/**
 * Annual amount in the domain's base currency as a range (monthly × months, default 12;
 * other currencies at the fixed `money.rates`, units per 1 base).
 */
export function annualBase(dom: Domain, m: Money): { min: number; max: number } {
  const factor = m.per === 'month' ? (m.months ?? 12) : 1;
  const rate = 1 / (dom.config.money?.rates?.[m.currency] ?? 1);
  const lo = m.amount ?? m.min!;
  const hi = m.amount ?? m.max!;
  return { min: lo * factor * rate, max: hi * factor * rate };
}

const isMoney = (x: unknown): x is Money => typeof x === 'object' && x !== null && 'currency' in x && 'per' in x;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const combine = (outcomes: Outcome[]): Outcome => (outcomes.includes('fail') ? 'fail' : outcomes.includes('unknown') ? 'unknown' : 'pass');

function compare(dom: Domain, v: unknown, bound: number | Money, op: 'lte' | 'gte'): { outcome: Outcome; reason?: 'range' } {
  let lo: number, hi: number, b: number;
  if (isMoney(bound)) {
    if (!isMoney(v)) return { outcome: 'unknown' };
    ({ min: lo, max: hi } = annualBase(dom, v));
    b = annualBase(dom, bound).max;
  } else {
    if (typeof v !== 'number') return { outcome: 'unknown' };
    lo = hi = v;
    b = bound;
  }
  const eps = 0.005;
  if (op === 'lte') return hi <= b + eps ? { outcome: 'pass' } : lo > b + eps ? { outcome: 'fail' } : { outcome: 'unknown', reason: 'range' };
  return lo >= b - eps ? { outcome: 'pass' } : hi < b - eps ? { outcome: 'fail' } : { outcome: 'unknown', reason: 'range' };
}

/** The context's measure (e.g. age) from the context axis that declares `measure`. */
function contextMeasure(dom: Domain, ctx: Context): number | undefined {
  const axis = contextAxes(dom).find((a) => a.measure);
  if (!axis) return undefined;
  const item = dom.scopeValues[axis.id]?.find((x) => x.id === ctx[axis.id]);
  const m = item?.[axis.measure!] ?? item?.[`${axis.measure}_min`];
  return typeof m === 'number' ? m : undefined;
}

function km(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

/** Evaluates one rule; null when the rule doesn't apply (an empty editable neighbourhood list). */
export function evalRule(s: Entity, rule: Rule, dom: Domain, opts: EvalOptions, hard: boolean): RuleResult | null {
  const base = { rule, hard, weight: rule.weight ?? 1 };
  if (rule.neighborhood) {
    const list = rule.neighborhood.editable && opts.near ? opts.near : rule.neighborhood.in;
    if (list.length === 0) return null;
    const sites = (s.sites ?? []).filter((x) => x.neighborhood !== undefined);
    if (sites.length === 0) return { ...base, outcome: 'unknown', unverified: false, reason: 'no_area' };
    const matching = sites.filter((x) => ([] as string[]).concat(x.neighborhood!).some((n) => list.includes(n)));
    return { ...base, outcome: matching.length ? 'pass' : 'fail', unverified: matching.length > 0 && matching.every((x) => x.src?.verified !== true) };
  }
  if (rule.within_km) {
    const geos = (s.sites ?? []).flatMap((x) => (x.geo ? [x.geo] : []));
    if (!opts.place || geos.length === 0) return { ...base, outcome: 'unknown', unverified: false, reason: 'no_coordinates' };
    return { ...base, outcome: geos.some((g) => km(g, opts.place!) <= rule.within_km!.km) ? 'pass' : 'fail', unverified: false };
  }
  const picked = pickEntry(dom, s, rule.dim!, opts.ctx);
  if (!picked) return { ...base, outcome: 'unknown', unverified: false, reason: 'missing' };
  const v = picked.entry.v;
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const outcomes: Outcome[] = [];
  let reason: RuleResult['reason'];
  if (rule.exists !== undefined) {
    const presence = dom.records[dom.byId.get(rule.dim!)?.type ?? '']?.presence;
    const present = !(v === false || (presence !== undefined && o[presence] === false));
    outcomes.push(present === rule.exists ? 'pass' : 'fail');
  }
  if (rule.is !== undefined) outcomes.push(same(v, rule.is) ? 'pass' : 'fail');
  if (rule.in) outcomes.push(rule.in.some((x) => same(x, v)) ? 'pass' : 'fail');
  if (rule.has !== undefined) {
    const want = ([] as string[]).concat(rule.has);
    outcomes.push(Array.isArray(v) && want.some((x) => (v as unknown[]).includes(x)) ? 'pass' : 'fail');
  }
  if (rule.where) {
    for (const [k, want] of Object.entries(rule.where)) outcomes.push(o[k] === undefined ? 'unknown' : same(o[k], want) ? 'pass' : 'fail');
  }
  for (const op of ['lte', 'gte'] as const) {
    if (rule[op] === undefined) continue;
    const r = compare(dom, v, rule[op]!, op);
    outcomes.push(r.outcome);
    reason ??= r.reason;
  }
  if (rule.covers === 'context') {
    const age = contextMeasure(dom, opts.ctx);
    outcomes.push(age === undefined ? 'unknown' : (o.min as number) <= age && age <= (o.max as number) ? 'pass' : 'fail');
  }
  const outcome = combine(outcomes);
  const unverified = picked.src.verified !== true || picked.src.check !== undefined || picked.match === 'other';
  return { ...base, outcome, unverified, ...(reason && outcome === 'unknown' ? { reason } : {}) };
}

export function evaluate(s: Entity, sets: readonly CriteriaSet[], dom: Domain, opts: EvalOptions): EntityResult {
  const results: RuleResult[] = [];
  for (const set of sets) {
    for (const r of set.require ?? []) { const x = evalRule(s, r, dom, opts, true); if (x) results.push(x); }
    for (const r of set.prefer ?? []) { const x = evalRule(s, r, dom, opts, false); if (x) results.push(x); }
  }
  const hard = results.filter((r) => r.hard);
  const soft = results.filter((r) => !r.hard);
  const total = soft.reduce((n, r) => n + r.weight, 0);
  const known = soft.filter((r) => r.outcome !== 'unknown').reduce((n, r) => n + r.weight, 0);
  const passed = soft.filter((r) => r.outcome === 'pass').reduce((n, r) => n + r.weight, 0);
  return {
    entity: s,
    excluded: hard.some((r) => r.outcome === 'fail'),
    unverified: hard.some((r) => r.outcome === 'unknown' || r.unverified),
    score: known > 0 ? passed / known : null,
    coverage: total > 0 ? known / total : 1,
    results,
  };
}

/**
 * Ranked: kept entities first (fully confirmed before unverified), then by points earned out of
 * all soft-rule points (score × coverage, so unknown counts as 0), then score, then name.
 */
export function rank(entities: readonly Entity[], sets: readonly CriteriaSet[], dom: Domain, opts: EvalOptions): EntityResult[] {
  return entities
    .map((s) => evaluate(s, sets, dom, opts))
    .sort(
      (a, b) =>
        Number(a.excluded) - Number(b.excluded) ||
        Number(a.unverified) - Number(b.unverified) ||
        (b.score ?? 0) * b.coverage - (a.score ?? 0) * a.coverage ||
        (b.score ?? -1) - (a.score ?? -1) ||
        a.entity.name.localeCompare(b.entity.name, dom.config.display.sort_locale),
    );
}

/** Problems that make a criteria set meaningless against this catalog. */
export function checkCriteria(set: CriteriaSet, dom: Domain): string[] {
  const errors: string[] = [];
  const all = [...(set.require ?? []).map((r) => [r, 'require'] as const), ...(set.prefer ?? []).map((r) => [r, 'prefer'] as const)];
  all.forEach(([r, where], i) => {
    const at = `${where}[${i}]`;
    if (r.neighborhood) {
      for (const n of r.neighborhood.in) if (!dom.areas.some((x) => x.id === n)) errors.push(`${at}: unknown neighbourhood "${n}"`);
      return;
    }
    if (r.within_km) return;
    const d = dom.byId.get(r.dim ?? '');
    if (!d) { errors.push(`${at}: unknown dimension "${r.dim}"`); return; }
    if ((r.lte !== undefined || r.gte !== undefined) && !['int', 'number', 'money'].includes(d.type)) errors.push(`${at}: ${d.id}: lte/gte need a number or money dimension`);
    for (const op of ['lte', 'gte'] as const) if (r[op] !== undefined && (d.type === 'money') !== isMoney(r[op])) errors.push(`${at}: ${d.id}: ${op} must be ${d.type === 'money' ? 'money' : 'a number'}`);
    if (r.covers && d.type !== 'range') errors.push(`${at}: ${d.id}: covers needs a range dimension`);
    if (r.where && !(isRecordType(d) || d.type === 'range' || d.type === 'money')) errors.push(`${at}: ${d.id}: where needs an object value type`);
    if (r.has !== undefined && !['multi_enum', 'text_list'].includes(d.type)) errors.push(`${at}: ${d.id}: has needs a list dimension`);
    const enumVals = d.values ? dom.valueSets[d.values] : undefined;
    for (const x of [...([] as unknown[]).concat(r.has ?? []), ...(r.in ?? []), ...(r.is !== undefined && d.type === 'enum' ? [r.is] : [])]) {
      if (enumVals && !enumVals.includes(String(x))) errors.push(`${at}: ${d.id}: "${x}" is not in ${d.values}`);
    }
  });
  return errors;
}
