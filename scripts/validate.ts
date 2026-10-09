// CLI: node scripts/validate.ts [domain-dir]   (default: domains/schools, or DOMAIN_DIR)
// Checks the domain config and catalog, every entity file, then the criteria sets.
// Exits 1 on any problem. Used by CI.
import { checkCriteriaDir, checkDataDir, checkDefaultStatus } from './check-data.ts';
import { DEFAULT_DOMAIN_DIR, loadDomain, type LoadedDomain } from './load-domain.ts';

const dir = process.argv[2] ?? DEFAULT_DOMAIN_DIR;
let loaded: LoadedDomain;
try {
  loaded = loadDomain(dir);
  const d = loaded.domain;
  console.log(`✓ domain "${d.config.id}" (${dir}): ${d.dimensions.length} dimensions in ${d.groups.length} groups`);
} catch (e) {
  console.error(`✗ domain problems in ${dir}:\n${(e as Error).message}`);
  process.exit(1);
}
const { domain } = loaded;
const { paths } = domain.config;
const { entities, errors } = checkDataDir(paths.entities, domain);
if (errors.length > 0) {
  console.error(`✗ ${errors.length} problem(s) in ${paths.entities}:`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
const values = entities.reduce((n, s) => n + Object.values(s.values).flat().length, 0);
console.log(`✓ ${entities.length} file(s) in ${paths.entities} are valid (${values} values)`);

const criteria = checkCriteriaDir(paths.criteria, domain);
if (criteria.errors.length > 0) {
  console.error(`✗ ${criteria.errors.length} problem(s) in ${paths.criteria}:`);
  for (const e of criteria.errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`✓ ${criteria.sets.length} criteria set(s) in ${paths.criteria} are valid`);

if (domain.config.status) {
  const st = checkDefaultStatus(domain, entities.map((e) => e.id), criteria.sets.map((c) => c.id));
  if (st.errors.length > 0) {
    console.error(`✗ default status file:\n  ${st.errors.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`✓ default status file ${domain.config.status.default} is valid`);
}
