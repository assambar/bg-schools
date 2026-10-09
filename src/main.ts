import './style.css';
import schools from 'virtual:schools';
import { h } from './dom.ts';
import { t } from './lib/i18n.ts';
import './state.ts';
import { renderCriteria } from './views/criteria.ts';
import { renderDetail } from './views/detail.ts';
import { renderEditor } from './views/editor.ts';
import { renderHeader } from './views/header.ts';
import { renderList } from './views/list.ts';

const app = document.getElementById('app')!;
const top = document.getElementById('top')!;

// Hash routing (GitHub Pages has no server-side rewrites):
//   #/              list
//   #/school/<id>   detail
//   #/new           add a school
//   #/edit/<id>     edit a school's YAML
//   #/criteria[/<set>+<set>...]   rank schools by criteria sets
function route(): void {
  document.title = t('app.title');
  top.replaceChildren(renderHeader(route));
  const [page, rawId] = location.hash.replace(/^#\/?/, '').split('/');
  const id = rawId ? decodeURIComponent(rawId) : '';
  const school = schools.find((s) => s.id === id);
  const notFound = () => h('p', {}, t('detail.not_found', { id }), ' ', h('a', { href: '#/' }, t('detail.back')));
  let view: HTMLElement;
  if (page === 'new') view = renderEditor(undefined, schools);
  else if (page === 'edit') view = school ? renderEditor(school, schools) : notFound();
  else if (page === 'school') view = school ? renderDetail(school) : notFound();
  else if (page === 'criteria') view = renderCriteria(schools, id ? id.split('+') : [], route);
  else view = renderList(schools);
  app.replaceChildren(view);
}

window.addEventListener('hashchange', () => {
  route();
  window.scrollTo(0, 0);
});
route();
