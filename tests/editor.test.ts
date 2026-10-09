import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadCatalog } from '../scripts/schema.ts';
import { githubEditFileUrl, githubNewFileUrl, slugify, stampUserEdits, type School } from '../src/lib/school.ts';
import { readField, writeField } from '../src/lib/editor-fields.ts';
import { validateYaml } from '../src/lib/validate.ts';

const { catalog } = loadCatalog();
const text = readFileSync('data/schools/maple-bear.yaml', 'utf8');
const school = parse(text) as School;

describe('validateYaml (precompiled browser validator + cross-file rules)', () => {
  it('accepts a repository file', () => {
    expect(validateYaml(text, catalog, [school], false).errors).toEqual([]);
  });

  it('reports schema and rule problems', () => {
    expect(validateYaml('id: x\n', catalog, [], true).errors.join()).toMatch(/must have required property 'name'/);
    expect(validateYaml(text, catalog, [school], true).errors).toEqual(['id "maple-bear" already exists']);
    const bad = text.replace('src: { source_ref: src-006,', 'src: {');
    expect(validateYaml(bad, catalog, [school], false).errors).toEqual(['open_days: every value needs its own src.source_ref']);
  });
});

describe('stampUserEdits', () => {
  it('gives changed values user-edit provenance and keeps the rest', () => {
    const edited: School = { ...school, values: { ...school.values, full_day: { v: true } } };
    const out = stampUserEdits(school, edited, '2026-10-08', 'k1');
    expect(out.values.full_day).toEqual({ v: true, src: { kind: 'user-edit', source_ref: 'src-uk1-1', date: '2026-10-08' } });
    expect(out.values.open_days).toEqual(school.values.open_days);
  });
});

describe('helpers', () => {
  it('slugifies names', () => {
    expect(slugify('British School of Sofia')).toBe('british-school-of-sofia');
  });

  it('builds GitHub editor URLs', () => {
    const url = new URL(githubNewFileUrl('germani', 'id: germani\n'));
    expect(url.origin + url.pathname).toBe('https://github.com/assambar/bg-schools/new/main');
    expect(url.searchParams.get('filename')).toBe('data/schools/germani.yaml');
    expect(githubEditFileUrl('germani')).toBe('https://github.com/assambar/bg-schools/edit/main/data/schools/germani.yaml');
  });
});

describe('editor form fields (levels as checkboxes)', () => {
  const levels = catalog.byId.get('levels')!;

  it('levels is a multi-select listed as an editor field', () => {
    expect(levels.type).toBe('multi_enum');
    expect(catalog.editorFields).toContain('levels');
    expect(catalog.valueSets.level).toEqual(['nursery', 'kindergarten', 'preschool', 'primary', 'lower_secondary', 'upper_secondary']);
  });

  it('adds several levels to a new file with user-edit provenance, and the result validates', () => {
    const base = 'id: new-school\nname: New school\nsites:\n  - id: main\nvalues: {}\n';
    const out = writeField(base, levels, ['kindergarten', 'preschool'], '2026-10-09', 'k1');
    expect(parse(out).values.levels).toEqual({ v: ['kindergarten', 'preschool'], src: { kind: 'user-edit', source_ref: 'src-uk1-levels', date: '2026-10-09' } });
    expect(readField(out, 'levels')).toEqual({ state: 'ok', value: ['kindergarten', 'preschool'] });
    expect(validateYaml(out, catalog, [], true).errors).toEqual([]);
    // Unticking everything removes the value (unknown), it never writes an empty list.
    const cleared = writeField(out, levels, [], '2026-10-09');
    expect(parse(cleared).values).toEqual({});
    expect(validateYaml(cleared, catalog, [], true).errors).toEqual([]);
  });

  it('changes an existing value in place and keeps its provenance until stamped', () => {
    const aea = readFileSync('data/schools/american-english-academy.yaml', 'utf8');
    const out = writeField(aea, levels, ['primary'], '2026-10-09');
    const v = parse(out).values.levels;
    expect(v.v).toEqual(['primary']);
    expect(v.src.source_ref).toBe('src-202');
    expect(validateYaml(out, catalog, [], false).errors).toEqual([]);
  });

  it('reports YAML it cannot edit', () => {
    expect(readField('id: [', 'levels')).toEqual({ state: 'invalid' });
    expect(readField('values:\n  levels:\n    - { v: [ nursery ] }\n    - { v: [ primary ] }\n', 'levels')).toEqual({ state: 'several' });
    expect(readField('values: {}\n', 'levels')).toEqual({ state: 'ok', value: undefined });
  });

  it('rejects an empty or repeated list of levels', () => {
    const file = (v: string) => `id: x\nname: X\nsites:\n  - id: main\nvalues:\n  levels: { v: ${v}, src: { kind: user-edit, source_ref: src-t1, date: 2026-10-09 } }\n`;
    expect(validateYaml(file('[ nursery, primary ]'), catalog, [], true).errors).toEqual([]);
    expect(validateYaml(file('[]'), catalog, [], true).errors.join()).toMatch(/fewer than 1/);
    expect(validateYaml(file('[ nursery, nursery ]'), catalog, [], true).errors.join()).toMatch(/duplicate/);
    expect(validateYaml(file('nursery'), catalog, [], true).errors.join()).toMatch(/must be array/);
  });
});
