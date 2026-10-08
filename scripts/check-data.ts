// Reads every data/schools/*.yaml file and reports anything that would break the
// site: malformed YAML, schema violations, id/filename mismatch, duplicates, and the
// cross-file rules in src/lib/school.ts (scope, provenance, unique source_refs).
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import type { Catalog } from '../src/lib/catalog.ts';
import { buildSchoolSchema } from '../src/lib/schema-gen.ts';
import { checkSchool, type School } from '../src/lib/school.ts';
import { createAjv, loadCatalog } from './schema.ts';

export interface DataFile {
  path: string; // used in error messages
  content: string;
}

export interface CheckResult {
  schools: School[];
  errors: string[];
}

export function readDataDir(dir: string): DataFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort()
    .map((name) => ({
      path: relative(process.cwd(), join(dir, name)) || name,
      content: readFileSync(join(dir, name), 'utf8'),
    }));
}

export function checkFiles(files: DataFile[], catalog: Catalog = loadCatalog().catalog): CheckResult {
  const validate = createAjv().compile(buildSchoolSchema(catalog));
  const errors: string[] = [];
  const schools: School[] = [];
  const seen = new Map<string, string>();
  const refs = new Map<string, string>();

  for (const file of files) {
    if (file.path.endsWith('.yml')) {
      errors.push(`${file.path}: use the .yaml extension`);
      continue;
    }
    const doc = parseDocument(file.content, { prettyErrors: true, uniqueKeys: true });
    if (doc.errors.length > 0) {
      for (const e of doc.errors) errors.push(`${file.path}: invalid YAML: ${e.message}`);
      continue;
    }
    const data = doc.toJS();
    if (!validate(data)) {
      for (const e of validate.errors ?? []) {
        const extra = e.keyword === 'additionalProperties' ? ` ("${e.params.additionalProperty}")` : '';
        errors.push(`${file.path}: ${e.instancePath || '(root)'} ${e.message}${extra}`);
      }
      continue;
    }
    const school = data as School;
    const expected = basename(file.path, '.yaml');
    if (school.id !== expected) {
      errors.push(`${file.path}: id "${school.id}" must match the file name "${expected}"`);
      continue;
    }
    const previous = seen.get(school.id);
    if (previous) {
      errors.push(`${file.path}: duplicate id "${school.id}" (also in ${previous})`);
      continue;
    }
    seen.set(school.id, file.path);
    const problems = checkSchool(school, catalog, refs);
    for (const p of problems) errors.push(`${file.path}: ${p}`);
    if (problems.length === 0) schools.push(school);
  }
  return { schools, errors };
}

export function checkDataDir(dir: string): CheckResult {
  return checkFiles(readDataDir(dir));
}
