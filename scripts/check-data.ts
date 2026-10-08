// Reads every data/schools/*.yaml file and reports anything that would break
// the site: malformed YAML, schema violations, id/filename mismatch, duplicates.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { createAjv, loadSchema } from './schema.ts';

export interface DataFile {
  path: string; // used in error messages
  content: string;
}

export interface CheckResult {
  schools: Record<string, unknown>[];
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

export function checkFiles(files: DataFile[]): CheckResult {
  const validate = createAjv().compile(loadSchema());
  const errors: string[] = [];
  const schools: Record<string, unknown>[] = [];
  const seen = new Map<string, string>();

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
        const where = e.instancePath || '(root)';
        errors.push(`${file.path}: ${where} ${e.message}`);
      }
      continue;
    }
    const school = data as Record<string, unknown>;
    const id = String(school.id);
    const expected = basename(file.path, '.yaml');
    if (id !== expected) {
      errors.push(`${file.path}: id "${id}" must match the file name "${expected}"`);
      continue;
    }
    const previous = seen.get(id);
    if (previous) {
      errors.push(`${file.path}: duplicate id "${id}" (also in ${previous})`);
      continue;
    }
    seen.set(id, file.path);
    schools.push(school);
  }
  return { schools, errors };
}

export function checkDataDir(dir: string): CheckResult {
  return checkFiles(readDataDir(dir));
}
