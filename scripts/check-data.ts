// Reads every entity file of a domain and reports anything that would break the site:
// malformed YAML, schema violations, id/filename mismatch, duplicates, and the
// cross-file rules in src/lib/entity.ts (scope, provenance, unique source_refs).
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { checkCriteria, type CriteriaSet } from '../src/lib/criteria.ts';
import type { Domain } from '../src/lib/domain.ts';
import { checkEntity, type Entity } from '../src/lib/entity.ts';
import { buildCriteriaSchema, buildEntitySchema, buildStatusSchema } from '../src/lib/schema-gen.ts';
import { parseStatus, type StatusFile } from '../src/lib/status.ts';
import { createAjv } from './load-domain.ts';

export interface DataFile {
  path: string; // used in error messages
  content: string;
}

export interface CheckResult {
  entities: Entity[];
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

export function checkFiles(files: DataFile[], dom: Domain): CheckResult {
  const validate = createAjv().compile(buildEntitySchema(dom));
  const errors: string[] = [];
  const entities: Entity[] = [];
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
    const entity = data as Entity;
    const expected = basename(file.path, '.yaml');
    if (entity.id !== expected) {
      errors.push(`${file.path}: id "${entity.id}" must match the file name "${expected}"`);
      continue;
    }
    const previous = seen.get(entity.id);
    if (previous) {
      errors.push(`${file.path}: duplicate id "${entity.id}" (also in ${previous})`);
      continue;
    }
    seen.set(entity.id, file.path);
    const problems = checkEntity(entity, dom, refs);
    for (const p of problems) errors.push(`${file.path}: ${p}`);
    if (problems.length === 0) entities.push(entity);
  }
  return { entities, errors };
}

export function checkDataDir(dir: string, dom: Domain): CheckResult {
  return checkFiles(readDataDir(dir), dom);
}

/** Checks criteria set files: schema, id = file name, and rules that fit the domain. */
export function checkCriteriaFiles(files: DataFile[], dom: Domain): { sets: CriteriaSet[]; errors: string[] } {
  const validate = createAjv().compile(buildCriteriaSchema(dom));
  const errors: string[] = [];
  const sets: CriteriaSet[] = [];
  for (const file of files) {
    const doc = parseDocument(file.content, { prettyErrors: true, uniqueKeys: true });
    if (doc.errors.length > 0) {
      for (const e of doc.errors) errors.push(`${file.path}: invalid YAML: ${e.message}`);
      continue;
    }
    const data = doc.toJS();
    if (!validate(data)) {
      for (const e of validate.errors ?? []) errors.push(`${file.path}: ${e.instancePath || '(root)'} ${e.message}`);
      continue;
    }
    const set = data as CriteriaSet;
    if (set.id !== basename(file.path, '.yaml')) {
      errors.push(`${file.path}: id "${set.id}" must match the file name`);
      continue;
    }
    const problems = checkCriteria(set, dom);
    for (const p of problems) errors.push(`${file.path}: ${p}`);
    if (problems.length === 0) sets.push(set);
  }
  return { sets, errors };
}

export function checkCriteriaDir(dir: string, dom: Domain): { sets: CriteriaSet[]; errors: string[] } {
  return checkCriteriaFiles(readDataDir(dir), dom);
}

/** Checks the domain's public default status file (domain config `status.default`). */
export function checkDefaultStatus(dom: Domain, entityIds: string[], criteriaIds: string[]): { file?: StatusFile; errors: string[] } {
  const path = dom.config.status?.default;
  if (!path) return { errors: [] };
  const validate = createAjv().compile(buildStatusSchema(dom));
  const { file, errors } = parseStatus(readFileSync(path, 'utf8'), dom, validate, entityIds, criteriaIds);
  return { file, errors: errors.map((e) => `${path}: ${e}`) };
}
