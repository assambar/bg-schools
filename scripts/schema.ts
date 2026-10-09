// One Ajv setup and one catalog loader shared by the CLI validator, the Vite build
// and the browser (via a precompiled standalone validator), so all agree on what's valid.
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { buildCatalog, checkCatalog, type Catalog, type Grade, type Neighborhood, type RawCatalog } from '../src/lib/catalog.ts';
import { buildSchoolSchema } from '../src/lib/schema-gen.ts';

export const CATALOG_DIR = new URL('../data/catalog/', import.meta.url);
const CATALOG_SCHEMA = new URL('../schema/catalog.schema.json', import.meta.url);

export function createAjv(options: { standalone?: boolean } = {}) {
  return new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false, // money uses anyOf: [{required: [amount]}, {required: [min, max]}]
    // Patterns do the enforcing, which keeps the precompiled validator free of runtime imports.
    validateFormats: false,
    inlineRefs: false, // one function per shared definition keeps the browser validator small
    ...(options.standalone ? { code: { source: true, esm: true } } : {}),
  });
}

const readYaml = (name: string) => parse(readFileSync(new URL(name, CATALOG_DIR), 'utf8'));

/** Loads and checks data/catalog/*.yaml. Throws with every problem listed. */
export function loadCatalog(): { raw: RawCatalog; catalog: Catalog } {
  const raw = readYaml('dimensions.yaml') as RawCatalog;
  const validate = createAjv().compile(JSON.parse(readFileSync(CATALOG_SCHEMA, 'utf8')));
  if (!validate(raw)) {
    const msgs = (validate.errors ?? []).map((e) => `data/catalog/dimensions.yaml: ${e.instancePath || '(root)'} ${e.message}`);
    throw new Error(msgs.join('\n'));
  }
  const grades = (readYaml('grades.yaml') as { systems: Record<string, Grade[]> }).systems.bg;
  const neighborhoods = (readYaml('neighborhoods.yaml') as { neighborhoods: Neighborhood[] }).neighborhoods;
  const catalog = buildCatalog(raw, grades, neighborhoods);
  const errors = checkCatalog(raw, catalog);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return { raw, catalog };
}

export function loadSchoolSchema(catalog: Catalog = loadCatalog().catalog): object {
  return buildSchoolSchema(catalog);
}
