// Browser-side validation: the Ajv validator precompiled from the generated schema
// (no eval, so it runs under a strict CSP) plus the same cross-file rules as CI.
import validateSchool from 'virtual:school-validator';
import { parseDocument } from 'yaml';
import type { Catalog } from './catalog.ts';
import { checkSchool, entriesOf, type School } from './school.ts';

export interface Result {
  school?: School;
  errors: string[];
}

export function validateYaml(text: string, cat: Catalog, others: readonly School[], isNew: boolean): Result {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length > 0) return { errors: doc.errors.map((e) => `YAML: ${e.message.split('\n')[0]}`) };
  const data = doc.toJS();
  if (!validateSchool(data)) {
    return {
      errors: (validateSchool.errors ?? []).map((e) => {
        const extra = e.keyword === 'additionalProperties' ? ` ("${e.params.additionalProperty}")` : '';
        return `${e.instancePath || '(root)'} ${e.message}${extra}`;
      }),
    };
  }
  const school = data as School;
  const errors: string[] = [];
  if (isNew && others.some((s) => s.id === school.id)) errors.push(`id "${school.id}" already exists`);
  const refs = new Map<string, string>();
  for (const s of others) {
    if (s.id === school.id) continue;
    for (const d of Object.keys(s.values)) for (const e of entriesOf(s, d)) if (e.src?.source_ref) refs.set(e.src.source_ref, `${s.id}/${d}`);
  }
  errors.push(...checkSchool(school, cat, refs));
  return { school, errors };
}
