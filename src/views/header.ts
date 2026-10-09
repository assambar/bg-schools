import schools from 'virtual:schools';
import { h } from '../dom.ts';
import { dictionaries, LANGS, t } from '../lib/i18n.ts';
import type { Entry } from '../lib/school.ts';
import { catalog, changeContext, changeLang, state } from '../state.ts';

/** Years offered in the context picker: the default plus every year used in the data. */
function years(): string[] {
  const set = new Set([catalog.defaultContext.year]);
  for (const s of schools) {
    for (const v of Object.values(s.values).flat() as Entry[]) if (v.scope?.year) set.add(v.scope.year);
  }
  return [...set].sort();
}

export function renderHeader(rerender: () => void): HTMLElement {
  const lang = h('select', { 'aria-label': t('lang.label'), id: 'lang' }, ...LANGS.map((l) => h('option', { value: l }, dictionaries[l]['_meta.name'] ?? l)));
  lang.value = state.lang;
  lang.addEventListener('change', () => {
    changeLang(lang.value);
    rerender();
  });

  const year = h('select', { 'aria-label': t('context.year'), id: 'ctx-year' }, ...years().map((y) => h('option', { value: y }, y)));
  year.value = state.ctx.year;
  const grade = h('select', { 'aria-label': t('context.grade'), id: 'ctx-grade' }, ...catalog.grades.map((g) => h('option', { value: g.id }, t(`grade.${g.id}`))));
  grade.value = state.ctx.grade;
  const onCtx = () => {
    changeContext({ year: year.value, grade: grade.value });
    rerender();
  };
  year.addEventListener('change', onCtx);
  grade.addEventListener('change', onCtx);

  return h(
    'header',
    {},
    h('a', { href: '#/', class: 'brand' }, t('app.title')),
    h('nav', {}, h('a', { href: '#/' }, t('nav.schools')), h('a', { href: '#/new' }, t('nav.add'))),
    h('div', { class: 'controls' }, h('span', { class: 'hint' }, t('context.label')), year, grade, lang),
  );
}
