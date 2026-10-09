import { app, state } from '../app.ts';
import { h } from '../dom.ts';
import { formatValue } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { areasOf, entriesOf, pickEntry, type Entity } from '../lib/entity.ts';

export function cell(s: Entity, dimId: string): string {
  const dom = app().domain;
  const picked = pickEntry(dom, s, dimId, state.ctx);
  const dim = dom.byId.get(dimId);
  return picked && dim ? formatValue(dom, dim, picked.entry.v) : '';
}

export const areaText = (s: Entity) => areasOf(s).map((n) => t(`${app().domain.config.locations!.area_label}.${n}`)).join(', ');

export function renderList(entities: readonly Entity[]): HTMLElement {
  const dom = app().domain;
  const { config } = dom;
  const total = dom.dimensions.length;
  const columns = config.display.list_columns;
  // The personal status column appears once the status in use has any entries.
  const mine = state.status?.file.entities ?? {};
  const showStatus = !app().browseOnly && Object.keys(mine).length > 0;
  const rows = entities.map((s) => {
    const known = dom.dimensions.filter((d) => entriesOf(s, d.id).length > 0).length;
    return h(
      'tr',
      {},
      h('td', {}, h('a', { href: `#/${config.entity.route}/${encodeURIComponent(s.id)}` }, String((s as unknown as Record<string, unknown>)[config.display.title] ?? s.id))),
      config.locations ? h('td', {}, areaText(s)) : null,
      ...columns.map((c) => h('td', {}, cell(s, c.dim))),
      h('td', { class: 'num' }, `${known} / ${total}`),
      showStatus ? h('td', { class: 'my-status' }, mine[s.id] ? t(`status.value.${mine[s.id].status}`) : '') : null,
    );
  });
  const heads = [t('list.col.name'), ...(config.locations ? [t('list.col.area')] : []), ...columns.map((c) => t(c.label ?? `dim.${c.dim}`)), t('list.col.known'), ...(showStatus ? [t('status.col')] : [])];
  const dir = config.paths.entities;
  const repo = config.repo;
  return h(
    'section',
    {},
    h('h1', {}, t('list.heading', { n: entities.length })),
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, ...heads.map((c) => h('th', {}, c)))),
      h('tbody', {}, ...rows),
    ),
    h('p', { class: 'hint' }, ...t('list.hint', { dir: '\u0000' }).split('\u0000').flatMap((part, i) => (i === 0 ? [part] : [repo ? h('a', { href: `https://github.com/${repo.name}/tree/${repo.branch}/${dir}` }, dir) : dir, part]))),
  );
}
