// Loads and checks the pathways (data/pathways) and the finance inputs (data/finance).
// Shared by the CLI validator, the Vite build, the diagram script and the tests.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { checkPathways, type Pathways } from '../../src/pathways/pathways.ts';
import { SCENARIOS, type FinanceData } from '../../src/pathways/finance.ts';
import { createAjv, ROOT } from '../load-domain.ts';

const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/** Throws with every problem listed. */
export function loadPathways(dir = 'data/pathways'): Pathways {
  const data = {
    stages: parse(read(`${dir}/stages.yaml`)),
    transitions: parse(read(`${dir}/transitions.yaml`)),
    paths: parse(read(`${dir}/paths.yaml`)),
  };
  return checkedPathways(data, dir);
}

export function checkedPathways(data: unknown, label = 'pathways'): Pathways {
  const validate = createAjv().compile(JSON.parse(read('schema/pathways.schema.json')));
  if (!validate(data)) throw new Error((validate.errors ?? []).map((e) => `${label}: ${e.instancePath || '(root)'} ${e.message}`).join('\n'));
  const p = data as Pathways;
  const errors = checkPathways(p);
  for (const s of p.stages) if (s.school && !existsSync(resolve(ROOT, `data/schools/${s.school}.yaml`))) errors.push(`stages/${s.id}: unknown school "${s.school}"`);
  for (const path of p.paths) for (const src of path.cost.sources) if (src.startsWith('data/') && !existsSync(resolve(ROOT, src))) errors.push(`paths/${path.id}: missing source file ${src}`);
  if (errors.length) throw new Error(errors.map((e) => `${label}: ${e}`).join('\n'));
  return p;
}

export function loadFinance(dir = 'data/finance'): FinanceData {
  const a = parse(read(`${dir}/assumptions.yaml`)) as Omit<FinanceData, 'sp500'>;
  const sp500 = read(`${dir}/sp500-total-return.csv`).split('\n').filter((l) => /^\d/.test(l)).map((l) => l.split(',').map(Number) as [number, number]);
  const errors: string[] = [];
  if (!SCENARIOS.includes(a.defaults.scenario)) errors.push(`defaults.scenario must be one of ${SCENARIOS.join(', ')}`);
  for (const [y, r] of sp500) if (!Number.isInteger(y) || !Number.isFinite(r)) errors.push(`sp500: bad row ${y},${r}`);
  for (let i = 1; i < sp500.length; i++) if (sp500[i][0] !== sp500[i - 1][0] + 1) errors.push(`sp500: gap after ${sp500[i - 1][0]}`);
  for (const u of a.universities) {
    if (!existsSync(resolve(ROOT, `data/universities/${u.id}.yaml`))) errors.push(`universities: no data/universities/${u.id}.yaml`);
    for (const [, , cur] of [u.tuition, ...(u.living ? [u.living] : [])]) if (cur !== 'EUR' && !a.fixed.fx[cur]) errors.push(`universities/${u.id}: no rate for ${cur}`);
  }
  if (errors.length) throw new Error(errors.map((e) => `${dir}: ${e}`).join('\n'));
  return { ...a, sp500 };
}
