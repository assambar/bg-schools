// One Ajv setup shared by the CLI validator, the Vite build and the browser
// (via a precompiled standalone validator), so all three agree on what's valid.
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';

export const SCHEMA_PATH = new URL('../schema/school.schema.json', import.meta.url);

export function loadSchema(): object {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
}

export function createAjv(options: { standalone?: boolean } = {}) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    // `format` in the schema is an annotation for editors (the 2020-12 default).
    // Patterns do the enforcing, which keeps the precompiled validator free of
    // runtime imports.
    validateFormats: false,
    ...(options.standalone ? { code: { source: true, esm: true } } : {}),
  });
  return ajv;
}
