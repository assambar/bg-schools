import { h } from './dom.ts';
import { BRANCH, DATA_DIR, REPO, type School } from './lib/school.ts';

export function renderList(schools: readonly School[]): HTMLElement {
  const rows = schools.map((s) =>
    h(
      'tr',
      {},
      h('td', {}, h('a', { href: `#/edit/${encodeURIComponent(s.id)}` }, s.name)),
      h('td', {}, s.district ?? ''),
      h('td', {}, h('span', { class: `status status-${s.status}` }, s.status)),
      h('td', {}, s.open_day ?? ''),
      h('td', { class: 'notes' }, s.notes ?? ''),
    ),
  );
  return h(
    'section',
    {},
    h('h1', {}, `Schools (${schools.length})`),
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'District'), h('th', {}, 'Status'), h('th', {}, 'Open day'), h('th', {}, 'Notes')),
      ),
      h('tbody', {}, ...rows),
    ),
    h(
      'p',
      { class: 'hint' },
      'Data comes from the YAML files in ',
      h('a', { href: `https://github.com/${REPO}/tree/${BRANCH}/${DATA_DIR}` }, DATA_DIR),
      '. Changes go through pull requests and appear here after merge.',
    ),
  );
}
