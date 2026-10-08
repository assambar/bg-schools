// CLI: node scripts/validate.ts [dir]   (default: data/schools)
// Exits 1 if any file is invalid. Used by CI and `npm run validate`.
import { checkDataDir } from './check-data.ts';

const dir = process.argv[2] ?? 'data/schools';
const { schools, errors } = checkDataDir(dir);

if (errors.length > 0) {
  console.error(`✗ ${errors.length} problem(s) in ${dir}:`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`✓ ${schools.length} school file(s) in ${dir} are valid`);
