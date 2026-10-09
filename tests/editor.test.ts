import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadCatalog } from '../scripts/schema.ts';
import { githubEditFileUrl, githubNewFileUrl, slugify, stampUserEdits, type School } from '../src/lib/school.ts';
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
