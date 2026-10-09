// CLI: node scripts/pathways/build-diagrams.ts [--check]
// Generates the Mermaid sources of the Paths and Finance pages from the data, for both
// languages, plus the precomputed finance defaults:
//   generated/diagrams/paths/<path>.<lang>.mmd     one flowchart per path
//   generated/diagrams/money/<id>.<lang>.mmd       sankey-beta, xychart-beta, flowchart (defaults)
//   generated/finance/defaults.json                compute() for the default inputs
// The SVGs next to the .mmd files are rendered by scripts/pathways/render-diagrams.ts (pinned mermaid-cli)
// and committed; generated/diagrams/rendered.json records the sha256 of the .mmd each SVG was
// rendered from. --check (CI) fails when an SVG is missing or was rendered from older text.
// CI also runs this script and fails on `git diff generated/`, so the sources can't go stale.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as finance from '../../src/pathways/finance.ts';
import { compute, pyRound, type Results } from '../../src/pathways/finance.ts';
import { pathFlowchart, type Lang } from '../../src/pathways/pathways.ts';
import { ROOT } from '../load-domain.ts';
import { loadFinance, loadPathways } from './load.ts';

export const OUT = resolve(ROOT, 'generated');
const LANGS: Lang[] = ['en', 'bg'];
const k = (x: number) => pyRound(x / 100) / 10; // EUR thousands, one decimal

const T = {
  en: {
    budget: 'budget', fees: 'school fees', tutoring: 'tutoring and math school', surplus: 'invested surplus', topup: 'top-up beyond budget',
    sankeyNote: 'EUR thousands, family, 13 school years, default inputs',
    xyTitle: 'Per child: paid in vs. invested value (base, EUR thousands)', xyAxis: 'EUR thousands',
    flow: (m: number, months: number, fam: number) => `€${m}/child/month × ${months} months, €${fam}k/yr family`,
    d1: 'Decision 1 (age 6): spend or invest?', priv: (x: number) => `private PG2 and 1-4 (Drujba) ~€${x}k/child`, privN: 'Private primary',
    state: 'state, €0 fees', stateN: 'State primary + math school', inv: (x: number) => `invest 13 yrs: €${x}k/child at 19 (base)`, invN: 'S&P 500 index fund',
    loan: (x: number) => `borrow 13 yrs: €${x}k interest/child`, loanN: 'Consumer loans',
    d2: 'Decision 2 (grade 4): SMG?', smgE: 'competition ranking, €0 fees', smgN: 'SMG 5-7', stay: 'stay', stayN: 'Same school 5-7',
    d3: 'Decision 3 (grade 7): ACS (€10.54k/yr in 2026/27)?', acsE: 'exam; need-based reduction 10-90%', acsN: 'ACS 8-12', langE: 'NVO 7 ranking, €0', langN: 'State high school 8-12 (SMG again via NVO 7)',
    uni: 'University (age 19)', eu: (x: number) => `EU low fee: TU Delft 4 yrs ≈ €${x}k`, euN: 'EU degree', uk: (a: number, b: number) => `UK overseas: Oxford 4 yrs ≈ €${a}k-${b}k`, ukN: 'UK degree', us: 'US need-blind: aid by family income', usN: 'US degree',
  },
  bg: {
    budget: 'бюджет', fees: 'такси', tutoring: 'уроци и школа по математика', surplus: 'инвестиран остатък', topup: 'доплащане извън бюджета',
    sankeyNote: 'хил. евро, семейство, 13 учебни години, стойности по подразбиране',
    xyTitle: 'На дете: внесено и стойност на инвестицията (базов, хил. евро)', xyAxis: 'хил. евро',
    flow: (m: number, months: number, fam: number) => `€${m}/дете/месец × ${months} месеца, €${fam}k/год. семейство`,
    d1: 'Решение 1 (6 г.): харчим или инвестираме?', priv: (x: number) => `частна ПГ2 и 1-4 (Дружба) ~€${x}k/дете`, privN: 'Частно основно',
    state: 'държавно, без такси', stateN: 'Държавно основно + школа', inv: (x: number) => `инвестиция 13 г.: €${x}k/дете на 19 (базов)`, invN: 'Индексен фонд S&P 500',
    loan: (x: number) => `кредит 13 г.: €${x}k лихва/дете`, loanN: 'Потребителски кредити',
    d2: 'Решение 2 (4. клас): СМГ?', smgE: 'класиране по състезания, без такси', smgN: 'СМГ 5-7', stay: 'остава', stayN: 'Същото училище 5-7',
    d3: 'Решение 3 (7. клас): АКС (€10.54k/год. през 2026/27)?', acsE: 'изпит; намаление по нужда 10-90%', acsN: 'АКС 8-12', langE: 'класиране по НВО 7, без такси', langN: 'Държавна гимназия 8-12 (СМГ отново чрез НВО 7)',
    uni: 'Университет (19 г.)', eu: (x: number) => `ЕС, ниска такса: TU Delft 4 г. ≈ €${x}k`, euN: 'Диплома в ЕС', uk: (a: number, b: number) => `Великобритания: Оксфорд 4 г. ≈ €${a}k-${b}k`, ukN: 'Диплома във Великобритания', us: 'САЩ need-blind: помощ според дохода', usN: 'Диплома в САЩ',
  },
};

