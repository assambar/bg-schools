import './style.css';
import schools from 'virtual:schools';
import { renderEditor } from './editor.ts';
import { renderList } from './list.ts';
import { h } from './dom.ts';

const app = document.getElementById('app')!;

// Hash routing: GitHub Pages has no server-side rewrites.
//   #/            list
//   #/new         add a school
//   #/edit/<id>   edit an existing school
function route(): void {
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, id] = hash.split('/');
  let view: HTMLElement;
  if (page === 'new') {
    view = renderEditor(undefined, schools);
  } else if (page === 'edit' && id) {
    const school = schools.find((s) => s.id === decodeURIComponent(id));
    view = school
      ? renderEditor(school, schools)
      : h('p', {}, 'No school with id "', decodeURIComponent(id), '". ', h('a', { href: '#/' }, 'Back to list'));
  } else {
    view = renderList(schools);
  }
  app.replaceChildren(view);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
