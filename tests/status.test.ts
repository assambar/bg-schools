// @vitest-environment happy-dom
// Personal status layer: one GitHub token, exactly one private repository, a status file
// that validates against the generated status schema. GitHub is mocked.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, connect, criteriaSets, disconnect, initApp, reconnect, state } from '../src/app.ts';
import { checkCriteriaDir, checkDataDir, checkDefaultStatus } from '../scripts/check-data.ts';
import { createAjv } from '../scripts/load-domain.ts';
import { setLang } from '../src/lib/i18n.ts';
import { buildStatusSchema } from '../src/lib/schema-gen.ts';
import { connectStatus, parseStatus } from '../src/lib/status.ts';
import { renderCriteria } from '../src/views/criteria.ts';
import { renderDetail } from '../src/views/detail.ts';
import { renderHeader } from '../src/views/header.ts';
import { renderList } from '../src/views/list.ts';
import { errorText, renderStatus } from '../src/views/status.ts';
import { setup } from './helpers.ts';

const { dom, validate, i18n } = setup();
const { entities } = checkDataDir(dom.config.paths.entities, dom);
const { sets } = checkCriteriaDir(dom.config.paths.criteria, dom);
const statusValidate = createAjv().compile(buildStatusSchema(dom));
const statusDefault = checkDefaultStatus(dom, entities.map((e) => e.id), sets.map((s) => s.id)).file!;
const ids = entities.map((e) => e.id);
const setIds = sets.map((s) => s.id);

const VALID = `kind: status
domain: schools
entities:
  germani: { status: to_visit, notes: Open day in November., gut_feeling: 4, updated: 2026-10-09 }
  anika: { status: rejected }
criteria: [basics, my-budget, location-near]
near: [izgrev]
budget: { amount: 700, currency: EUR, per: month }
`;

type Route = { status?: number; body: unknown; link?: string };
/** A fake api.github.com: path -> response. Records every URL and Authorization header. */
function github(routes: Record<string, Route>) {
  const calls: { url: string; auth?: string }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization });
    const path = url.replace('https://api.github.com', '');
    const r = routes[path];
    if (!r) return new Response('{"message":"Not Found"}', { status: 404 });
    const headers = new Headers(r.link ? { link: r.link } : {});
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status ?? 200, headers });
  };
  return { fetchFn, calls };
}
const REPOS = '/user/repos?visibility=private&per_page=100';
const priv = (n: string) => ({ full_name: n, private: true });
const file = (name: string, path = name) => ({ name, path, type: 'file' });
const dir = (name: string) => ({ name, path: name, type: 'dir' });
const run = (routes: Record<string, Route>) => {
  const gh = github(routes);
  return { gh, result: connectStatus('github_pat_TEST', dom, statusValidate, ids, [...setIds, 'my-budget'], gh.fetchFn) };
};

beforeEach(() => {
  localStorage.clear();
  initApp({ domain: dom, entities, criteria: sets, validate, i18n, statusValidate, statusDefault });
  setLang('en');
});

describe('status files', () => {
  it('the public default file is valid and neutral', () => {
    expect(statusDefault).toEqual({ kind: 'status', domain: 'schools', entities: {} });
    expect(state.status).toEqual({ file: statusDefault });
  });

  it('validates shape, ids and domain', () => {
    expect(parseStatus(VALID, dom, statusValidate, ids, [...setIds, 'my-budget']).errors).toEqual([]);
    expect(parseStatus(VALID.replace('to_visit', 'maybe'), dom, statusValidate, ids, setIds).errors.join()).toMatch(/\/entities\/germani\/status/);
    expect(parseStatus(VALID.replace('germani:', 'nowhere:').replace('my-budget, ', ''), dom, statusValidate, ids, setIds).errors).toEqual(['entities: unknown id "nowhere"']);
    expect(parseStatus(VALID.replace('domain: schools', 'domain: laptops'), dom, statusValidate, ids, [...setIds, 'my-budget']).errors).toEqual(['domain is "laptops", expected "schools"']);
  });
});

