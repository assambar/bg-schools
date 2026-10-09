// Shared test setup: load a domain (default: the schools domain), register its
// dictionaries and compile its entity validator, the same way the build does.
import { loadDomain } from '../scripts/load-domain.ts';
import { addDictionaries } from '../src/lib/i18n.ts';
import { buildEntitySchema } from '../src/lib/schema-gen.ts';
import { createAjv } from '../scripts/load-domain.ts';

export function setup(dir?: string) {
  const loaded = loadDomain(dir);
  addDictionaries(loaded.i18n);
  const validate = createAjv().compile(buildEntitySchema(loaded.domain));
  return { ...loaded, dom: loaded.domain, validate };
}
