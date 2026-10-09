import allSets from 'virtual:criteria';
import { h } from '../dom.ts';
import { rank, type CriteriaSet, type Rule, type RuleResult } from '../lib/criteria.ts';
import { formatMoney, formatValue } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import type { Money, School } from '../lib/school.ts';
import { catalog, changeCriteria, changeNear, state } from '../state.ts';

const byId = new Map(allSets.map((s) => [s.id, s]));
const ofKind = (k: string) => allSets.filter((s) => s.kind === k);
const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);

export function describeRule(r: Rule): string {
  if (r.neighborhood) return t('criteria.rule.near', { n: (r.neighborhood.editable ? state.near : r.neighborhood.in).length });
  if (r.within_km) return t('criteria.rule.within', { km: r.within_km.km });
  const d = catalog.byId.get(r.dim!)!;
  const label = t(`dim.${d.id}`);
  const parts: string[] = [];
  if (r.covers) parts.push(t('criteria.rule.covers', { grade: t(`grade.${state.ctx.grade}`) }));
  if (r.exists !== undefined) parts.push(t(r.exists ? 'value.available' : 'value.not_available'));
  if (r.is !== undefined) parts.push(formatValue(d, r.is));
  if (r.in) parts.push(r.in.map((x) => formatValue(d, x)).join(' / '));
  if (r.has !== undefined) parts.push(([] as string[]).concat(r.has).map((x) => (d.values ? t(`enum.${d.values}.${x}`) : x)).join(' / '));
  for (const [k, v] of Object.entries(r.where ?? {})) {
    if (k === 'included') parts.push(t(v ? 'value.included' : 'value.extra'));
    else if (k === 'available' || k === 'offered' || k === 'exists') parts.push(t(v ? 'value.available' : 'value.not_available'));
    else parts.push(`${k}: ${String(v)}`);
  }
  for (const [op, sign] of [['lte', '≤'], ['gte', '≥']] as const) {
    const b = r[op];
    if (b !== undefined) parts.push(`${sign} ${typeof b === 'number' ? b : formatMoney(b as Money)}`);
  }
  return `${label}: ${parts.join(', ')}`;
}

function chip(r: RuleResult): HTMLElement {
  const cls = r.outcome === 'pass' ? (r.unverified ? 'badge warn' : 'badge ok') : r.outcome === 'fail' ? 'badge bad' : 'badge warn';
  const why = r.outcome === 'unknown' ? t(`criteria.reason.${r.reason ?? 'missing'}`) : r.outcome === 'fail' ? t('criteria.outcome.fail') : r.unverified ? t('criteria.status.unverified') : '';
  return h('span', { class: cls, title: why }, `${r.outcome === 'pass' ? '✓' : r.outcome === 'fail' ? '✗' : '?'} ${describeRule(r.rule)}${why ? ` (${why})` : ''}`);
}

/** Fails and unverified passes as chips; unknown soft rules folded into one expandable chip. */
function notes(r: ReturnType<typeof rank>[number]): Node[] {
  if (r.excluded) return r.results.filter((x) => x.hard && x.outcome === 'fail').map(chip);
  const shown = r.results.filter((x) => x.outcome === 'fail' || x.unverified || (x.hard && x.outcome === 'unknown')).map(chip);
  const unknown = r.results.filter((x) => !x.hard && x.outcome === 'unknown');
  if (unknown.length) shown.push(h('details', { class: 'unknown-rules' }, h('summary', {}, t('criteria.unknown_n', { n: unknown.length })), ...unknown.map(chip)));
  return shown;
}

function select(label: string, kind: string, current: string | undefined, allowNone: boolean, onPick: (id: string) => void): HTMLElement {
  const sel = h('select', { 'aria-label': label, id: `crit-${kind}` },
    ...(allowNone ? [h('option', { value: '' }, t('criteria.none'))] : []),
    ...ofKind(kind).map((s) => h('option', { value: s.id }, t(`criteria.set.${s.id}`))));
  sel.value = current ?? '';
  sel.addEventListener('change', () => onPick(sel.value));
  return h('label', {}, `${label} `, sel);
}