describe('connecting a token (mocked GitHub)', () => {
  it('rejects a token GitHub does not accept', async () => {
    expect(await run({ [REPOS]: { status: 401, body: {} } }).result).toEqual({ ok: false, error: { key: 'status.err.token_invalid' } });
  });

  it('0 private repositories: public ones do not count', async () => {
    const { result } = run({ [REPOS]: { body: [{ full_name: 'someone/public', private: false }] } });
    expect(await result).toEqual({ ok: false, error: { key: 'status.err.no_private' } });
  });

  it('more than one private repository (across pages): too wide', async () => {
    const { result, gh } = run({
      [REPOS]: { body: [priv('me/status')], link: '<https://api.github.com/user/repos?visibility=private&per_page=100&page=2>; rel="next"' },
      [`${REPOS}&page=2`]: { body: [priv('me/other'), { full_name: 'x/pub', private: false }] },
    });
    const r = await result;
    expect(r).toEqual({ ok: false, error: { key: 'status.err.too_wide', params: { n: 2 } } });
    expect(gh.calls.length).toBe(2);
    if (!r.ok) expect(errorText(r.error)).toBe('The token is too wide: it can access 2 private repositories. Scope it to just your status repository.');
  });

  it('one private repository without status files: lists what it found', async () => {
    const { result } = run({ [REPOS]: { body: [priv('me/status')] }, '/repos/me/status/contents/': { body: [file('README.md'), dir('notes')] } });
    expect(await result).toEqual({ ok: false, error: { key: 'status.err.no_files', params: { repo: 'me/status', found: 'README.md, notes/' } } });
  });

  it('one private repository with only invalid files: says why each failed', async () => {
    const { result } = run({
      [REPOS]: { body: [priv('me/status')] },
      '/repos/me/status/contents/': { body: [file('my.status.yaml'), dir('status')] },
      '/repos/me/status/contents/status': { body: [file('home.yaml', 'status/home.yaml'), file('notes.md', 'status/notes.md')] },
      '/repos/me/status/contents/my.status.yaml': { body: 'kind: status\ndomain: schools\nentities: { germani: { status: maybe } }\n' },
      '/repos/me/status/contents/status/home.yaml': { body: 'just: text\n' },
    });
    const r = await result;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.key).toBe('status.err.none_valid');
    const why = (r.error as { params: { why: string } }).params.why;
    expect(why).toMatch(/^my\.status\.yaml: \/entities\/germani\/status must be equal to one of the allowed values/);
    expect(why).toMatch(/status\/home\.yaml: \(root\) must have required property 'kind'/);
  });

  it('one private repository with a valid file: loads it, sending the token only to api.github.com', async () => {
    const { result, gh } = run({
      [REPOS]: { body: [{ full_name: 'pub/lic', private: false }, priv('me/status')] },
      '/repos/me/status/contents/': { body: [file('README.md'), file('family.status.yaml')] },
      '/repos/me/status/contents/family.status.yaml': { body: VALID },
    });
    const r = await result;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toMatchObject({ repo: 'me/status', path: 'family.status.yaml', file: { entities: { anika: { status: 'rejected' } } } });
    expect(gh.calls.every((c) => c.url.startsWith('https://api.github.com/') && c.auth === 'Bearer github_pat_TEST')).toBe(true);
  });
});

describe('the app with a personal status', () => {
  const routes = {
    [REPOS]: { body: [priv('me/status')] },
    '/repos/me/status/contents/': { body: [file('family.status.yaml')] },
    '/repos/me/status/contents/family.status.yaml': { body: VALID },
  };

  it('overlays status, criteria, areas and budget; the token stays in memory unless remembered', async () => {
    expect(await connect('github_pat_TEST', false, github(routes).fetchFn)).toBeUndefined();
    expect(localStorage.length).toBe(0);
    expect(state.criteria).toEqual(['basics', 'my-budget', 'location-near']);
    expect(state.near).toEqual(['izgrev']);
    expect(criteriaSets().find((s) => s.id === 'my-budget')).toEqual({ id: 'my-budget', kind: 'budget', require: [{ dim: 'tuition', lte: { amount: 700, currency: 'EUR', per: 'month' } }] });

    const banner = renderHeader(() => {})[1];
    expect(banner.textContent).toContain('Personal status loaded from me/status (family.status.yaml)');
    const list = renderList(app().entities);
    expect([...list.querySelectorAll('th')].map((x) => x.textContent).at(-1)).toBe('My status');
    const anika = [...list.querySelectorAll('tbody tr')].find((r) => r.querySelector('a')!.getAttribute('href') === '#/school/anika')!;
    expect(anika.querySelector('.my-status')!.textContent).toBe('Rejected');
    const detail = renderDetail(entities.find((e) => e.id === 'germani')!);
    expect(detail.querySelector('#my-status')!.textContent).toBe('My status: To visit · Gut feeling: 4/5 · 2026-10-09Open day in November.');
    const crit = renderCriteria(app().entities, [], () => {});
    expect(crit.querySelector<HTMLSelectElement>('#crit-budget')!.selectedOptions[0].textContent).toBe('My budget: up to €700 / month');

    banner.querySelector<HTMLButtonElement>('#status-disconnect')!.click();
    expect(state.status).toEqual({ file: statusDefault });
    expect(state.criteria).toEqual(dom.config.criteria.default_selection);
    expect(renderHeader(() => {}).length).toBe(1);
    expect(renderList(app().entities).querySelector('.my-status')).toBeNull();
  });

  it('remembers the token only on opt-in, reconnects with it, and forgets it on disconnect', async () => {
    const gh = github(routes);
    await connect('github_pat_TEST', true, gh.fetchFn);
    expect(localStorage.getItem('bg-schools.status-token')).toBe('github_pat_TEST');
    initApp({ domain: dom, entities, criteria: sets, validate, i18n, statusValidate, statusDefault });
    expect(state.status?.repo).toBeUndefined();
    expect(await reconnect(gh.fetchFn)).toBeUndefined();
    expect(state.status?.repo).toBe('me/status');
    disconnect();
    expect(localStorage.getItem('bg-schools.status-token')).toBeNull();
  });

  it('renders the settings page in both languages', () => {
    const en = renderStatus(() => {});
    expect(en.querySelector('#status-token')!.getAttribute('type')).toBe('password');
    expect(en.querySelector<HTMLInputElement>('#status-remember')!.checked).toBe(false);
    expect(en.textContent).toContain('No token connected: showing the public default status file (domains/schools/status.default.yaml).');
    setLang('bg');
    expect(renderStatus(() => {}).querySelector('h1')!.textContent).toBe('Личен статус');
  });

  it('README documents the recommended token setup', () => {
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toMatch(/Contents: read-only/);
  });
});
