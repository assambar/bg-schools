// Paths page: every path from PG2 to university with its pre-rendered flowchart, gates,
// associations (with evidence) and cost for the family with the Finance page inputs.
import plan from 'virtual:plan';
import { h } from '../dom.ts';
import { caveatsOf, evidenceTag, isSmallSample, pathAssociations, pathGates, type Lang, type Path, type Transition } from './pathways.ts';
import { getLang, t } from '../lib/i18n.ts';
import { diagram } from './diagrams.ts';
import { disclaimers } from '../views/disclaimers.ts';
import { currentResults, eur } from './finance-view.ts';

const { pathways } = plan;
const stage = (id: string) => pathways.stages.find((s) => s.id === id)!;
const ext = (url: string, text: string) =>
  url.startsWith('data/')
    ? h('a', { href: `https://github.com/assambar/bg-schools/blob/main/${url}`, target: '_blank', rel: 'noopener noreferrer' }, text)
    : h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text);

function footnote(): HTMLElement {
  return h('p', { class: 'footnote' }, t('paths.footnote'), ' ',
    ext('https://www.segabg.com/category-observer/mozhe-li-bez-chastni-uroci-7-klas', t('paths.footnote.source')));
}

function association(a: Transition, lang: Lang): HTMLElement {
  const e = a.evidence![0];
  const target = a.to ? stage(a.to).label[lang] : a.outcome![lang];
  return h('li', { class: isSmallSample(e) ? 'assoc small' : 'assoc' },
    `${stage(a.from).label[lang]} ⇢ ${target}: ${a.label[lang]}. `,
    h('span', { class: 'badges' },
      h('span', { class: 'badge' }, evidenceTag(e, lang)),
      e.source_type === 'school_self_report' ? h('span', { class: 'badge warn' }, t('paths.self_reported')) : null,
      isSmallSample(e) ? h('span', { class: 'badge warn' }, t('paths.small_sample')) : null,
      h('span', { class: 'badge' }, t(`paths.verification.${e.verification}`)),
      h('span', { class: 'badge' }, t('paths.confidence', { c: t(`paths.confidence.${e.confidence}`) })),
      ...caveatsOf(e).filter((c) => c !== 'small_n' && c !== 'self_reported').map((c) => h('span', { class: 'badge' }, t(`paths.caveat.${c}`))),
      ext(e.url, t('paths.source'))),
    ' ', h('span', { class: 'hint' }, e.label[lang]));
}

function renderPath(path: Path, lang: Lang, cost: ReturnType<typeof currentResults>['paths'][number] | undefined, kids: number): HTMLElement {
  const gates = pathGates(pathways, path);
  const assoc = pathAssociations(pathways, path);
  return h('section', { class: 'path', id: `path-${path.id}` },
    h('h2', {}, h('a', { href: `#/paths/${path.id}` }, path.label[lang])),
    h('p', { class: 'steps' }, ...path.steps.flatMap((s, i) => {
      const st = stage(s);
      const label = st.school ? h('a', { href: `#/school/${st.school}` }, st.label[lang]) : st.label[lang];
      return i === 0 ? [label] : [' → ', label];
    })),
    diagram('paths', path.id, lang, t('paths.diagram.alt', { path: path.label[lang] })),
    h('h3', {}, t('paths.gates')),
    gates.length ? h('ol', {}, ...gates.map((g) => h('li', {}, g.gate![lang], ...(g.sources ?? []).map((u) => [' ', ext(u, '↗')]).flat()))) : h('p', { class: 'hint' }, t('paths.no_gates')),
    ...(assoc.length ? [h('h3', {}, t('paths.associations')), h('ul', {}, ...assoc.map((a) => association(a, lang)))] : []),
    h('h3', {}, t('paths.cost', { kids })),
    cost
      ? h('p', {}, t('paths.cost.text', { cost: eur(cost.cost), budget: eur(cost.budget), over: cost.over_budget_kid_years, shortfall: eur(-cost.max_shortfall), surplus: eur(cost.net_surplus_at_uni) }), ' ', h('a', { href: '#/finance' }, t('paths.cost.inputs')))
      : null,
    path.cost.unknowns?.length ? h('ul', { class: 'unknowns' }, ...path.cost.unknowns.map((u) => h('li', {}, u[lang]))) : null,
    h('p', { class: 'hint' }, t('paths.sources'), ' ', ...path.cost.sources.flatMap((u, i) => [i ? ', ' : '', ext(u, u.replace(/^https:\/\/(www\.)?/, '').split('/')[0])])),
  );
}

export function renderPaths(only?: string): HTMLElement {
  const lang = getLang() as Lang;
  const r = currentResults();
  const kids = r.config.kids;
  const costOf = (id: string) => r.paths.find((p) => p.id === id);
  const shown = only ? pathways.paths.filter((p) => p.id === only) : pathways.paths;
  if (only && !shown.length) return h('p', {}, t('paths.not_found', { id: only }), ' ', h('a', { href: '#/paths' }, t('paths.back')));
  return h('section', { class: 'paths' },
    h('h1', {}, t('paths.heading')),
    only ? h('p', {}, h('a', { href: '#/paths' }, t('paths.back'))) : h('p', {}, t('paths.intro')),
    disclaimers(),
    footnote(),
    h('p', { class: 'legend' }, t('paths.legend')),
    only ? null : h('div', { class: 'scroll' }, h('table', { class: 'figures' },
      h('thead', {}, h('tr', {}, ...[t('paths.col.path'), t('paths.col.gates'), t('paths.col.cost', { kids }), t('paths.col.over')].map((x) => h('th', {}, x)))),
      h('tbody', {}, ...pathways.paths.map((p) => {
        const c = costOf(p.id)!;
        return h('tr', {}, h('th', { scope: 'row' }, h('a', { href: `#/paths/${p.id}` }, p.label[lang])), h('td', { class: 'n' }, String(pathGates(pathways, p).length)), h('td', { class: 'n' }, eur(c.cost)), h('td', { class: 'n' }, String(c.over_budget_kid_years)));
      })))),
    ...shown.map((p) => renderPath(p, lang, costOf(p.id), kids)),
    footnote(),
  );
}
