import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { checkDataDir, checkFiles } from '../scripts/check-data.ts';
import { toYaml } from '../src/lib/school.ts';

const ok = 'id: germani\nname: Germani\nstatus: research\n';

describe('repository data', () => {
  it('data/schools is valid', () => {
    const { schools, errors } = checkDataDir('data/schools');
    expect(errors).toEqual([]);
    expect(schools.length).toBeGreaterThan(0);
  });

  it('files are in the same format the editor generates', () => {
    for (const name of readdirSync('data/schools')) {
      const content = readFileSync(join('data/schools', name), 'utf8');
      expect(toYaml(parse(content)), name).toBe(content);
    }
  });
});

describe('checkFiles rejects bad data', () => {
  const check = (path: string, content: string) => checkFiles([{ path, content }]).errors;

  it('accepts a valid file', () => {
    expect(check('data/schools/germani.yaml', ok)).toEqual([]);
  });

  it('rejects malformed YAML', () => {
    expect(check('data/schools/germani.yaml', 'id: germani\nname: [unclosed\n')[0]).toMatch(/invalid YAML/);
  });

  it('rejects duplicate keys', () => {
    expect(check('data/schools/germani.yaml', ok + 'name: Again\n')[0]).toMatch(/invalid YAML/);
  });

  it('rejects schema violations', () => {
    const errors = check('data/schools/germani.yaml', 'id: germani\nstatus: maybe\nopen_day: soon\n');
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/must have required property 'name'/),
        expect.stringMatching(/\/status must be equal to one of the allowed values/),
        expect.stringMatching(/\/open_day must match pattern/),
      ]),
    );
  });

  it('rejects an id that does not match the file name', () => {
    expect(check('data/schools/other.yaml', ok)).toEqual([
      'data/schools/other.yaml: id "germani" must match the file name "other"',
    ]);
  });

  it('rejects duplicate ids', () => {
    const { errors } = checkFiles([
      { path: 'a/germani.yaml', content: ok },
      { path: 'b/germani.yaml', content: ok },
    ]);
    expect(errors).toEqual(['b/germani.yaml: duplicate id "germani" (also in a/germani.yaml)']);
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
