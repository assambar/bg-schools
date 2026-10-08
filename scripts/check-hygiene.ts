// CLI: node scripts/check-hygiene.ts
// Fails if any tracked file mentions the private tools the sample data was collected
// with. The words are assembled from parts so this file doesn't match itself.
// Skips package-lock.json (third-party names) and node_modules (not tracked).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FORBIDDEN = new RegExp([['no', 'tion'], ['to', 'do', 'ist']].map((p) => p.join('')).join('|'), 'i');
const SKIP = [/^package-lock\.json$/, /(^|\/)node_modules\//];

export function findForbidden(files: { path: string; content: string }[]): string[] {
  const hits: string[] = [];
  for (const { path, content } of files) {
    if (SKIP.some((re) => re.test(path))) continue;
    if (FORBIDDEN.test(path)) hits.push(`${path}: file name`);
    content.split('\n').forEach((line, i) => {
      if (FORBIDDEN.test(line)) hits.push(`${path}:${i + 1}`);
    });
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const files = paths.map((path) => {
    try {
      return { path, content: readFileSync(path, 'utf8') };
    } catch {
      return { path, content: '' }; // deleted in the working tree
    }
  });
  const hits = findForbidden(files);
  if (hits.length > 0) {
    console.error(`✗ forbidden word found (use "sample data" instead):\n  ${hits.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`✓ hygiene: ${files.length} tracked files checked`);
}
