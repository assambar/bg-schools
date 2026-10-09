// Finance layer: the same logic as scripts/pathways/finance-reference.py, ported for the browser.
// Pure functions; the Finance page recomputes them when an input changes, and the build
// script precomputes the defaults and the diagrams. Not financial advice.
import type { Path } from './pathways.ts';

export const SCENARIOS = ['pessimistic', 'cautious', 'base', 'optimistic'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface Inputs {
  monthly_per_child: number;
  kids: number;
  months_per_year: number;
  child2_offset_years: number;
  fee_growth: number;
  scenario: Scenario;
}

export interface Fixed {
  start_year: number;
  fee_base_year: number;
  horizons: number[];
  uni_start_after_years: number;
  degree_years: number;
  contribution_growth: number;
  uni_cost_growth: number;
  eur_inflation: number;
  ter: number;
  capital_gains_tax: number;
  loan_apr: number;
  loan_term_years: number;
  mortgage_apr: number;
  mortgage_term_years: number;
  sofia_eur_per_m2: number;
  rent_yield_gross: [number, number];
  avg_gross_wage_eur: number;
  tutoring_per_year: number;
  fx: Record<string, number>;
}

export interface UniCost {
  id: string;
  tuition: [number, number, string];
  living?: [number, number, string];
}

export interface FinanceData {
  defaults: Inputs;
  fixed: Fixed;
  universities: UniCost[];
  sources: Record<string, { url: string; note: string }>;
  /** S&P 500 total return in USD by year. */
  sp500: [number, number][];
}

export type Config = Inputs & Fixed;

/** Python's round(): half to even, so results match the reference calculator exactly. */
export function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function kidOffsets(c: Config): number[] {
  const out = [0];
  while (out.length < c.kids) out.push(c.child2_offset_years);
  return out;
}

// ---- returns -------------------------------------------------------------------------------

function cagr(r: Map<number, number>, a: number, b: number): number {
  let p = 1;
  for (let y = a; y <= b; y++) p *= 1 + r.get(y)!;
  return p ** (1 / (b - a + 1)) - 1;
}

export interface ReturnScenario { rate: number; basis: string }

/** Pessimistic / optimistic = 10th / 90th percentile of rolling CAGRs; base = whole history. */
export function returnScenarios(sp500: [number, number][], window = 13): Record<Scenario | 'worst_window', ReturnScenario> {
  const r = new Map(sp500);
  const ys = [...r.keys()].sort((a, b) => a - b);
  const first = ys[0];
  const last = ys[ys.length - 1];
  const w = ys.filter((s) => s + window - 1 <= last).map((s) => cagr(r, s, s + window - 1)).sort((a, b) => a - b);
  const q = (p: number) => w[Math.trunc(p * (w.length - 1))];
  return {
    pessimistic: { rate: q(0.1), basis: `p10 of ${w.length} rolling ${window}-year periods ${first}-${last}` },
    cautious: { rate: cagr(r, 2000, last), basis: `2000-${last}` },
    base: { rate: cagr(r, first, last), basis: `${first}-${last}` },
    optimistic: { rate: q(0.9), basis: `p90 of ${w.length} rolling ${window}-year periods ${first}-${last}` },
    worst_window: { rate: w[0], basis: `worst rolling ${window}-year period` },
  };
}

// ---- invest and borrow, per child ----------------------------------------------------------

function contributions(c: Config, years: number): [number, number][] {
  const out: [number, number][] = [];
  for (let t = 0; t < years; t++) {
    const amt = c.monthly_per_child * (1 + c.contribution_growth) ** t;
    for (let k = 0; k < c.months_per_year; k++) out.push([12 * t + k, amt]);
  }
  return out;
}

/** Paid in and value of the school-month contributions after `years`, optionally held longer. */
export function fvInvest(c: Config, years: number, annual: number, holdUntil?: number): { paid: number; value: number } {
  const net = (1 + annual) * (1 - c.ter) - 1;
  const mr = (1 + net) ** (1 / 12) - 1;
  const end = 12 * years;
  const contrib = contributions(c, years);
  let v = contrib.reduce((s, [mi, a]) => s + a * (1 + mr) ** (end - mi), 0);
  const paid = contrib.reduce((s, [, a]) => s + a, 0);
  if (holdUntil && holdUntil > years) v *= (1 + mr) ** (12 * (holdUntil - years));
  const gain = v - paid;
  return { paid, value: v - Math.max(gain, 0) * c.capital_gains_tax };
}

export const annuityPayment = (p: number, apr: number, years: number): number => {
  const i = apr / 12;
  return (p * i) / (1 - (1 + i) ** -(12 * years));
};

export interface Loan { borrowed: number; repaid: number; interest: number; peak_monthly: number; debt_free_after_years: number }

/** Each school year's amount borrowed in September as one consumer loan. */
export function loanScenario(c: Config, years: number): Loan {
  let principal = 0;
  let total = 0;
  let lastMonth = 0;
  const pay: number[] = [];
  for (let t = 0; t < years; t++) {
    const p = c.monthly_per_child * c.months_per_year * (1 + c.contribution_growth) ** t;
    pay.push(annuityPayment(p, c.loan_apr, c.loan_term_years));
    principal += p;
    total += pay[t] * 12 * c.loan_term_years;
    lastMonth = Math.max(lastMonth, 12 * t + 12 * c.loan_term_years);
  }
  let peak = 0;
  for (let m = 0; m < lastMonth; m++) {
    let s = 0;
    for (let t = 0; t < years; t++) if (12 * t <= m && m < 12 * t + 12 * c.loan_term_years) s += pay[t];
    peak = Math.max(peak, s);
  }
  return { borrowed: principal, repaid: total, interest: total - principal, peak_monthly: peak, debt_free_after_years: lastMonth / 12 };
}

// ---- paths -----------------------------------------------------------------------------------

export function feeSchedule(path: Path): { fees: number[]; tutoring: boolean[] } {
  const fees = Array<number>(13).fill(0);
  const tutoring = Array<boolean>(13).fill(false);
  for (const f of path.cost.fees) for (let g = f.grades[0]; g <= f.grades[1]; g++) fees[g] = f.eur;
  for (const [a, b] of path.cost.tutoring ?? []) for (let g = a; g <= b; g++) tutoring[g] = true;
  return { fees, tutoring };
}

export interface PathYear { kid: number; grade: number; year: number; fee: number; extras: number; once: number; total: number; budget: number; leftover: number }

/** Per child and school year: fee (grown from 2026/27 prices), tutoring, one-off fees, budget. */
export function pathYears(c: Config, path: Path): PathYear[] {
  const { fees, tutoring } = feeSchedule(path);
  const offsets = kidOffsets(c);
  const sib = path.cost.sibling_discount ?? 0;
  const budgetY = c.monthly_per_child * c.months_per_year;
  const rows: PathYear[] = [];
  for (let kid = 0; kid < c.kids; kid++) {
    for (let gi = 0; gi < 13; gi++) {
      const year = c.start_year + offsets[kid] + gi;
      const esc = (1 + c.fee_growth) ** (year - c.fee_base_year);
      let fee = fees[gi] * esc;
      if (kid > 0 && sib && fee > 0) {
        const og = year - c.start_year - offsets[0];
        if (og >= 0 && og < 13 && fees[og] > 0) fee *= 1 - sib;
      }
      const extra = (tutoring[gi] ? c.tutoring_per_year : 0) * esc;
      const once = gi === 0 ? (path.cost.once ?? 0) * esc : 0;
      const budget = budgetY * (1 + c.contribution_growth) ** gi;
      rows.push({
        kid: kid + 1, grade: gi, year,
        fee: pyRound(fee), extras: pyRound(extra), once: pyRound(once),
        total: pyRound(fee + extra + once), budget: pyRound(budget), leftover: pyRound(budget - fee - extra - once),
      });
    }
  }
  return rows;
}

export interface PathSummary { id: string; cost: number; budget: number; over_budget_kid_years: number; max_shortfall: number; net_surplus_at_uni: number; fees: number; tutoring: number }

/** Family totals over 13 school years; the yearly surplus (or shortfall) invested at `annual`. */
export function pathSummary(c: Config, path: Path, annual: number): PathSummary {
  const rows = pathYears(c, path);
  const offsets = kidOffsets(c);
  const net = (1 + annual) * (1 - c.ter) - 1;
  let fv = 0;
  for (const r of rows) {
    const off = offsets[r.kid - 1];
    const yrs = c.start_year + off + c.uni_start_after_years - (c.start_year + off + r.grade) - 0.5;
    fv += r.leftover * (1 + net) ** yrs;
  }
  return {
    id: path.id,
    cost: rows.reduce((s, r) => s + r.total, 0),
    budget: rows.reduce((s, r) => s + r.budget, 0),
    over_budget_kid_years: rows.filter((r) => r.leftover < 0).length,
    max_shortfall: Math.min(0, ...rows.map((r) => r.leftover)),
    net_surplus_at_uni: pyRound(fv),
    fees: rows.reduce((s, r) => s + r.fee + r.once, 0),
    tutoring: rows.reduce((s, r) => s + r.extras, 0),
  };
}

// ---- universities ------------------------------------------------------------------------------

export interface UniRow { id: string; per_year_min: number; per_year_max: number; living_included: boolean; degree_min: number; degree_max: number }

const toEur = (c: Config, amt: number, cur: string) => (cur === 'EUR' ? amt : amt / c.fx[cur]);

/** Cost per year now (EUR) and of a whole degree starting in `uniYear`, grown by uni_cost_growth. */
export function uniTable(c: Config, unis: UniCost[], uniYear: number): UniRow[] {
  const esc = (1 + c.uni_cost_growth) ** (uniYear - c.fee_base_year);
  return unis.map((u) => {
    const lmin = u.living ? toEur(c, u.living[0], u.living[2]) : 0;
    const lmax = u.living ? toEur(c, u.living[1], u.living[2]) : 0;
    const tmin = toEur(c, u.tuition[0], u.tuition[2]);
    const tmax = toEur(c, u.tuition[1], u.tuition[2]);
    let dmin = 0;
    let dmax = 0;
    for (let k = 0; k < c.degree_years; k++) {
      dmin += (tmin + lmin) * esc * (1 + c.uni_cost_growth) ** k;
      dmax += (tmax + lmax) * esc * (1 + c.uni_cost_growth) ** k;
    }
    return { id: u.id, per_year_min: pyRound(tmin + lmin), per_year_max: pyRound(tmax + lmax), living_included: !!u.living, degree_min: pyRound(dmin), degree_max: pyRound(dmax) };
  });
}

// ---- everything for one set of inputs ------------------------------------------------------------

export interface Results {
  config: Config;
  returns: Record<Scenario | 'worst_window', ReturnScenario>;
  uniYear: number;
  invest: { years: number; paid: number; value_end: Record<Scenario, number>; value_at_uni: Record<Scenario, number>; value_at_uni_real: number }[];
  borrow: ({ years: number } & Loan)[];
  paths: PathSummary[];
  universities: UniRow[];
  /** c2: degree-years one child's 13-year fund pays for, by scenario. */
  uniFund: { id: string; cost_per_year_at_start: number; years: Record<Scenario, number> }[];
  /** c3: the family's yearly amount as a mortgage instalment, and in wage-months. */
  apartment: { family_per_year: number; monthly_instalment: number; principal: number; sqm: number; rent_per_year: [number, number]; wage_months_13y: number; share_of_avg_wage: number };
}

export function compute(data: FinanceData, inputs: Inputs, paths: Path[]): Results {
  const c: Config = { ...data.fixed, ...inputs };
  const returns = returnScenarios(data.sp500);
  const U = c.uni_start_after_years;
  const uniYear = c.start_year + U;
  const invest = c.horizons.map((years) => {
    const value_end = {} as Record<Scenario, number>;
    const value_at_uni = {} as Record<Scenario, number>;
    let paid = 0;
    for (const s of SCENARIOS) {
      const end = fvInvest(c, years, returns[s].rate);
      paid = end.paid;
      value_end[s] = pyRound(end.value);
      value_at_uni[s] = pyRound(fvInvest(c, years, returns[s].rate, U).value);
    }
    return { years, paid: pyRound(paid), value_end, value_at_uni, value_at_uni_real: pyRound(fvInvest(c, years, returns[c.scenario].rate, U).value / (1 + c.eur_inflation) ** U) };
  });
  const borrow = c.horizons.map((years) => ({ years, ...loanScenario(c, years) }));
  const annual = returns[c.scenario].rate;
  const universities = uniTable(c, data.universities, uniYear);
  const full = invest[invest.length - 1];
  const uniFund = universities.map((u) => {
    const perYear = ((u.per_year_min + u.per_year_max) / 2) * (1 + c.uni_cost_growth) ** (uniYear - c.fee_base_year);
    const years = {} as Record<Scenario, number>;
    for (const s of SCENARIOS) years[s] = pyRound((full.value_at_uni[s] / perYear) * 10) / 10;
    return { id: u.id, cost_per_year_at_start: pyRound(perYear), years };
  });
  const famYear = c.monthly_per_child * c.months_per_year * c.kids;
  const inst = famYear / 12;
  const i = c.mortgage_apr / 12;
  const n = 12 * c.mortgage_term_years;
  const principal = (inst * (1 - (1 + i) ** -n)) / i;
  return {
    config: c, returns, uniYear, invest, borrow, universities, uniFund,
    paths: paths.map((p) => pathSummary(c, p, annual)),
    apartment: {
      family_per_year: famYear, monthly_instalment: pyRound(inst), principal: pyRound(principal),
      sqm: pyRound((principal / c.sofia_eur_per_m2) * 10) / 10,
      rent_per_year: [pyRound(principal * c.rent_yield_gross[0]), pyRound(principal * c.rent_yield_gross[1])],
      wage_months_13y: pyRound((famYear * 13) / c.avg_gross_wage_eur),
      share_of_avg_wage: pyRound(((c.monthly_per_child * c.kids) / c.avg_gross_wage_eur) * 100) / 100,
    },
  };
}