// Mermaid's sankey parser accepts ASCII text only, so its node labels are in English in both
// languages; the page caption says so in Bulgarian.
function sankey(lang: Lang, rowsByPath: Record<string, { fee: number; once: number; extras: number; budget: number }[]>): string {
  const t = T.en;
  const out = ['sankey-beta', '', `%% ${T[lang].sankeyNote}`];
  for (const id of ['state-smg', 'drujba-smg', 'quest-acs']) {
    const rows = rowsByPath[id];
    const fees = rows.reduce((s, x) => s + x.fee + x.once, 0);
    const ex = rows.reduce((s, x) => s + x.extras, 0);
    const bud = rows.reduce((s, x) => s + x.budget, 0);
    const cost = fees + ex;
    const n = (s: string) => `"${id}: ${s}"`;
    const B = n(t.budget);
    if (fees) out.push(`${B},${n(t.fees)},${k(Math.min(fees, bud))}`);
    if (ex) out.push(`${B},${n(t.tutoring)},${k(Math.max(0, Math.min(ex, bud - fees)))}`);
    if (bud > cost) out.push(`${B},${n(t.surplus)},${k(bud - cost)}`);
    if (cost > bud) out.push(`${n(t.topup)},${n(t.fees)},${k(cost - bud)}`);
  }
  return out.join('\n') + '\n';
}

function xychart(series: { year: number; paid: number; value: number }[], lang: Lang): string {
  const t = T[lang];
  const max = Math.ceil(Math.max(...series.map((s) => s.value)) / 50) * 50;
  return ['xychart-beta', `  title "${t.xyTitle}"`, `  x-axis [${series.map((s) => s.year).join(', ')}]`, `  y-axis "${t.xyAxis}" 0 --> ${max}`,
    `  bar [${series.map((s) => s.paid).join(', ')}]`, `  line [${series.map((s) => s.value).join(', ')}]`].join('\n') + '\n';
}

function decisions(r: Results, lang: Lang, drujba1to4: number): string {
  const t = T[lang];
  const c = r.config;
  const fam = k(c.monthly_per_child * c.months_per_year * c.kids);
  const inv13 = r.invest[r.invest.length - 1];
  const l13 = r.borrow[r.borrow.length - 1];
  const u = (id: string) => r.universities.find((x) => x.id === id)!;
  return ['flowchart LR',
    `  B(["${t.flow(c.monthly_per_child, c.months_per_year, fam)}"])`,
    `  B --> D1{"${t.d1}"}`,
    `  D1 -->|"${t.priv(k(drujba1to4))}"| S1["${t.privN}"]`,
    `  D1 -->|"${t.state}"| S2["${t.stateN}"]`,
    `  D1 -.->|"${t.inv(k(inv13.value_at_uni.base))}"| F["${t.invN}"]`,
    `  D1 -.->|"${t.loan(k(l13.interest))}"| L["${t.loanN}"]`,
    `  S1 --> D2{"${t.d2}"}`, '  S2 --> D2',
    `  D2 -->|"${t.smgE}"| SMG["${t.smgN}"]`,
    `  D2 -->|"${t.stay}"| ST["${t.stayN}"]`,
    `  SMG --> D3{"${t.d3}"}`, '  ST --> D3',
    `  D3 -->|"${t.acsE}"| ACS["${t.acsN}"]`,
    `  D3 -->|"${t.langE}"| HS["${t.langN}"]`,
    `  ACS --> U{"${t.uni}"}`, '  HS --> U', '  F -.-> U',
    `  U -->|"${t.eu(k(u('tu-delft').degree_min))}"| EU["${t.euN}"]`,
    `  U -->|"${t.uk(k(u('oxford').degree_min), k(u('oxford').degree_max))}"| UK["${t.ukN}"]`,
    `  U -->|"${t.us}"| US["${t.usN}"]`].join('\n') + '\n';
}

