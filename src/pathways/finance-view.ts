// Finance page: inputs in the browser, results recomputed with src/pathways/finance.ts (same logic
// as scripts/pathways/finance-reference.py), and the pre-rendered diagrams for the default inputs.
import plan from 'virtual:plan';
import { readSetting, writeSetting } from '../app.ts';
import { h } from '../dom.ts';
import { compute, fvInvest, SCENARIOS, type Inputs, type Results, type Scenario } from './finance.ts';
import { getLang, t } from '../lib/i18n.ts';
import { diagram } from './diagrams.ts';
import { disclaimers } from '../views/disclaimers.ts';

const { finance, pathways } = plan;
const SETTING = 'finance-inputs';

const locale = () => (getLang() === 'bg' ? 'bg-BG' : 'en-GB');
export const eur = (n: number) => `${Math.round(n) < 0 ? '−' : ''}€${Math.abs(Math.round(n)).toLocaleString(locale())}`;
const pct = (x: number, digits = 1) => `${(x * 100).toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
const num = (x: number) => x.toLocaleString(locale());
const link = (key: string) => h('a', { href: finance.sources[key].url, target: '_blank', rel: 'noopener noreferrer' }, finance.sources[key].note);

export function financeInputs(): Inputs {
  return { ...finance.defaults, ...(readSetting<Partial<Inputs>>(SETTING) ?? {}) };
}

/** Results for the inputs in use (stored in this browser, else the defaults). */
export const currentResults = (): Results => compute(finance, financeInputs(), pathways.paths);

const table = (heads: string[], rows: (string | Node)[][], cls = '') =>
  h('div', { class: 'scroll' }, h('table', { class: `figures ${cls}` },
    h('thead', {}, h('tr', {}, ...heads.map((x) => h('th', {}, x)))),
    h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c, i) => h(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : { class: 'n' }, c)))))));

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'input' }, h('span', {}, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

function numberInput(id: string, value: number, min: number, max: number, step: number): HTMLInputElement {
  return h('input', { id, type: 'number', min: String(min), max: String(max), step: String(step), value: String(value), inputmode: 'decimal' });
}

export function renderFinance(): HTMLElement {
  const inputs = financeInputs();
  const monthly = numberInput('fin-monthly', inputs.monthly_per_child, 0, 100000, 50);
  const kids = numberInput('fin-kids', inputs.kids, 1, 4, 1);
  const months = h('select', { id: 'fin-months' }, ...[9, 12].map((m) => h('option', { value: String(m) }, t('finance.months.option', { n: m }))));
  months.value = String(inputs.months_per_year);
  const offset = numberInput('fin-offset', inputs.child2_offset_years, 0, 12, 1);
  const growth = numberInput('fin-growth', Math.round(inputs.fee_growth * 1000) / 10, 0, 20, 0.5);
  const scenario = h('select', { id: 'fin-scenario' }, ...SCENARIOS.map((s) => h('option', { value: s }, t(`finance.scenario.${s}`))));
  scenario.value = inputs.scenario;
  const reset = h('button', { type: 'button' }, t('finance.reset'));
  const results = h('div', { id: 'finance-results' });

  const read = (): Inputs => {
    const n = (el: HTMLInputElement, fallback: number) => (Number.isFinite(el.valueAsNumber) ? el.valueAsNumber : fallback);
    const d = finance.defaults;
    return {
      monthly_per_child: Math.max(0, n(monthly, d.monthly_per_child)),
      kids: Math.min(4, Math.max(1, Math.round(n(kids, d.kids)))),
      months_per_year: Number(months.value),
      child2_offset_years: Math.min(12, Math.max(0, Math.round(n(offset, d.child2_offset_years)))),
      fee_growth: Math.min(0.2, Math.max(0, n(growth, d.fee_growth * 100) / 100)),
      scenario: scenario.value as Scenario,
    };
  };
  const update = () => {
    const v = read();
    writeSetting(SETTING, v);
    results.replaceChildren(...renderResults(compute(finance, v, pathways.paths)));
  };
  for (const el of [monthly, kids, offset, growth]) el.addEventListener('input', update);
  for (const el of [months, scenario]) el.addEventListener('change', update);
  reset.addEventListener('click', () => {
    const d = finance.defaults;
    monthly.value = String(d.monthly_per_child);
    kids.value = String(d.kids);
    months.value = String(d.months_per_year);
    offset.value = String(d.child2_offset_years);
    growth.value = String(d.fee_growth * 100);
    scenario.value = d.scenario;
    update();
  });
  results.replaceChildren(...renderResults(compute(finance, inputs, pathways.paths)));

  return h(
    'section',
    { class: 'finance' },
    h('h1', {}, t('finance.heading')),
    h('p', {}, t('finance.intro')),
    disclaimers(),
    h('form', { class: 'inputs', 'aria-label': t('finance.inputs') },
      field(t('finance.input.monthly'), monthly, t('finance.input.monthly.hint')),
      field(t('finance.input.kids'), kids),
      field(t('finance.input.months'), months, t('finance.input.months.hint')),
      field(t('finance.input.offset'), offset, t('finance.input.offset.hint')),
      field(t('finance.input.growth'), growth, t('finance.input.growth.hint')),
      field(t('finance.input.scenario'), scenario),
      h('div', { class: 'actions' }, reset)),
    results,
    h('h2', {}, t('finance.diagrams')),
    h('p', { class: 'hint' }, t('finance.diagrams.hint')),
    ...(['money-decisions', 'money-sankey', 'paid-vs-invested'] as const).flatMap((id) => [h('h3', {}, t(`finance.diagram.${id}`)), diagram('money', id, getLang(), t(`finance.diagram.${id}`))]),
    h('h2', {}, t('finance.sources')),
    h('ul', { class: 'sources' }, ...Object.keys(finance.sources).map((k) => h('li', {}, link(k)))),
  );
}

/** A small bar-and-line chart built as SVG elements (no inline styles, CSP-safe). */
function chart(series: { year: number; paid: number; value: number }[]): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    return e;
  };
  const W = 640, H = 220, L = 56, B = 24, T = 10;
  const max = Math.max(1, ...series.map((s) => Math.max(s.paid, s.value)));
  const bw = (W - L) / series.length;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart', 'aria-label': t('finance.chart.label') }) as SVGSVGElement;
  for (const f of [0, 0.5, 1]) {
    svg.append(el('line', { x1: L, x2: W, y1: y(max * f), y2: y(max * f), stroke: '#d1d9e0' }));
    svg.append(el('text', { x: L - 6, y: y(max * f) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#59636e' }, eur(max * f)));
  }
  series.forEach((s, i) => {
    svg.append(el('rect', { x: L + i * bw + 3, y: y(s.paid), width: bw - 6, height: H - B - y(s.paid), fill: '#b6d4fe' }));
    if (i % 2 === 0) svg.append(el('text', { x: L + i * bw + bw / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: '#59636e' }, String(s.year)));
  });
  svg.append(el('polyline', { points: series.map((s, i) => `${L + i * bw + bw / 2},${y(s.value)}`).join(' '), fill: 'none', stroke: '#1a7f37', 'stroke-width': 2.5 }));
  return svg;
}

function renderResults(r: Results): Element[] {
  const c = r.config;
  const sc = c.scenario;
  const last = r.invest[r.invest.length - 1];
  const horizon = (y: number) => t('finance.horizon', { n: y });
  const pathLabel = (id: string) => pathways.paths.find((p) => p.id === id)!.label[getLang() as 'en' | 'bg'];
  const uniName = (id: string) => h('a', { href: `#/university/${id}` }, t(`finance.uni.${id}`));
  const famYear = c.monthly_per_child * c.months_per_year * c.kids;

  // per child, end of each school year, selected scenario (same function as the tables)
  const series = Array.from({ length: c.uni_start_after_years }, (_, i) => {
    const v = fvInvest(c, i + 1, r.returns[sc].rate);
    return { year: c.start_year + i + 1, paid: v.paid, value: v.value };
  });
  const cheapest = [...r.paths].sort((a, b) => b.net_surplus_at_uni - a.net_surplus_at_uni)[0];
  const delft = r.universities.find((u) => u.id === 'tu-delft')!;
  const mit = r.universities.find((u) => u.id === 'mit')!;

  return [
    h('h2', {}, t('finance.summary')),
    h('p', { class: 'figures-note' }, t('finance.summary.text', {
      fam: eur(famYear), kids: c.kids, months: c.months_per_year, total: eur(famYear * c.uni_start_after_years),
      paid: eur(last.paid), value: eur(last.value_at_uni[sc]), scenario: t(`finance.scenario.${sc}`), year: r.uniYear,
      delft: eur(delft.degree_min), mit: eur(mit.degree_max),
    })),

    h('h2', {}, t('finance.returns')),
    table([t('finance.col.scenario'), t('finance.col.rate'), t('finance.col.basis')],
      [...SCENARIOS, 'worst_window' as const].map((s) => [t(`finance.scenario.${s}`), pct(r.returns[s].rate, 2), r.returns[s].basis])),
    h('p', { class: 'hint' }, t('finance.returns.note', { ter: pct(c.ter, 2) }), ' ', link('ishares'), '. ', t('finance.tax.note'), ' ', link('tax'), '. ', t('finance.fx.note')),

    h('h2', {}, t('finance.invest')),
    h('p', { class: 'hint' }, t('finance.invest.hint')),
    table([t('finance.col.horizon'), t('finance.col.paid'), ...SCENARIOS.filter((s) => s !== 'cautious').map((s) => `${t('finance.col.end')}: ${t(`finance.scenario.${s}`)}`), `${t('finance.col.at_uni', { year: r.uniYear })}: ${t(`finance.scenario.${sc}`)}`],
      r.invest.map((x) => [horizon(x.years), eur(x.paid), eur(x.value_end.pessimistic), eur(x.value_end.base), eur(x.value_end.optimistic), eur(x.value_at_uni[sc])])),
    chart(series),
    h('p', { class: 'hint' }, t('finance.chart.legend', { scenario: t(`finance.scenario.${sc}`) })),

    h('h2', {}, t('finance.borrow')),
    h('p', { class: 'hint' }, t('finance.borrow.hint', { apr: pct(c.loan_apr, 2), years: c.loan_term_years }), ' ', link('bnb')),
    table([t('finance.col.horizon'), t('finance.col.borrowed'), t('finance.col.repaid'), t('finance.col.interest'), t('finance.col.peak'), t('finance.col.debt_free')],
      r.borrow.map((x) => [horizon(x.years), eur(x.borrowed), eur(x.repaid), eur(x.interest), eur(x.peak_monthly), t('finance.years', { n: num(x.debt_free_after_years) })])),

    h('h2', {}, t('finance.paths')),
    h('p', { class: 'hint' }, t('finance.paths.hint', { kids: c.kids, growth: pct(c.fee_growth), scenario: t(`finance.scenario.${sc}`), year: r.uniYear })),
    table([t('finance.col.path'), t('finance.col.fees'), t('finance.col.tutoring'), t('finance.col.cost'), t('finance.col.budget'), t('finance.col.over'), t('finance.col.shortfall'), t('finance.col.surplus')],
      r.paths.map((p) => [h('a', { href: `#/paths/${p.id}` }, pathLabel(p.id)), eur(p.fees), eur(p.tutoring), eur(p.cost), eur(p.budget), String(p.over_budget_kid_years), eur(p.max_shortfall), eur(p.net_surplus_at_uni)])),

    h('h2', {}, t('finance.c')),
    h('ul', { class: 'cases' },
      h('li', {}, h('strong', {}, t('finance.c1.title')), ' ', t('finance.c1', { path: pathLabel(cheapest.id), cost: eur(cheapest.cost), surplus: eur(cheapest.net_surplus_at_uni), year: r.uniYear })),
      h('li', {}, h('strong', {}, t('finance.c2.title')), ' ', t('finance.c2', { value: eur(last.value_at_uni[sc]), scenario: t(`finance.scenario.${sc}`) })),
      h('li', {}, h('strong', {}, t('finance.c3.title')), ' ', t('finance.c3', {
        fam: eur(r.apartment.family_per_year), inst: eur(r.apartment.monthly_instalment), apr: pct(c.mortgage_apr, 2), years: c.mortgage_term_years,
        principal: eur(r.apartment.principal), sqm: num(r.apartment.sqm), rent1: eur(r.apartment.rent_per_year[0]), rent2: eur(r.apartment.rent_per_year[1]),
        months: r.apartment.wage_months_13y, share: num(r.apartment.share_of_avg_wage),
      }), ' ', link('sofia_prices'), ', ', link('nsi_wage'))),
    table([t('finance.col.uni'), t('finance.col.cost_at_start', { year: r.uniYear }), ...SCENARIOS.filter((s) => s !== 'cautious').map((s) => `${t('finance.col.years_covered')}: ${t(`finance.scenario.${s}`)}`)],
      r.uniFund.map((u) => [uniName(u.id), eur(u.cost_per_year_at_start), num(u.years.pessimistic), num(u.years.base), num(u.years.optimistic)])),

    h('h2', {}, t('finance.unis')),
    h('p', { class: 'hint' }, t('finance.unis.hint', { growth: pct(c.uni_cost_growth), year: r.uniYear }), ' ', link('ecb')),
    table([t('finance.col.uni'), t('finance.col.per_year_now'), t('finance.col.degree', { year: r.uniYear }), t('finance.col.degree_family', { kids: c.kids })],
      r.universities.map((u) => [uniName(u.id), range(u.per_year_min, u.per_year_max) + (u.living_included ? '' : ` (${t('finance.no_living')})`), range(u.degree_min, u.degree_max), range(u.degree_min * c.kids, u.degree_max * c.kids)])),

    h('h2', {}, t('finance.bottom')),
    h('p', {}, t('finance.bottom.text', {
      kids: c.kids, value: eur(last.value_at_uni[sc] * c.kids), scenario: t(`finance.scenario.${sc}`), year: r.uniYear,
      delft: eur(delft.degree_min * c.kids), mit: eur(mit.degree_max * c.kids),
      state: eur(cheapest.net_surplus_at_uni),
    })),
  ];
}

const range = (a: number, b: number) => (a === b ? eur(a) : `${eur(a)}–${eur(b)}`);
