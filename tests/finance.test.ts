// The TypeScript finance port must give the same numbers as the reference calculator
// (scripts/pathways/finance-reference.py, output in tests/fixtures/finance-reference.json) for the defaults.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadFinance, loadPathways } from '../scripts/pathways/load.ts';
import { compute, pathYears, pyRound, SCENARIOS, type Config } from '../src/pathways/finance.ts';

const ref = JSON.parse(readFileSync(new URL('./fixtures/finance-reference.json', import.meta.url), 'utf8'));
const data = loadFinance();
const pathways = loadPathways();
const r = compute(data, data.defaults, pathways.paths);

describe('finance port matches the reference calculator (defaults)', () => {
  it('uses the stated defaults: EUR 1,000 per child, 2 kids, 9 months, second child +2 years', () => {
    expect(data.defaults).toMatchObject({ monthly_per_child: 1000, kids: 2, months_per_year: 9, child2_offset_years: 2, fee_growth: 0.05, scenario: 'base' });
  });
  it('return scenarios', () => {
    for (const [k, v] of Object.entries(ref.returns)) expect(r.returns[k as keyof typeof r.returns].rate).toBeCloseTo(v as number, 6);
  });
  it('invest: paid in, value at the end of each horizon and at university start', () => {
    r.invest.forEach((row, i) => {
      expect(row.paid).toBe(ref.invest[i].paid);
      for (const s of SCENARIOS) {
        expect(row.value_end[s]).toBe(ref.invest[i].value_end[s]);
        expect(row.value_at_uni[s]).toBe(ref.invest[i].value_at_uni[s]);
      }
    });
  });
  it('borrow: repaid, interest, peak instalment, debt-free year', () => {
    r.borrow.forEach((row, i) => {
      const b = ref.borrow[i];
      expect([pyRound(row.borrowed), pyRound(row.repaid), pyRound(row.interest), pyRound(row.peak_monthly), row.debt_free_after_years]).toEqual([b.borrowed, b.repaid, b.interest, b.peak_monthly_instalment, b.debt_free_after_years]);
    });
  });
  it('every path in data/pathways/paths.yaml has the reference totals', () => {
    expect(r.paths.map((p) => p.id).sort()).toEqual(Object.keys(ref.paths).sort());
    for (const p of r.paths) {
      const { cost, budget, over_budget_kid_years, max_shortfall, net_surplus_at_uni } = p;
      expect({ cost, budget, over_budget_kid_years, max_shortfall, net_surplus_at_uni }).toEqual(ref.paths[p.id]);
    }
  });
  it('university cost per year now and for a 4-year degree from 2040', () => {
    expect(r.uniYear).toBe(2040);
    for (const u of r.universities) expect([u.per_year_min, u.per_year_max, u.degree_min, u.degree_max]).toEqual(ref.universities[u.id]);
  });
  it('apartment comparison (c3)', () => {
    expect({ principal: r.apartment.principal, sqm: r.apartment.sqm, wage_months_13y: r.apartment.wage_months_13y }).toEqual(ref.apartment);
  });
});

describe('finance inputs', () => {
  it('12 months a year pays in more and grows more', () => {
    const r12 = compute(data, { ...data.defaults, months_per_year: 12 }, pathways.paths);
    expect(r12.invest[2].paid).toBe(156000);
    expect(r12.invest[2].value_at_uni.base).toBeGreaterThan(r.invest[2].value_at_uni.base);
  });
  it('the second-child offset moves the second child’s years', () => {
    const c = { ...data.fixed, ...data.defaults, child2_offset_years: 4 } as Config;
    const rows = pathYears(c, pathways.paths.find((p) => p.id === 'state-acs')!);
    expect(rows.find((x) => x.kid === 2 && x.grade === 0)!.year).toBe(2031);
  });
  it('one child halves the family budget', () => {
    const r1 = compute(data, { ...data.defaults, kids: 1 }, pathways.paths);
    expect(r1.paths[0].budget).toBe(117000);
  });
  it('pyRound rounds half to even like Python', () => {
    expect([pyRound(0.5), pyRound(1.5), pyRound(2.5), pyRound(-0.5), pyRound(2.4)]).toEqual([0, 2, 2, -0, 2]);
  });
});
