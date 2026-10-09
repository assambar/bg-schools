// @vitest-environment happy-dom
// The same code that runs the schools site validates and renders a second, test-only
// domain (tests/fixtures/laptops): no locations, a different scope axis, its own record
// type, currencies and criteria controls.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { initApp, state } from '../src/app.ts';
import { checkCriteriaDir, checkDataDir } from '../scripts/check-data.ts';
import { rank } from '../src/lib/criteria.ts';
import { domainLabelKeys } from '../src/lib/domain.ts';
import { pickEntry } from '../src/lib/entity.ts';
import { dictionaries, setLang } from '../src/lib/i18n.ts';
import { buildEntitySchema } from '../src/lib/schema-gen.ts';
import { validateYaml } from '../src/lib/validate.ts';
import { renderCriteria } from '../src/views/criteria.ts';
import { renderDetail } from '../src/views/detail.ts';
import { renderEditor } from '../src/views/editor.ts';
import { renderHeader } from '../src/views/header.ts';
import { renderList } from '../src/views/list.ts';
import { setup } from './helpers.ts';

const { dom, validate, i18n } = setup('tests/fixtures/laptops');
const { entities, errors } = checkDataDir(dom.config.paths.entities, dom);
const criteria = checkCriteriaDir(dom.config.paths.criteria, dom);
const byId = (id: string) => entities.find((e) => e.id === id)!;
const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const cells = (row: Element) => [...row.querySelectorAll('td')].map(text);

beforeEach(() => {
  localStorage.clear();
  initApp({ domain: dom, entities, criteria: criteria.sets, validate, i18n });
  setLang('en');
  state.ctx = { ...dom.defaultContext };
});

describe('a second domain through the generic pipeline', () => {
  it('validates its config, entities and criteria', () => {
    expect(errors).toEqual([]);
    expect(criteria.errors).toEqual([]);
    expect(entities.map((e) => e.id).sort()).toEqual(['brick-15', 'feather-13', 'mystery-14']);
    const schema = buildEntitySchema(dom) as { title: string; required: string[]; properties: Record<string, unknown> };
    expect(schema.title).toBe('laptops');
    expect(schema.required).toEqual(['id', 'name', 'values']);
    expect(schema.properties.sites).toBeUndefined(); // no locations in this domain
  });

  it('labels everything in both languages', () => {
    for (const lang of ['en', 'bg']) expect(domainLabelKeys(dom).filter((k) => !(k in dictionaries[lang])), lang).toEqual([]);
  });

  it('rejects bad values with the generated schema', () => {
    const bad = 'id: x\nname: X\nvalues:\n  ports: { v: [ vga ], src: { kind: user-edit, source_ref: src-x1, date: 2026-10-09 } }\n';
    expect(validateYaml(bad, dom, validate, entities, true).errors.join()).toMatch(/\/values\/ports/);
    const sites = 'id: x\nname: X\nsites: [ { id: main } ]\nvalues: {}\n';
    expect(validateYaml(sites, dom, validate, entities, true).errors.join()).toMatch(/additional properties \("sites"\)/);
  });

  it('picks values by its own scope axis and converts its own currencies', () => {
    expect(pickEntry(dom, byId('feather-13'), 'price', { market: 'us' })?.entry.v).toMatchObject({ currency: 'USD' });
    const budget = criteria.sets.filter((s) => s.id === 'budget-1000');
    const eu = rank(entities, budget, dom, { ctx: { market: 'eu' } });
    const us = rank(entities, budget, dom, { ctx: { market: 'us' } });
    expect(eu.find((r) => r.entity.id === 'feather-13')!.excluded).toBe(true); // €1,200
    expect(us.find((r) => r.entity.id === 'feather-13')!.excluded).toBe(false); // $1,100 = €1,000
  });

  it('renders the list with its own columns and no area column', () => {
    const el = renderList(entities);
    expect(text(el.querySelector('h1')!)).toBe('Laptops (3)');
    expect([...el.querySelectorAll('th')].map(text)).toEqual(['Name', 'Price', 'Weight', 'Known facts']);
    const row = [...el.querySelectorAll('tbody tr')].find((r) => text(r).startsWith('Feather 13'))!;
    expect(cells(row)).toEqual(['Feather 13', '€1,200 / one-off', '1.1 kg', '4 / 4']);
    expect(row.querySelector('a')!.getAttribute('href')).toBe('#/laptop/feather-13');
  });

  it('renders the detail view, including its record type and scope badges', () => {
    const el = renderDetail(byId('feather-13'));
    expect(text(el.querySelector('h1')!)).toBe('Feather 13');
    expect(el.textContent).not.toContain('Sites');
    expect(text(el.querySelector('tr[data-dim="warranty"] .value')!)).toBe('Yes · 2 years');
    expect([...el.querySelectorAll('tr[data-dim="price"] .badge.scope')].map(text)).toEqual(['EU', 'US']);
    expect(text(el.querySelector('tr[data-dim="price"] .picked .value')!)).toBe('€1,200 / one-off');
  });

  it('renders the editor with checkboxes for its multi-select and writes the YAML', () => {
    const el = renderEditor(undefined, entities);
    const boxes = [...el.querySelectorAll<HTMLInputElement>('fieldset.form-field input')];
    expect(boxes.map((b) => [b.type, b.value])).toEqual([['checkbox', 'usb_c'], ['checkbox', 'hdmi'], ['checkbox', 'sd']]);
    for (const b of [boxes[1], boxes[2]]) {
      b.checked = true;
      b.dispatchEvent(new Event('change'));
    }
    const yaml = el.querySelector<HTMLTextAreaElement>('#yaml')!.value;
    expect(yaml).toMatch(/ports: \{ v: \[ hdmi, sd \]/);
    expect(text(el.querySelector('.summary')!)).toBe('Valid.');
    expect(text(el.querySelector('h1')!)).toBe('Add a laptop');
  });

  it('renders the criteria page with its own controls and ranks', () => {
    const el = renderCriteria(entities, ['portable'], () => {});
    expect(el.querySelector('#crit-basics')).not.toBeNull();
    expect([...el.querySelectorAll('#crit-budget option')].map(text)).toEqual(['— none —', 'Up to €1,000']);
    expect(el.querySelector('.places-editor')).toBeNull();
    const rows = [...el.querySelectorAll('#criteria-results tbody tr')].map((r) => cells(r).slice(1, 3));
    expect(rows).toEqual([['Feather 13', 'meets the musts'], ['Mystery 14', 'unverified']]);
    expect(el.textContent).toContain('Excluded (1)'); // Brick 15 weighs 2.4 kg
  });

  it('renders the header with its own context axis, in Bulgarian too', () => {
    setLang('bg');
    const el = renderHeader(() => {})[0];
    expect([...el.querySelectorAll('#ctx-market option')].map(text)).toEqual(['ЕС', 'САЩ']);
    expect(el.querySelector('#ctx-year')).toBeNull();
    expect(text(renderList(entities).querySelector('h1')!)).toBe('Лаптопи (3)');
  });
});

describe('no domain-specific code paths', () => {
  it('src/ and scripts/ name no school concepts outside comments (domain names live in domains/ and data/)', () => {
    const files = [...readdirSync('src', { recursive: true, encoding: 'utf8' }).map((f) => join('src', f)), ...readdirSync('scripts').map((f) => join('scripts', f))].filter((f) => f.endsWith('.ts'));
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*(\/\*\*|\*).*$/, '').replace("'domains/schools'", '');
        if (/school|kindergarten|tuition|grade|pg2|`(neighborhood|district)\./i.test(code)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
