// Editor validation: the Ajv validator compiled from the generated entity schema (in the
// browser it is precompiled, no eval, so it runs under a strict CSP) plus the same
// cross-file rules as CI.
import type { ValidateFunction } from 'ajv';
import { parseDocument } from 'yaml';
import type { Domain } from './domain.ts';
import { checkEntity, entriesOf, type Entity } from './entity.ts';

export interface Result {
  entity?: Entity;
  errors: string[];
}

export function validateYaml(text: string, dom: Domain, validate: ValidateFunction, others: readonly Entity[], isNew: boolean): Result {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length > 0) return { errors: doc.errors.map((e) => `YAML: ${e.message.split('\n')[0]}`) };
  const data = doc.toJS();
  if (!validate(data)) {
    return {
      errors: (validate.errors ?? []).map((e) => {
        const extra = e.keyword === 'additionalProperties' ? ` ("${e.params.additionalProperty}")` : '';
        return `${e.instancePath || '(root)'} ${e.message}${extra}`;
      }),
    };
  }
  const entity = data as Entity;
  const errors: string[] = [];
  if (isNew && others.some((s) => s.id === entity.id)) errors.push(`id "${entity.id}" already exists`);
  const refs = new Map<string, string>();
  for (const s of others) {
    if (s.id === entity.id) continue;
    for (const d of Object.keys(s.values)) for (const e of entriesOf(s, d)) if (e.src?.source_ref) refs.set(e.src.source_ref, `${s.id}/${d}`);
  }
  errors.push(...checkEntity(entity, dom, refs));
  return { entity, errors };
}
