import { h } from '../dom.ts';
import { t } from '../lib/i18n.ts';

/** The standing disclaimers of the Paths and Finance pages (also in the site footer). */
export function disclaimers(): HTMLElement {
  return h(
    'aside',
    { class: 'disclaimer', 'aria-label': t('disclaimer.label') },
    h('p', {}, h('strong', {}, t('disclaimer.ai.title')), ' ', t('disclaimer.ai')),
    h('p', {}, h('strong', {}, t('disclaimer.finance.title')), ' ', t('disclaimer.finance')),
  );
}

/** Site footer on every page: about, data note and the disclaimers. */
export function renderFooter(): HTMLElement[] {
  return [
    h('p', {}, h('strong', {}, t('footer.about.title')), ' ', t('footer.about'), ' ',
      h('a', { href: 'https://github.com/assambar/bg-schools' }, t('footer.source'))),
    h('p', { class: 'hint' }, t('disclaimer.ai')),
    h('p', { class: 'hint' }, t('disclaimer.finance')),
  ];
}
