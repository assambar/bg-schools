// Loads a domain directory (domains/<name>/domain.yaml and the files it points to) and
// checks it. One Ajv setup shared by the CLI validator, the Vite build, the tests and
// (via a precompiled standalone validator) the browser, so all agree on what's valid.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { buildDomain, checkDomain, mergeRetrieval, type Area, type Domain, type DomainConfig, type DomainFiles, type RawCatalog, type RetrievalOverlay, type ScopeValue } from '../src/lib/domain.ts';
import { buildEntitySchema } from '../src/lib/schema-gen.ts';

export const ROOT = resolve(import.meta.dirname, '..');
/** The domain the site is built from. Override with DOMAIN_DIR=<dir>. */
export const DEFAULT_DOMAIN_DIR = process.env.DOMAIN_DIR ?? 'domains/schools';

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

const readYaml = (path: string): unknown => parse(readFileSync(resolve(ROOT, path), 'utf8'));
const readJson = (path: string): unknown => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));

/** `path/file.yaml#a.b` -> the list at a.b in that file. */
function readRef<T>(ref: string): T[] {
  const [file, keyPath] = ref.split('#');
  let v = readYaml(file) as Record<string, unknown>;
  for (const k of (keyPath ?? '').split('.').filter(Boolean)) v = v?.[k] as Record<string, unknown>;
  if (!Array.isArray(v)) throw new Error(`${ref}: not a list`);
  return v as T[];
}

function schemaCheck(schemaFile: string, data: unknown, label: string): string[] {
  const validate = createAjv().compile(readJson(schemaFile) as object);
  return validate(data) ? [] : (validate.errors ?? []).map((e) => `${label}: ${e.instancePath || '(root)'} ${e.message}`);
}

export interface LoadedDomain {
  dir: string;
  domain: Domain;
  files: DomainFiles;
  overlays: RetrievalOverlay[];
  /** The domain's dictionaries per language (domains/<name>/i18n/<lang>.json). */
  i18n: Record<string, Record<string, string>>;
}

/** Loads and checks a domain. Throws with every problem listed. */
export function loadDomain(dir: string = DEFAULT_DOMAIN_DIR): LoadedDomain {
  const configPath = join(dir, 'domain.yaml');
  const config = readYaml(configPath) as DomainConfig;
  let errors = schemaCheck('schema/domain.schema.json', config, configPath);
  if (errors.length) throw new Error(errors.join('\n'));
  const catalog = readYaml(config.paths.catalog) as RawCatalog;
  errors = schemaCheck('schema/catalog.schema.json', catalog, config.paths.catalog);
  if (errors.length) throw new Error(errors.join('\n'));
  const scopeValues: Record<string, ScopeValue[]> = {};
  for (const a of config.scopes) if (a.values_from) scopeValues[a.id] = readRef<ScopeValue>(a.values_from);
  const loc = config.locations;
  const areas: Area[] = loc
    ? readRef<Record<string, string>>(loc.areas_from).map((n) => ({ id: n.id, ...(loc.group_key && n[loc.group_key] ? { group: n[loc.group_key] } : {}) }))
    : [];
  const files: DomainFiles = { config, catalog, scopeValues, areas };
  const domain = buildDomain(files);
  errors = checkDomain(domain);
  // Optional retrieval overlays: <overlays>/retrieval.<name>.yaml (same shape as the catalog).
  const overlays: RetrievalOverlay[] = [];
  const odir = config.paths.overlays;
  if (odir && existsSync(resolve(ROOT, odir))) {
    for (const f of readdirSync(resolve(ROOT, odir)).filter((f) => /^retrieval\..+\.ya?ml$/.test(f)).sort()) {
      const overlay = readYaml(join(odir, f)) as RetrievalOverlay;
      overlays.push(overlay);
      errors.push(...mergeRetrieval(domain, overlay, `${odir}/${f}`));
    }
  }
  const i18n: Record<string, Record<string, string>> = {};
  const idir = resolve(ROOT, config.paths.i18n);
  for (const f of readdirSync(idir).filter((f) => f.endsWith('.json')).sort()) i18n[f.replace(/\.json$/, '')] = readJson(join(config.paths.i18n, f)) as Record<string, string>;
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return { dir, domain, files, overlays, i18n };
}

export function loadEntitySchema(domain: Domain): object {
  return buildEntitySchema(domain);
}
