import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { checkDataDir, checkFiles } from '../scripts/check-data.ts';
import { loadCatalog } from '../scripts/schema.ts';
import { toYaml } from '../src/lib/school.ts';

const { catalog } = loadCatalog();
const ok = `id: germani
name: Germani
sites:
  - { id: main, neighborhood: malinova-dolina, src: { source_ref: src-t01 } }
defaults:
  src: { kind: imported, ref: sample-test, date: 2026-10-07 }
values:
  full_day: { v: true, src: { source_ref: src-t02 } }
`;
const check = (content: string, path = 'data/schools/germani.yaml') => checkFiles([{ path, content }], catalog).errors;
const withValues = (values: string) => ok.replace(/values:\n[\s\S]*$/, `values:\n${values}`);

describe('repository data', () => {
  it('data/schools is valid', () => {
    const { schools, errors } = checkDataDir('data/schools');
    expect(errors).toEqual([]);
    expect(schools.length).toBeGreaterThan(0);
  });

  it('files are in the canonical format the editor writes', () => {
    for (const name of readdirSync('data/schools')) {
      const content = readFileSync(join('data/schools', name), 'utf8');
      expect(toYaml(parse(content), catalog), name).toBe(content);
    }
  });
});

describe('checkFiles', () => {
  it('accepts a valid file', () => {
    expect(check(ok)).toEqual([]);
  });

  it('rejects malformed YAML and duplicate keys', () => {
    expect(check('id: germani\nname: [unclosed\n')[0]).toMatch(/invalid YAML/);
    expect(check(ok + 'name: Again\n')[0]).toMatch(/invalid YAML/);
  });

  it('rejects unknown dimensions and bad enum values', () => {
    expect(check(withValues('  favourite_colour: { v: red, src: { source_ref: src-t09 } }\n')).join()).toMatch(/must NOT have additional properties \("favourite_colour"\)/);
    expect(check(withValues('  kitchen: { v: microwave, src: { source_ref: src-t09 } }\n')).join()).toMatch(/\/values\/kitchen/);
  });

  it('requires a source_ref on every value and site', () => {
    expect(check(withValues('  full_day: { v: true }\n'))).toEqual(['data/schools/germani.yaml: full_day: every value needs its own src.source_ref']);
    expect(check(ok.replace(', src: { source_ref: src-t01 }', ''))).toEqual(['data/schools/germani.yaml: sites/main: needs src.source_ref']);
  });

  it('requires kind and date (here or in defaults) and a url for extracted values', () => {
    const noDefaults = ok.replace(/defaults:\n.*\n/, '');
    expect(check(noDefaults)).toEqual([
      'data/schools/germani.yaml: full_day: provenance needs a kind (here or in defaults.src)',
      'data/schools/germani.yaml: full_day: provenance needs a date (here or in defaults.src)',
    ]);
    expect(check(withValues('  full_day: { v: true, src: { kind: extracted, source_ref: src-t02 } }\n'))).toEqual([
      'data/schools/germani.yaml: full_day: kind "extracted" needs a url',
    ]);
  });

  it('checks scope against the catalog and the sites', () => {
    const errors = check(withValues(`  full_day: { v: true, scope: { year: 2027/2028 }, src: { source_ref: src-t02 } }
  tuition:
    - { v: { amount: 500, currency: EUR, per: month }, scope: { site: nowhere }, src: { source_ref: src-t03 } }
    - { v: { amount: 500, currency: EUR, per: month }, scope: { year: 2027/2029 }, src: { source_ref: src-t04 } }
`));
    expect(errors).toEqual([
      'data/schools/germani.yaml: full_day: "full_day" can\'t be scoped by year',
      'data/schools/germani.yaml: tuition[0]: unknown site "nowhere"',
      'data/schools/germani.yaml: tuition[1]: school year must be consecutive years, e.g. 2027/2028',
    ]);
  });

  it('rejects an unknown grade and a reused source_ref across files', () => {
    expect(check(withValues('  open_days: { v: [ 2026-11-01 ], scope: { grade: pg9 }, src: { source_ref: src-t02 } }\n')).join()).toMatch(/scope\/grade/);
    const other = ok.replaceAll('germani', 'other').replace('src-t01', 'src-t05');
    const { errors } = checkFiles([{ path: 'a/germani.yaml', content: ok }, { path: 'a/other.yaml', content: other }], catalog);
    expect(errors).toEqual(['a/other.yaml: full_day: source_ref "src-t02" is already used by germani/full_day']);
  });

  it('rejects an id that does not match the file name', () => {
    expect(check(ok, 'data/schools/other.yaml')).toEqual(['data/schools/other.yaml: id "germani" must match the file name "other"']);
  });
});

describe('npm run validate (CLI)', () => {
  it('exits non-zero and names the broken file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bg-schools-'));
    writeFileSync(join(dir, 'germani.yaml'), ok);
    writeFileSync(join(dir, 'broken.yaml'), 'id: broken\nname: "unterminated\n');
    let failure: { status: number; stderr: string } | undefined;
    try {
      execFileSync(process.execPath, ['scripts/validate.ts', dir], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      failure = e as { status: number; stderr: string };
    }
    expect(failure?.status).toBe(1);
    expect(failure?.stderr).toMatch(/broken\.yaml: invalid YAML/);
  });
});
