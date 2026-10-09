// Personal status page: connect one GitHub token that can read exactly one private
// repository holding your status file. Read-only; the token goes only to api.github.com.
import { app, connect, disconnect, isRemembered, state } from '../app.ts';
import { h } from '../dom.ts';
import { t } from '../lib/i18n.ts';
import type { ConnectError } from '../lib/status.ts';

export const errorText = (e: ConnectError): string => t(e.key, 'params' in e ? (e.params as Record<string, string | number>) : {});

/** "Personal status loaded from owner/repo" with a disconnect button, or nothing. */
export function statusBanner(rerender: () => void): HTMLElement | null {
  const s = state.status;
  if (!s?.repo) return null;
  const off = h('button', { type: 'button', id: 'status-disconnect' }, t('status.disconnect'));
  off.addEventListener('click', () => { disconnect(); rerender(); });
  return h('div', { class: 'status-banner', role: 'status' }, t('status.loaded', { repo: s.repo, path: s.path ?? '' }), ' ', off);
}

export function renderStatus(rerender: () => void): HTMLElement {
  const input = h('input', { type: 'password', id: 'status-token', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…', 'aria-label': t('status.token_label') });
  const remember = h('input', { type: 'checkbox', id: 'status-remember', checked: isRemembered() });
  const go = h('button', { type: 'button', id: 'status-connect' }, t('status.connect'));
  const out = h('p', { class: 'summary', id: 'status-result', 'aria-live': 'polite' });
  out.hidden = true;
  go.addEventListener('click', async () => {
    if (!input.value.trim()) return;
    go.disabled = true;
    out.hidden = false;
    out.className = 'summary';
    out.textContent = t('status.connecting');
    const err = await connect(input.value.trim(), remember.checked);
    input.value = '';
    go.disabled = false;
    if (err) {
      out.className = 'summary bad';
      out.textContent = errorText(err);
    } else {
      rerender();
    }
  });
  const s = state.status;
  const n = s ? Object.keys(s.file.entities).length : 0;
  const current = s?.repo
    ? h('p', { class: 'summary ok' }, t('status.loaded', { repo: s.repo, path: s.path ?? '' }), ' · ', t('status.count', { n }))
    : h('p', { class: 'hint' }, t('status.default_note', { path: app().domain.config.status?.default ?? '' }));
  return h('section', { class: 'status-page' },
    h('h1', {}, t('status.heading')),
    h('p', {}, t('status.intro')),
    current,
    h('div', { class: 'field' }, h('label', { for: 'status-token' }, t('status.token_label')), input),
    h('p', {}, h('label', { class: 'inline' }, remember, ' ', t('status.remember'))),
    h('p', { class: 'hint warn-text' }, t('status.remember_warning')),
    h('p', {}, go),
    out,
    h('h2', {}, t('status.setup_heading')),
    h('ol', {}, ...['1', '2', '3', '4'].map((i) => h('li', {}, t(`status.setup.${i}`)))),
  );
}
