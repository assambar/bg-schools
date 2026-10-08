import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { githubEditFileUrl, githubNewFileUrl, slugify, toYaml } from '../src/lib/school.ts';
import { validateEntry } from '../src/lib/validate.ts';

const valid = { id: 'maple-bear', name: 'Maple Bear', status: 'check', open_day: '2026-10-27' };

describe('validateEntry (precompiled browser validator)', () => {
  it('accepts a valid entry', () => {
    expect(validateEntry(valid)).toEqual([]);
  });

  it('reports schema violations per field', () => {
    const errors = validateEntry({
      id: 'Bad Id',
      status: 'maybe',
      website: 'not a url',
      open_day: '27.10.2026',
      color: 'red',
    });
    const fields = errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['id', 'name', 'status', 'website', 'open_day', '']));
    expect(errors.find((e) => e.field === 'name')?.message).toBe('is required');
    expect(errors.find((e) => e.field === 'website')?.message).toBe('must be an http:// or https:// URL');
    expect(errors.filter((e) => e.field === 'website')).toHaveLength(1);
  });

  it('rejects an id that already exists', () => {
    expect(validateEntry(valid, ['maple-bear'])).toEqual([{ field: 'id', message: '"maple-bear" already exists' }]);
  });
});

describe('toYaml', () => {
  it('drops empty optional fields and uses a fixed key order', () => {
    const yaml = toYaml({ notes: '  ', status: 'research', name: ' Germani ', id: 'germani', district: '' });
    expect(yaml).toBe('id: germani\nname: Germani\nstatus: research\n');
  });

  it('round-trips through YAML and stays valid', () => {
    const entry = { ...valid, notes: 'Line one.\nLine two: with "quotes" & colons.' };
    const parsed = parse(toYaml(entry));
    expect(parsed).toEqual(entry);
    expect(validateEntry(parsed)).toEqual([]);
  });
});

describe('helpers', () => {
  it('slugifies names', () => {
    expect(slugify('British School of Sofia')).toBe('british-school-of-sofia');
    expect(slugify('  École Denis Diderot! ')).toBe('ecole-denis-diderot');
  });

  it('builds GitHub editor URLs', () => {
    const url = new URL(githubNewFileUrl('germani', 'id: germani\nname: Germani & Co\n'));
    expect(url.origin + url.pathname).toBe('https://github.com/assambar/bg-schools/new/main');
    expect(url.searchParams.get('filename')).toBe('data/schools/germani.yaml');
    expect(url.searchParams.get('value')).toBe('id: germani\nname: Germani & Co\n');
    expect(url.search).not.toContain('+'); // spaces encoded as %20
    expect(githubEditFileUrl('germani')).toBe(
      'https://github.com/assambar/bg-schools/edit/main/data/schools/germani.yaml',
    );
  });
});
