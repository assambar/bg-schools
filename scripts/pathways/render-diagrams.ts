// CLI: node scripts/pathways/render-diagrams.ts [--all]
// Renders generated/diagrams/**/*.mmd to SVG with a pinned mermaid-cli (needs Chrome; run
// locally, not in CI) and records the sha256 of each source in generated/diagrams/rendered.json.
// Only sources that changed since their last render are rendered, unless --all.
// Chrome: puppeteer's own download, or set CHROME_PATH=/usr/bin/google-chrome.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, OUT, RENDERED, sha256 } from './build-diagrams.ts';

const MERMAID_CLI = '@mermaid-js/mermaid-cli@12.0.0';
const all = process.argv.includes('--all');
const rendered = existsSync(RENDERED) ? (JSON.parse(readFileSync(RENDERED, 'utf8')) as Record<string, string>) : {};
const args = ['-y', MERMAID_CLI, '-c', 'scripts/pathways/mermaid.json', '-b', 'white'];
if (process.env.CHROME_PATH) {
  const pp = join(tmpdir(), 'bg-schools-puppeteer.json');
  writeFileSync(pp, JSON.stringify({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] }));
  args.push('-p', pp);
}
const save = () => {
  const sorted = Object.fromEntries(Object.entries(rendered).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(RENDERED, JSON.stringify(sorted, null, 1) + '\n');
};
let n = 0;
for (const [rel, content] of generate()) {
  if (!rel.endsWith('.mmd')) continue;
  const hash = sha256(content);
  const svg = join(OUT, rel.replace(/\.mmd$/, '.svg'));
  if (!all && rendered[rel] === hash && existsSync(svg)) continue;
  execFileSync('npx', [...args, '-i', join(OUT, rel), '-o', svg], { stdio: 'inherit' });
  rendered[rel] = hash;
  n++;
  save(); // keep progress if a later diagram fails
}
save();
console.log(`✓ rendered ${n} diagram(s)`);
