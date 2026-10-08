import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { findForbidden } from '../scripts/check-hygiene.ts';

const word = ['No', 'tion'].join('');

describe('hygiene check', () => {
  it('finds forbidden words in content and file names, case-insensitively', () => {
    expect(findForbidden([{ path: 'a.md', content: `ok\nfrom ${word}\n` }])).toEqual(['a.md:2']);
    expect(findForbidden([{ path: `x-${word.toLowerCase()}.ts`, content: '' }])).toEqual([`x-${word.toLowerCase()}.ts: file name`]);
    expect(findForbidden([{ path: 'package-lock.json', content: word }])).toEqual([]);
  });

  it('passes on the repository', () => {
    expect(() => execFileSync(process.execPath, ['scripts/check-hygiene.ts'], { stdio: 'pipe' })).not.toThrow();
  });
});
