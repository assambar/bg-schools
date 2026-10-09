// Entity detail: every known value grouped by catalog group (area), each with its source
// badge, plus an expandable "How to update this" per dimension (retrieval instructions).
import { app, state } from '../app.ts';
import { h } from '../dom.ts';
import { retrievalFor, type Dimension } from '../lib/domain.ts';
import { formatValue } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { entriesOf, hasConflict, pickEntry, resolveSrc, type Entry, type Entity } from '../lib/entity.ts';

function badges(s: Entity, e: Entry): HTMLElement {
  const src = resolveSrc(s, e);
  const scope = e.scope;
  return h(
    'span',
    { class: 'badges' },
    h('span', { class: `badge kind kind-${src.kind}` }, t(`kind.${src.kind}`)),
    src.source_ref ? h('code', { class: 'badge ref', title: t('detail.source_ref') }, src.source_ref) : null,
    src.date ? h('span', { class: 'badge date' }, src.date) : null,
    // Scope axes with fixed values show their labels; others show "<axis> <value>".
    ...app().domain.config.scopes.map((a) => {
      const v = scope?.[a.id];
      if (v === undefined) return null;
      const text = app().domain.scopeValues[a.id] ? ([] as string[]).concat(v).map((x) => t(`${a.id}.${x}`)).join(', ') : t(`scope.${a.id}`, { v: String(v) });
      return h('span', { class: 'badge scope' }, text);
    }),
    src.verified === true ? h('span', { class: 'badge ok' }, t('detail.verified')) : null,
    src.check ? h('span', { class: 'badge warn' }, t(`check.${src.check}`)) : null,
    src.url ? h('a', { class: 'badge link', href: src.url, target: '_blank', rel: 'noopener noreferrer' }, '↗') : null,
  );
}

function howTo(s: Entity, d: Dimension): HTMLElement {
  const override = s.retrieval?.[d.id];
  const r = retrievalFor(app().domain, d.id, override);
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
    override ? h('p', { class: 'hint' }, t('detail.entity_override')) : null,
    h('ol', {}, ...r.steps.map((step) => h('li', {}, step))),
    ...r.methods.map((m) => h('div', { class: 'method' }, h('strong', {}, t(`method.${m.id}`)), h('ol', {}, ...m.steps.map((step) => h('li', {}, step))))),
  );
}

function row(s: Entity, d: Dimension): HTMLElement {
  const list = entriesOf(s, d.id);
  const picked = pickEntry(app().domain, s, d.id, state.ctx);
  const values = list.length === 0
    ? [h('span', { class: 'unknown' }, t('detail.unknown'))]
    : list.map((e) =>
        h(
          'div',
          { class: `entry${picked?.entry === e ? ' picked' : ''}` },
          h('span', { class: 'value' }, formatValue(app().domain, d, e.v)),
          picked?.entry === e && picked.match === 'other' ? h('span', { class: 'badge warn' }, t('detail.other_cycle')) : null,
          badges(s, e),
          e.note ? h('div', { class: 'note' }, e.note) : null,
        ),
      );
  return h(
    'tr',
    { 'data-dim': d.id, class: list.length === 0 ? 'is-unknown' : '' },
    h('th', { scope: 'row' }, t(`dim.${d.id}`), hasConflict(app().domain, s, d.id, state.ctx) ? h('span', { class: 'badge warn' }, t('detail.conflict')) : null),
    h('td', {}, ...values, howTo(s, d)),
  );
}

/** The user's own status for this entity (from the personal status layer), if any. */
function myStatus(s: Entity): HTMLElement | null {
  const m = state.status?.file.entities[s.id];
  if (!m) return null;
  return h('div', { class: 'my-status-box', id: 'my-status' },
    h('strong', {}, `${t('status.col')}: `), t(`status.value.${m.status}`),
    m.gut_feeling !== undefined ? h('span', { class: 'hint' }, ` · ${t('status.gut')}: ${m.gut_feeling}/5`) : null,
    m.updated ? h('span', { class: 'hint' }, ` · ${m.updated}`) : null,
    m.notes ? h('p', { class: 'note' }, m.notes) : null);
}

export function renderDetail(s: Entity): HTMLElement {
  const dom = app().domain;
  const loc = dom.config.locations;
  const known = dom.dimensions.filter((d) => entriesOf(s, d.id).length > 0).length;
  const sub = dom.config.display.subtitle;
  const subtitle = sub ? (s as unknown as Record<string, unknown>)[sub] as string | undefined : undefined;
  const toggle = h('input', { type: 'checkbox', id: 'show-unknown' });
  const root = h(
    'section',
    { class: 'detail hide-unknown' },
    h('p', {}, h('a', { href: '#/' }, t('detail.back')), ' · ', h('a', { href: `#/edit/${encodeURIComponent(s.id)}` }, t('detail.edit'))),
    h('h1', {}, String((s as unknown as Record<string, unknown>)[dom.config.display.title] ?? s.id)),
    subtitle ? h('p', { class: 'hint' }, subtitle) : null,
    loc ? h('h2', {}, t('detail.sites')) : null,
    loc ? h('ul', {}, ...(s.sites ?? []).map((site) => h('li', {}, [site.address, ([] as string[]).concat(site.neighborhood ?? []).map((n) => t(`${loc.area_label}.${n}`)).join(' / ')].filter(Boolean).join(' · ') || site.id))) : null,
    myStatus(s),
    h('p', { class: 'hint' }, t('detail.known', { known, total: dom.dimensions.length }), ' · ', h('label', {}, toggle, ' ', t('detail.show_unknown'))),
    ...dom.groups.map((g) => {
      const dims = dom.dimensions.filter((d) => d.group === g);
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
