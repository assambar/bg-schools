// Browser-side validation using the Ajv validator precompiled from
// schema/school.schema.json at build time (no eval, so it runs under a strict CSP).
import validateSchool from 'virtual:school-validator';
import { FIELD_ORDER } from './school.ts';

export interface FieldError {
  field: string; // a schema property, or "" for the whole entry
  message: string;
}

// Plain-language messages for the cases Ajv words awkwardly.
const MESSAGES: Record<string, string> = {
  'id:pattern': 'use lowercase letters, digits and single dashes',
  'name:pattern': 'must not be blank',
  'district:pattern': 'must not be blank',
  'website:pattern': 'must be an http:// or https:// URL',
  'open_day:pattern': 'must be a date (YYYY-MM-DD)',
};

export function validateEntry(
  entry: Record<string, unknown>,
  existingIds: readonly string[] = [],
): FieldError[] {
  const errors: FieldError[] = [];
  if (!validateSchool(entry)) {
    for (const e of validateSchool.errors ?? []) {
      if (e.keyword === 'required') {
        const field = String(e.params.missingProperty);
        errors.push({ field, message: 'is required' });
      } else if (e.keyword === 'additionalProperties') {
        errors.push({ field: '', message: `unknown field "${e.params.additionalProperty}"` });
      } else if (e.keyword === 'enum') {
        const allowed = (e.params.allowedValues as string[]).join(', ');
        errors.push({ field: e.instancePath.slice(1), message: `must be one of: ${allowed}` });
      } else {
        const field = e.instancePath.slice(1);
        const message = MESSAGES[`${field}:${e.keyword}`] ?? e.message ?? 'is invalid';
        errors.push({ field, message });
      }
    }
  }
  if (typeof entry.id === 'string' && existingIds.includes(entry.id)) {
    errors.push({ field: 'id', message: `"${entry.id}" already exists` });
  }
  // One message per field (the first is enough to fix), in form order.
  const firstPerField = errors.filter(
    (e, i) => e.field === '' || errors.findIndex((other) => other.field === e.field) === i,
  );
  const rank = (f: string) => (FIELD_ORDER as readonly string[]).indexOf(f);
  return firstPerField.sort((a, b) => rank(a.field) - rank(b.field));
}
