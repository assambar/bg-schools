import { describe, expect, it } from 'vitest';
import { buildCatalog, checkCatalog, retrievalFor, type RawCatalog } from '../src/lib/catalog.ts';
import { loadCatalog } from '../scripts/schema.ts';
import { hasConflict, pickEntry, type School } from '../src/lib/school.ts';

const { raw, catalog } = loadCatalog();

describe('catalog', () => {
  it('has about 100 dimensions in the expected areas, each with retrieval steps', () => {
    expect(catalog.dimensions.length).toBeGreaterThanOrEqual(95);
    expect(catalog.groups).toEqual(['identity', 'admissions', 'cost', 'languages', 'programme', 'activities', 'facilities', 'practical', 'support', 'continuity', 'reputation']);
    for (const d of catalog.dimensions) expect(d.retrieval?.steps?.length, d.id).toBeGreaterThan(0);
  });

  it('covers the priority areas: activity location, after-hours, fee breakdown, support', () => {
    expect(catalog.byId.get('activity.swimming')?.type).toBe('offering');
    expect(catalog.byId.get('after_hours_care')?.type).toBe('service');
    expect(catalog.byId.get('homework_support')?.type).toBe('service');
    for (const f of ['enrollment', 'meals', 'transport', 'activities', 'materials', 'uniform', 'trips', 'after_hours']) expect(catalog.byId.has(`fee.${f}`), f).toBe(true);
    for (const s of ['psychologist', 'speech_therapist', 'resource_teacher', 'tutoring', 'adaptation', 'medical_staff']) expect(catalog.byId.has(`support.${s}`), s).toBe(true);
  });

  it('reports catalog mistakes', () => {
    const broken: RawCatalog = { ...raw, dimensions: [...raw.dimensions, { id: 'x', group: 'nope', type: 'enum', retrieval: { methods: ['fax'], steps: [] } }] };
    const errors = checkCatalog(broken, buildCatalog(broken, catalog.grades, catalog.neighborhoods));
    expect(errors).toEqual([
      'catalog: x: unknown group "nope"',
      'catalog: x: needs a known value set',
      'catalog: x: unknown retrieval method "fax"',
      'catalog: x: retrieval steps are required',
    ]);
  });

  it('merges per-school retrieval overrides', () => {
    const base = retrievalFor(catalog, 'tuition');
    expect(base.methods.map((m) => m.id)).toEqual(['website', 'call']);
    const extended = retrievalFor(catalog, 'tuition', { steps: ['Fees are on the PDF price list.'] });
    expect(extended.steps[0]).toBe('Fees are on the PDF price list.');
    expect(extended.steps.length).toBe(base.steps.length + 1);
    expect(retrievalFor(catalog, 'tuition', { steps: ['Only this.'], replace: true }).steps).toEqual(['Only this.']);
  });
});

describe('value resolution', () => {
  const school: School = {
    id: 'x', name: 'X', sites: [{ id: 'main' }],
    defaults: { src: { kind: 'imported', date: '2026-10-07' } },
    values: {
      tuition: [
        { v: { amount: 1, currency: 'EUR', per: 'month' } },
        { v: { amount: 2, currency: 'EUR', per: 'month' }, scope: { year: '2027/2028', grade: 'pg2' } },
        { v: { amount: 3, currency: 'EUR', per: 'month' }, scope: { grade: ['pg1', 'pg2'] } },
      ],
      open_days: { v: ['2026-11-18'], scope: { year: '2026/2027' } },
      hours: [{ v: '08:00-18:00' }, { v: '08:00-18:30', src: { kind: 'visit', date: '2026-09-01' } }],
    },
  };
  const ctx = { year: '2027/2028', grade: 'pg2' };

  it('prefers the most specific scope for the context', () => {
    expect(pickEntry(school, 'tuition', ctx)?.entry.v).toEqual({ amount: 2, currency: 'EUR', per: 'month' });
    expect(pickEntry(school, 'tuition', { year: '2027/2028', grade: 'pg1' })?.entry.v).toEqual({ amount: 3, currency: 'EUR', per: 'month' });
    expect(pickEntry(school, 'tuition', { year: '2026/2027', grade: 'nursery' })?.match).toBe('general');
  });

  it('falls back to another year, marked "other"', () => {
    expect(pickEntry(school, 'open_days', ctx)?.match).toBe('other');
  });

  it('uses source precedence (visit beats imported) and flags disagreement', () => {
    expect(pickEntry(school, 'hours', ctx)?.entry.v).toBe('08:00-18:30');
    expect(hasConflict(school, 'hours', ctx)).toBe(true);
    expect(hasConflict(school, 'tuition', ctx)).toBe(false);
  });
});
