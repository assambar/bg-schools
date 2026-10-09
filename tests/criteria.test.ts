import { describe, expect, it } from 'vitest';
import { checkCriteriaDir, checkCriteriaFiles, checkDataDir } from '../scripts/check-data.ts';
import { annualBase, evalRule, evaluate, rank, type CriteriaSet } from '../src/lib/criteria.ts';
import { dictionaries, LANGS } from '../src/lib/i18n.ts';
import type { Entity as School } from '../src/lib/entity.ts';
import { setup } from './helpers.ts';

const { dom: catalog } = setup();
const ctx = { year: '2027/2028', grade: 'pg2' };
const src = { kind: 'extracted' as const, url: 'https://example.org', date: '2026-10-08', verified: true };

const school = (values: School['values'], sites: School['sites'] = [{ id: 'main', neighborhood: 'izgrev', src: { source_ref: 'src-x', verified: true } }]): School => ({
  id: 't', name: 'T', sites, defaults: { src }, values,
});

describe('money', () => {
  it('compares per year in EUR', () => {
    expect(annualBase(catalog, { amount: 500, currency: 'EUR', per: 'month' })).toEqual({ min: 6000, max: 6000 });
    expect(annualBase(catalog, { amount: 780, currency: 'EUR', per: 'month', months: 11 }).max).toBe(8580);
    expect(annualBase(catalog, { amount: 1955.83, currency: 'BGN', per: 'year' }).max).toBeCloseTo(1000, 6);
    expect(annualBase(catalog, { min: 300, max: 600, currency: 'EUR', per: 'month' })).toEqual({ min: 3600, max: 7200 });
  });
});

describe('levels (several per school)', () => {
  it('"has" matches when the levels contain any wanted value; checkCriteria knows the value set', () => {
    const s = school({ levels: { v: ['kindergarten', 'preschool', 'primary'] } });
    const o = (r: object) => evalRule(s, r as never, catalog, { ctx }, true)!.outcome;
    expect(o({ dim: 'levels', has: 'preschool' })).toBe('pass');
    expect(o({ dim: 'levels', has: ['nursery', 'primary'] })).toBe('pass');
    expect(o({ dim: 'levels', has: 'upper_secondary' })).toBe('fail');
    expect(evalRule(school({}), { dim: 'levels', has: 'preschool' }, catalog, { ctx }, true)!.outcome).toBe('unknown');
    const set = (has: string): CriteriaSet => ({ id: 'x', kind: 'custom', require: [{ dim: 'levels', has }] });
    expect(checkCriteriaFiles([{ path: 'x.yaml', content: JSON.stringify(set('preschool')) }], catalog).errors).toEqual([]);
    expect(checkCriteriaFiles([{ path: 'x.yaml', content: JSON.stringify(set('combined')) }], catalog).errors.join()).toMatch(/"combined" is not in level/);
  });
});

describe('rules', () => {
  const cap = { amount: 6000, currency: 'EUR', per: 'year' };
  it('lte on money: pass, fail, and unknown when a range crosses the limit', () => {
    const r = (v: unknown) => evalRule(school({ tuition: { v } }), { dim: 'tuition', lte: cap }, catalog, { ctx }, true)!;
    expect(r({ amount: 450, currency: 'EUR', per: 'month' }).outcome).toBe('pass');
    expect(r({ amount: 800, currency: 'EUR', per: 'month' }).outcome).toBe('fail');
    expect(r({ min: 300, max: 600, currency: 'EUR', per: 'month' })).toMatchObject({ outcome: 'unknown', reason: 'range' });
  });
  it('is / has / where / exists / covers', () => {
    const s = school({
      full_day: { v: true },
      license_type: { v: ['mon'] },
      'fee.meals': { v: { included: false } },
      'support.psychologist': { v: { available: true } },
      ages_accepted: { v: { min: 1, max: 4 } },
    });
    const o = (rule: object) => evalRule(s, rule, catalog, { ctx }, false)!.outcome;
    expect(o({ dim: 'full_day', is: true })).toBe('pass');
    expect(o({ dim: 'license_type', has: 'mon' })).toBe('pass');
    expect(o({ dim: 'fee.meals', where: { included: true } })).toBe('fail');
    expect(o({ dim: 'support.psychologist', exists: true })).toBe('pass');
    expect(o({ dim: 'ages_accepted', covers: 'context' })).toBe('fail'); // pg2 = age 6
    expect(o({ dim: 'kitchen', is: 'on_site' })).toBe('unknown');
  });
  it('marks values from another year as unverified', () => {
    const s = school({ tuition: { v: { amount: 470, currency: 'EUR', per: 'month' }, scope: { year: '2026/2027', grade: 'pg2' } } });
    expect(evalRule(s, { dim: 'tuition', lte: cap }, catalog, { ctx }, true)).toMatchObject({ outcome: 'pass', unverified: true });
  });
  it('neighbourhood rules use the browser list; an empty list means the rule is not applied', () => {
    const rule = { neighborhood: { in: [], editable: true } };
    expect(evalRule(school({}), rule, catalog, { ctx, near: [] }, true)).toBeNull();
    expect(evalRule(school({}), rule, catalog, { ctx, near: ['izgrev'] }, true)!.outcome).toBe('pass');
    expect(evalRule(school({}), rule, catalog, { ctx, near: ['lozen'] }, true)!.outcome).toBe('fail');
  });
  it('distance needs coordinates on both sides', () => {
    const rule = { within_km: { km: 5 } };
    expect(evalRule(school({}), rule, catalog, { ctx, place: [42.69, 23.32] }, true)).toMatchObject({ outcome: 'unknown', reason: 'no_coordinates' });
    const near = school({}, [{ id: 'main', geo: [42.67, 23.35], src: { source_ref: 'src-y' } }]);
    expect(evalRule(near, rule, catalog, { ctx, place: [42.69, 23.32] }, true)!.outcome).toBe('pass');
    expect(evalRule(near, { within_km: { km: 1 } }, catalog, { ctx, place: [42.69, 23.32] }, true)!.outcome).toBe('fail');
  });
});

