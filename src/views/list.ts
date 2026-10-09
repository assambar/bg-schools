import { h } from '../dom.ts';
import { formatValue } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { BRANCH, DATA_DIR, REPO, entriesOf, neighborhoodsOf, pickEntry, type School } from '../lib/school.ts';
import { catalog, state } from '../state.ts';

export function cell(s: School, dimId: string): string {
  const picked = pickEntry(s, dimId, state.ctx);
  const dim = catalog.byId.get(dimId);
  return picked && dim ? formatValue(dim, picked.entry.v) : '';
}

export const areaText = (s: School) => neighborhoodsOf(s).map((n) => t(`neighborhood.${n}`)).join(', ');

export function renderList(schools: readonly School[]): HTMLElement {
  const total = catalog.dimensions.length;
  const rows = schools.map((s) => {
    const known = catalog.dimensions.filter((d) => entriesOf(s, d.id).length > 0).length;
    return h(
      'tr',
      {},
      h('td', {}, h('a', { href: `#/school/${encodeURIComponent(s.id)}` }, s.name)),
      h('td', {}, areaText(s)),
      h('td', {}, cell(s, 'ages_accepted')),
      h('td', {}, cell(s, 'tuition')),
      h('td', { class: 'num' }, `${known} / ${total}`),
    );
  });
  return h(
    'section',
    {},
    h('h1', {}, t('list.heading', { n: schools.length })),
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, ...['name', 'area', 'ages', 'tuition', 'known'].map((c) => h('th', {}, t(`list.col.${c}`))))),
      h('tbody', {}, ...rows),
    ),
    h('p', { class: 'hint' }, ...t('list.hint', { dir: '\u0000' }).split('\u0000').flatMap((part, i) => (i === 0 ? [part] : [h('a', { href: `https://github.com/${REPO}/tree/${BRANCH}/${DATA_DIR}` }, DATA_DIR), part]))),
  );
}
