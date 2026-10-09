// CLI: node scripts/validate.ts [dir]   (default: data/schools)
// Checks the catalog, every school file, then the criteria sets. Exits 1 on any problem. Used by CI.
import { checkCriteriaDir, checkDataDir } from './check-data.ts';
import { loadCatalog } from './schema.ts';

const dir = process.argv[2] ?? 'data/schools';
try {
  const { catalog } = loadCatalog();
  console.log(`✓ catalog: ${catalog.dimensions.length} dimensions in ${catalog.groups.length} groups`);
} catch (e) {
  console.error(`✗ catalog problems:\n${(e as Error).message}`);
  process.exit(1);
}
const { schools, errors } = checkDataDir(dir);
if (errors.length > 0) {
  console.error(`✗ ${errors.length} problem(s) in ${dir}:`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
const values = schools.reduce((n, s) => n + Object.values(s.values).flat().length, 0);
console.log(`✓ ${schools.length} school file(s) in ${dir} are valid (${values} values)`);

const criteria = checkCriteriaDir('data/criteria');
if (criteria.errors.length > 0) {
  console.error(`✗ ${criteria.errors.length} problem(s) in data/criteria:`);
  for (const e of criteria.errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`✓ ${criteria.sets.length} criteria set(s) in data/criteria are valid`);