describe('evaluate and rank', () => {
  const set: CriteriaSet = {
    id: 'x', kind: 'custom',
    require: [{ dim: 'tuition', lte: { amount: 6000, currency: 'EUR', per: 'year' } }],
    prefer: [{ dim: 'full_day', is: true, weight: 2 }, { dim: 'kitchen', is: 'on_site' }, { dim: 'transport', is: true }],
  };
  it('hard fail excludes; hard unknown keeps but marks unverified; score and coverage', () => {
    const cheap = evaluate(school({ tuition: { v: { amount: 400, currency: 'EUR', per: 'month' } }, full_day: { v: true }, kitchen: { v: 'external_caterer' } }), [set], catalog, { ctx });
    expect(cheap).toMatchObject({ excluded: false, unverified: false });
    expect(cheap.score).toBeCloseTo(2 / 3);
    expect(cheap.coverage).toBeCloseTo(3 / 4);
    expect(evaluate(school({ tuition: { v: { amount: 900, currency: 'EUR', per: 'month' } } }), [set], catalog, { ctx }).excluded).toBe(true);
    const unknown = evaluate(school({}), [set], catalog, { ctx });
    expect(unknown).toMatchObject({ excluded: false, unverified: true, score: null, coverage: 0 });
  });
});

describe('default criteria sets (golden, on the sample data)', () => {
  const { entities: schools } = checkDataDir('data/schools', catalog);
  const { sets, errors } = checkCriteriaDir('data/criteria', catalog);
  const by = (ids: string[]) => ids.map((id) => sets.find((s) => s.id === id)!);
  const ids = (rs: ReturnType<typeof rank>) => rs.map((r) => r.entity.id);

  it('are valid and labelled in every language', () => {
    expect(errors).toEqual([]);
    expect(sets.map((s) => s.id).sort()).toEqual(['anywhere', 'basics', 'budget-high', 'budget-low', 'budget-medium', 'location-near', 'location-wider']);
    for (const lang of LANGS) for (const s of sets) expect(dictionaries[lang][`criteria.set.${s.id}`], `${lang}: ${s.id}`).toBeTruthy();
  });

  it('budget-low excludes schools whose known tuition is over the cap', () => {
    const r = rank(schools, by(['budget-low']), catalog, { ctx });
    const excluded = ids(r.filter((x) => x.excluded));
    expect(excluded).toEqual(expect.arrayContaining(['quest-junior', 'toddlers-academy', 'izzi', 'prikluchenci']));
    expect(excluded).not.toContain('anika');
    expect(r[0].entity.id).toBe('anika'); // the only confirmed price under the cap for 2027/28
    expect(r.find((x) => x.entity.id === 'djani-rodari')).toMatchObject({ excluded: false, unverified: true }); // 2026/27 price
  });

  it('basics excludes nurseries that stop before the final preschool year', () => {
    const r = rank(schools, by(['basics']), catalog, { ctx });
    expect(ids(r.filter((x) => x.excluded))).toEqual(['izsledovateli-iztok']);
  });

  it('location-near keeps only schools in the chosen neighbourhoods, and ignores an empty list', () => {
    const near = rank(schools, by(['location-near']), catalog, { ctx, near: ['iztok'] });
    expect(ids(near.filter((x) => !x.excluded)).sort()).toEqual(['izsledovateli-iztok', 'prikluchenci']);
    expect(rank(schools, by(['location-near']), catalog, { ctx, near: [] }).every((x) => !x.excluded)).toBe(true);
  });

  it('location-wider keeps everything and ranks near schools higher', () => {
    const r = rank(schools, by(['location-wider']), catalog, { ctx, near: ['geo-milev'] });
    expect(r.every((x) => !x.excluded)).toBe(true);
    expect(ids(r).slice(0, 2).sort()).toEqual(['djani-rodari', 'pitar-pan']);
  });
});

describe('criteria file checks', () => {
  it('rejects unknown dimensions, wrong operators and schema errors', () => {
    const { errors } = checkCriteriaFiles([
      { path: 'a.yaml', content: 'id: a\nkind: custom\nrequire:\n  - { dim: nope, is: true }\n  - { dim: full_day, lte: 3 }\n  - { dim: tuition, lte: 3 }\n' },
      { path: 'b.yaml', content: 'id: b\nkind: custom\nprefer:\n  - { dim: full_day, bogus: 1 }\n' },
      { path: 'c.yaml', content: 'id: other\nkind: custom\n' },
    ], catalog);
    expect(errors.some((e) => e.includes('unknown dimension "nope"'))).toBe(true);
    expect(errors.some((e) => e.includes('full_day: lte/gte need a number or money dimension'))).toBe(true);
    expect(errors.some((e) => e.includes('tuition: lte must be money'))).toBe(true);
    expect(errors.some((e) => e.startsWith('b.yaml'))).toBe(true);
    expect(errors.some((e) => e.includes('must match the file name'))).toBe(true);
  });
});