function placesEditor(rerender: () => void): HTMLElement {
  const districts = new Map<string, string[]>();
  for (const n of catalog.neighborhoods) districts.set(n.district ?? '', [...(districts.get(n.district ?? '') ?? []), n.id]);
  const pick = h('select', { 'aria-label': t('criteria.places.pick'), id: 'place-pick' }, ...catalog.neighborhoods.map((n) => h('option', { value: n.id }, t(`neighborhood.${n.id}`))));
  const use = h('button', { type: 'button', id: 'place-use' }, t('criteria.places.use'));
  use.addEventListener('click', () => {
    const n = catalog.neighborhoods.find((x) => x.id === pick.value)!;
    changeNear(n.district ? districts.get(n.district)! : [n.id]);
    rerender();
  });
  const clear = h('button', { type: 'button' }, t('criteria.places.clear'));
  clear.addEventListener('click', () => { changeNear([]); rerender(); });
  const groups = [...districts.entries()].map(([district, ids]) =>
    h('fieldset', { class: 'places' }, h('legend', {}, district ? t(`district.${district}`) : t('criteria.places.no_district')),
      ...ids.map((id) => {
        const box = h('input', { type: 'checkbox', value: id, checked: state.near.includes(id) });
        box.addEventListener('change', () => { changeNear(box.checked ? [...state.near, id] : state.near.filter((x) => x !== id)); rerender(); });
        return h('label', {}, box, ` ${t(`neighborhood.${id}`)}`);
      })));
  return h('details', { class: 'places-editor', open: state.near.length === 0 },
    h('summary', {}, t('criteria.places.heading', { n: state.near.length })),
    h('p', {}, pick, ' ', use, ' ', clear),
    h('p', { class: 'hint' }, t('criteria.places.stored')),
    ...groups);
}

export function renderCriteria(schools: readonly School[], idsFromUrl: string[], rerender: () => void): HTMLElement {
  const selected = (idsFromUrl.length ? idsFromUrl : state.criteria).filter((id) => byId.has(id));
  const sets = selected.map((id) => byId.get(id)!) as CriteriaSet[];
  const save = (ids: string[]) => { changeCriteria(ids); location.hash = `#/criteria/${ids.join('+')}`; };
  const replaceKind = (kind: string, id: string) => save([...selected.filter((x) => byId.get(x)!.kind !== kind), ...(id ? [id] : [])]);
  const current = (kind: string) => selected.find((x) => byId.get(x)!.kind === kind);

  const basics = h('input', { type: 'checkbox', id: 'crit-basics', checked: selected.includes('basics') });
  basics.addEventListener('change', () => replaceKind('basics', basics.checked ? 'basics' : ''));

  const opts = { ctx: state.ctx, near: state.near };
  const usesPlaces = sets.some((s) => [...(s.require ?? []), ...(s.prefer ?? [])].some((r) => r.neighborhood?.editable));
  const results = rank(schools, sets, catalog, opts);
  const kept = results.filter((r) => !r.excluded);
  const excluded = results.filter((r) => r.excluded);

  const ruleList = h('ul', { class: 'rules' }, ...sets.flatMap((s) => [
    ...(s.require ?? []).map((r) => h('li', {}, h('span', { class: 'badge kind' }, t('criteria.hard')), ' ', describeRule(r), r.neighborhood?.editable && state.near.length === 0 ? h('span', { class: 'hint' }, ` — ${t('criteria.places.empty')}`) : '')),
    ...(s.prefer ?? []).map((r) => h('li', {}, h('span', { class: 'badge' }, t('criteria.soft', { w: r.weight ?? 1 })), ' ', describeRule(r))),
  ]));

  const row = (r: (typeof results)[number], i: number) => h('tr', {},
    h('td', { class: 'num' }, r.excluded ? '' : String(i + 1)),
    h('td', {}, h('a', { href: `#/school/${encodeURIComponent(r.school.id)}` }, r.school.name)),
    h('td', {}, r.excluded ? h('span', { class: 'badge bad' }, t('criteria.status.excluded')) : r.unverified ? h('span', { class: 'badge warn' }, t('criteria.status.unverified')) : h('span', { class: 'badge ok' }, t('criteria.status.ok'))),
    h('td', { class: 'num' }, pct(r.score)),
    h('td', { class: 'num' }, pct(r.coverage)),
    h('td', { class: 'chips' }, ...notes(r)),
  );
  const head = () => h('thead', {}, h('tr', {}, ...['rank', 'school', 'status', 'score', 'coverage', 'notes'].map((c) => h('th', {}, t(`criteria.col.${c}`)))));

  return h('section', {},
    h('h1', {}, t('criteria.heading')),
    h('p', { class: 'hint' }, t('criteria.intro')),
    h('div', { class: 'criteria-controls' },
      h('label', {}, basics, ` ${t('criteria.set.basics')}`),
      select(t('criteria.budget'), 'budget', current('budget'), true, (id) => replaceKind('budget', id)),
      select(t('criteria.location'), 'location', current('location'), false, (id) => replaceKind('location', id)),
    ),
    usesPlaces ? placesEditor(rerender) : '',
    h('p', { class: 'hint' }, t('criteria.distance_note')),
    h('details', {}, h('summary', {}, t('criteria.rules')), ruleList),
    h('table', { id: 'criteria-results' }, head(), h('tbody', {}, ...kept.map(row))),
    excluded.length ? h('details', {}, h('summary', {}, t('criteria.excluded', { n: excluded.length })), h('table', {}, head(), h('tbody', {}, ...excluded.map(row)))) : '',
  );
}
