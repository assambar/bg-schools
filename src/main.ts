import './style.css';
import data from 'virtual:domain';
import entities from 'virtual:entities';
import criteria from 'virtual:criteria';
import validate from 'virtual:entity-validator';
import statusValidate from 'virtual:status-validator';
import { app, initApp, reconnect, state } from './app.ts';
import { h } from './dom.ts';
import { buildDomain, mergeRetrieval } from './lib/domain.ts';
import { t } from './lib/i18n.ts';
import { renderCriteria } from './views/criteria.ts';
import { renderDetail } from './views/detail.ts';
import { renderEditor } from './views/editor.ts';
import { renderHeader } from './views/header.ts';
import { renderList } from './views/list.ts';
import { renderStatus } from './views/status.ts';

const domain = buildDomain(data.files);
for (const overlay of data.overlays) mergeRetrieval(domain, overlay); // checked at build time
initApp({ domain, entities, criteria, validate, i18n: data.i18n, statusValidate, statusDefault: data.statusDefault });

const main = document.getElementById('app')!;
const top = document.getElementById('top')!;

// Hash routing (GitHub Pages has no server-side rewrites):
//   #/              list
//   #/<route>/<id>  detail (route from the domain config, e.g. school)
//   #/new           add an entity
//   #/edit/<id>     edit an entity's YAML
//   #/criteria[/<set>+<set>...]   rank entities by criteria sets
//   #/status        connect a personal status file (domains with `status`)
function route(): void {
  document.title = t('app.title');
  top.replaceChildren(...renderHeader(route));
  const [page, rawId] = location.hash.replace(/^#\/?/, '').split('/');
  const id = rawId ? decodeURIComponent(rawId) : '';
  const entity = app().entities.find((s) => s.id === id);
  const notFound = () => h('p', {}, t('detail.not_found', { id }), ' ', h('a', { href: '#/' }, t('detail.back')));
  let view: HTMLElement;
  if (page === 'new') view = renderEditor(undefined, entities);
  else if (page === 'edit') view = entity ? renderEditor(entity, entities) : notFound();
  else if (page === app().domain.config.entity.route) view = entity ? renderDetail(entity) : notFound();
  else if (page === 'status' && app().domain.config.status) view = renderStatus(route);
  else if (page === 'criteria') view = renderCriteria(entities, id ? id.split('+') : [], route);
  else view = renderList(entities);
  main.replaceChildren(view);
}

window.addEventListener('hashchange', () => {
  route();
// A remembered token reconnects in the background; a failure is shown on the status page.
void reconnect().then(() => { if (state.status?.repo) route(); });
  window.scrollTo(0, 0);
});
route();
// A remembered token reconnects in the background; a failure is shown on the status page.
void reconnect().then(() => { if (state.status?.repo) route(); });
