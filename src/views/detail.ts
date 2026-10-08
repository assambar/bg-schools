// School detail: every known value grouped by catalog area, each with its source badge,
// plus an expandable "How to update this" per dimension (retrieval instructions).
import { h } from '../dom.ts';
import { retrievalFor, type Dimension } from '../lib/catalog.ts';
import { formatValue } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { entriesOf, hasConflict, pickEntry, resolveSrc, type Entry, type School } from '../lib/school.ts';
import { catalog, state } from '../state.ts';

function badges(s: School, e: Entry): HTMLElement {
  const src = resolveSrc(s, e);
  const scope = e.scope;
  return h(
    'span',
    { class: 'badges' },
    h('span', { class: `badge kind kind-${src.kind}` }, t(`kind.${src.kind}`)),
    src.source_ref ? h('code', { class: 'badge ref', title: t('detail.source_ref') }, src.source_ref) : null,
    src.date ? h('span', { class: 'badge date' }, src.date) : null,
    scope?.year ? h('span', { class: 'badge scope' }, t('scope.year', { v: scope.year })) : null,
    scope?.grade ? h('span', { class: 'badge scope' }, ([] as string[]).concat(scope.grade).map((g) => t(`grade.${g}`)).join(', ')) : null,
    scope?.site ? h('span', { class: 'badge scope' }, t('scope.site', { v: scope.site })) : null,
    src.verified === true ? h('span', { class: 'badge ok' }, t('detail.verified')) : null,
    src.check ? h('span', { class: 'badge warn' }, t(`check.${src.check}`)) : null,
    src.url ? h('a', { class: 'badge link', href: src.url, target: '_blank', rel: 'noopener noreferrer' }, '↗') : null,
  );
}

function howTo(s: School, d: Dimension): HTMLElement {
  const override = s.retrieval?.[d.id];
  const r = retrievalFor(catalog, d.id, override);
  return h(
    'details',
    { class: 'howto' },
    h('summary', {}, t('detail.howto')),
    h(
      'p',
      { class: 'hint' },
      r.cadence ? `${t('detail.cadence')}: ${t(`cadence.${r.cadence}`)}. ` : '',
      r.automatable ? t('detail.automatable') : t('detail.manual_only'),
      '.',
    ),
    override ? h('p', { class: 'hint' }, t('detail.school_override')) : null,
    h('ol', {}, ...r.steps.map((step) => h('li', {}, step))),
    ...r.methods.map((m) => h('div', { class: 'method' }, h('strong', {}, t(`method.${m.id}`)), h('ol', {}, ...m.steps.map((step) => h('li', {}, step))))),
  );
}

function row(s: School, d: Dimension): HTMLElement {
  const list = entriesOf(s, d.id);
  const picked = pickEntry(s, d.id, state.ctx);
  const values = list.length === 0
    ? [h('span', { class: 'unknown' }, t('detail.unknown'))]
    : list.map((e) =>
        h(
          'div',
          { class: `entry${picked?.entry === e ? ' picked' : ''}` },
          h('span', { class: 'value' }, formatValue(d, e.v)),
          picked?.entry === e && picked.match === 'other' ? h('span', { class: 'badge warn' }, t('detail.other_cycle')) : null,
          badges(s, e),
          e.note ? h('div', { class: 'note' }, e.note) : null,
        ),
      );
  return h(
    'tr',
    { 'data-dim': d.id, class: list.length === 0 ? 'is-unknown' : '' },
    h('th', { scope: 'row' }, t(`dim.${d.id}`), hasConflict(s, d.id, state.ctx) ? h('span', { class: 'badge warn' }, t('detail.conflict')) : null),
    h('td', {}, ...values, howTo(s, d)),
  );
}

export function renderDetail(s: School): HTMLElement {
  const known = catalog.dimensions.filter((d) => entriesOf(s, d.id).length > 0).length;
  const toggle = h('input', { type: 'checkbox', id: 'show-unknown' });
  const root = h(
    'section',
    { class: 'detail hide-unknown' },
    h('p', {}, h('a', { href: '#/' }, t('detail.back')), ' · ', h('a', { href: `#/edit/${encodeURIComponent(s.id)}` }, t('detail.edit'))),
    h('h1', {}, s.name),
    s.name_en ? h('p', { class: 'hint' }, s.name_en) : null,
    h('h2', {}, t('detail.sites')),
    h('ul', {}, ...s.sites.map((site) => h('li', {}, [site.address, ([] as string[]).concat(site.neighborhood ?? []).map((n) => t(`neighborhood.${n}`)).join(' / ')].filter(Boolean).join(' · ') || site.id))),
    h('p', { class: 'hint' }, t('detail.known', { known, total: catalog.dimensions.length }), ' · ', h('label', {}, toggle, ' ', t('detail.show_unknown'))),
    ...catalog.groups.map((g) => {
      const dims = catalog.dimensions.filter((d) => d.group === g);
      const knownInGroup = dims.some((d) => entriesOf(s, d.id).length > 0);
      return h(
        'div',
        { class: `group${knownInGroup ? '' : ' is-unknown'}`, 'data-group': g },
        h('h2', {}, t(`group.${g}`)),
        h('table', { class: 'values' }, h('tbody', {}, ...dims.map((d) => row(s, d)))),
      );
    }),
  );
  toggle.addEventListener('change', () => root.classList.toggle('hide-unknown', !toggle.checked));
  return root;
}
