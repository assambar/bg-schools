import { app, changeContext, changeLang, state } from '../app.ts';
import { h } from '../dom.ts';
import { contextAxes, type ScopeAxis } from '../lib/domain.ts';
import { dictionaries, LANGS, t } from '../lib/i18n.ts';
import type { Entry } from '../lib/entity.ts';

/** Options for a context axis: its fixed values, or the default plus every value used in the data. */
function options(axis: ScopeAxis): { id: string; label: string }[] {
  const fixed = app().domain.scopeValues[axis.id];
  if (fixed) return fixed.map((v) => ({ id: v.id, label: t(`${axis.id}.${v.id}`) }));
  const set = new Set([axis.context!.default]);
  for (const s of app().entities) {
    for (const v of Object.values(s.values).flat() as Entry[]) {
      const x = v.scope?.[axis.id];
      if (x !== undefined) for (const y of ([] as string[]).concat(x)) set.add(y);
    }
  }
  return [...set].sort().map((id) => ({ id, label: id }));
}

export function renderHeader(rerender: () => void): HTMLElement {
  const dom = app().domain;
  const lang = h('select', { 'aria-label': t('lang.label'), id: 'lang' }, ...LANGS.map((l) => h('option', { value: l }, dictionaries[l]['_meta.name'] ?? l)));
  lang.value = state.lang;
  lang.addEventListener('change', () => {
    changeLang(lang.value);
    rerender();
  });

  const axes = contextAxes(dom);
  const selects = axes.map((a) => {
    const sel = h('select', { 'aria-label': t(`context.${a.id}`), id: `ctx-${a.id}` }, ...options(a).map((o) => h('option', { value: o.id }, o.label)));
    sel.value = state.ctx[a.id];
    return sel;
  });
  const onCtx = () => {
    changeContext(Object.fromEntries(axes.map((a, i) => [a.id, selects[i].value])));
    rerender();
  };
  for (const sel of selects) sel.addEventListener('change', onCtx);

  return h(
    'header',
    {},
    h('a', { href: '#/', class: 'brand' }, t('app.title')),
    h('nav', {}, h('a', { href: '#/' }, t('nav.list')), h('a', { href: '#/criteria' }, t('nav.criteria')), h('a', { href: '#/new' }, t('nav.add'))),
    h('div', { class: 'controls' }, axes.length ? h('span', { class: 'hint' }, t('context.label')) : '', ...selects, lang),
  );
}