/** Every generated file: path relative to generated/ -> content. */
export function generate(): Map<string, string> {
  const files = new Map<string, string>();
  const p = loadPathways();
  const f = loadFinance();
  for (const path of p.paths) for (const lang of LANGS) files.set(`diagrams/paths/${path.id}.${lang}.mmd`, `%% GENERATED by scripts/pathways/build-diagrams.ts from data/pathways\n${pathFlowchart(p, path, lang)}`);

  const r = compute(f, f.defaults, p.paths);
  const c = r.config;
  const rowsByPath = Object.fromEntries(p.paths.map((x) => [x.id, finance.pathYears(c, x)]));
  const series = Array.from({ length: c.uni_start_after_years }, (_, i) => {
    const y = i + 1;
    const v = finance.fvInvest(c, y, r.returns.base.rate);
    return { year: c.start_year + y, paid: k(v.paid), value: k(v.value) };
  });
  const drujba = rowsByPath['drujba-smg'].filter((x) => x.kid === 1 && x.grade <= 4).reduce((s, x) => s + x.total, 0);
  for (const lang of LANGS) {
    const head = '%% GENERATED by scripts/pathways/build-diagrams.ts from data/finance (default inputs)\n';
    files.set(`diagrams/money/money-sankey.${lang}.mmd`, head + sankey(lang, rowsByPath));
    files.set(`diagrams/money/paid-vs-invested.${lang}.mmd`, head + xychart(series, lang));
    files.set(`diagrams/money/money-decisions.${lang}.mmd`, head + decisions(r, lang, drujba));
  }
  const { config: _config, returns, ...rest } = r;
  files.set('finance/defaults.json', JSON.stringify({ inputs: f.defaults, returns: Object.fromEntries(Object.entries(returns).map(([s, v]) => [s, Math.round(v.rate * 1e6) / 1e6])), ...rest, borrow: r.borrow.map((b) => ({ ...b, repaid: pyRound(b.repaid), interest: pyRound(b.interest), borrowed: pyRound(b.borrowed), peak_monthly: pyRound(b.peak_monthly) })) }, null, 1) + '\n');
  return files;
}


export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const RENDERED = join(OUT, 'diagrams/rendered.json');

if (import.meta.main) {
  const files = generate();
  for (const [rel, content] of files) {
    const file = join(OUT, rel);
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file) || readFileSync(file, 'utf8') !== content) writeFileSync(file, content);
  }
  // Remove nothing automatically; report stale files instead (CI fails on them).
  const stale: string[] = [];
  for (const sub of ['diagrams/paths', 'diagrams/money']) {
    for (const name of readdirSync(join(OUT, sub))) if (name.endsWith('.mmd') && !files.has(`${sub}/${name}`)) stale.push(`${sub}/${name}`);
  }
  console.log(`✓ ${files.size} generated file(s) in generated/`);
  let failed = stale.length > 0;
  for (const s of stale) console.error(`✗ stale file generated/${s} (no longer generated; delete it)`);
  if (process.argv.includes('--check')) {
    const rendered = existsSync(RENDERED) ? (JSON.parse(readFileSync(RENDERED, 'utf8')) as Record<string, string>) : {};
    for (const [rel, content] of files) {
      if (!rel.endsWith('.mmd')) continue;
      const svg = join(OUT, rel.replace(/\.mmd$/, '.svg'));
      if (!existsSync(svg)) { console.error(`✗ missing ${svg.slice(ROOT.length + 1)}: run npm run diagrams:render`); failed = true; }
      else if (rendered[rel] !== sha256(content)) { console.error(`✗ generated/${rel.replace(/\.mmd$/, '.svg')} was rendered from older text: run npm run diagrams:render`); failed = true; }
    }
    if (!failed) console.log('✓ every SVG was rendered from the current .mmd');
  }
  if (failed) process.exit(1);
}
