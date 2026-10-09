import { describe, expect, it } from 'vitest';
import { checkedPathways, loadPathways } from '../scripts/pathways/load.ts';
import { caveatsOf, causalWording, pathFlowchart, pathGates } from '../src/pathways/pathways.ts';

const p = loadPathways();
const clone = () => structuredClone(p);

describe('pathways data', () => {
  it('has the 11 paths, each starting at PG2 age and ending at university', () => {
    expect(p.paths.map((x) => x.id)).toEqual(['state-smg', 'rodari-state-smg', 'drujba-smg', 'state-lang', 'state-npmg', 'state-acs', 'quest-acs', 'smg-acs', 'drujba-stay', 'bss-ib', 'aas-ib']);
    for (const path of p.paths) expect(path.steps.at(-1)).toBe('university');
  });
  it('SMG grade 8 is not an automatic continuation', () => {
    const t = p.transitions.find((x) => x.from === 'smg-5-7' && x.to === 'smg-8-12' && x.kind === 'mechanism')!;
    expect(t.gate!.en).toMatch(/apply again/);
  });
  it('gates come from the mechanism transitions along the path', () => {
    const gates = pathGates(p, p.paths.find((x) => x.id === 'state-acs')!);
    expect(gates.map((g) => g.id)).toEqual(['state-pg-primary', 'acs-from-state']);
  });
  it('flags small samples and self-reports', () => {
    const rodari = p.transitions.find((x) => x.id === 'rodari-nvo4')!.evidence![0];
    expect(caveatsOf(rodari)).toContain('small_n');
    const sofia = p.transitions.find((x) => x.id === 'sveta-sofia-to-acs')!.evidence![0];
    expect(caveatsOf(sofia)).toContain('self_reported');
    expect(caveatsOf(sofia)).not.toContain('small_n');
  });
  it('draws mechanisms solid and associations dashed with year, N and source type', () => {
    const mmd = pathFlowchart(p, p.paths.find((x) => x.id === 'state-acs')!, 'en');
    expect(mmd).toContain('state_5_7 -->|"ACS entrance exam"| acs_8_12');
    expect(mmd).toMatch(/sveta_sofia_1_7 -\.->\|"40 of 72 grade-7 pupils admitted to ACS \(2026 · N=72 · school self-report\)"\| acs_8_12/);
  });
});

describe('pathways checks', () => {
  it('rejects a causal transition kind', () => {
    const d = clone();
    (d.transitions[0] as { kind: string }).kind = 'causal';
    expect(() => checkedPathways(d)).toThrow(/kind/);
  });
  it('rejects causal wording in en and bg', () => {
    for (const text of ['Quest boosts your ACS chances', 'raises your chance of SMG', 'a feeder school', 'повишава шанса за СМГ']) expect(causalWording(text)).toBeDefined();
    expect(causalWording('40 of 72 grade-7 pupils admitted to ACS')).toBeUndefined();
    const d = clone();
    d.transitions.find((x) => x.id === 'sveta-sofia-to-acs')!.label.en = 'Sveta Sofia boosts admission to ACS';
    expect(() => checkedPathways(d)).toThrow(/causal wording/);
  });
  it('requires a mechanism between consecutive steps and evidence on associations', () => {
    const d = clone();
    d.paths[0].steps = ['pg-state', 'acs-8-12', 'university'];
    expect(() => checkedPathways(d)).toThrow(/no mechanism transition pg-state → acs-8-12/);
    const e = clone();
    delete e.transitions.find((x) => x.id === 'smg-nvo7')!.evidence;
    expect(() => checkedPathways(e)).toThrow(/needs evidence/);
  });
  it('requires year, sample size and source type on evidence', () => {
    const d = clone();
    delete (d.transitions.find((x) => x.id === 'smg-nvo7')!.evidence![0] as Partial<{ sample_size: number }>).sample_size;
    expect(() => checkedPathways(d)).toThrow(/sample_size/);
  });
});
