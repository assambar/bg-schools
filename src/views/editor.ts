// YAML editor: edit a school file in the browser, validated live against the catalog.
// On copy / download, changed values get provenance "user-edit" with today's date.
import { h } from '../dom.ts';
import type { Dimension } from '../lib/catalog.ts';
import { readField, writeField } from '../lib/editor-fields.ts';
import { t } from '../lib/i18n.ts';
import { filePath, githubEditFileUrl, githubNewFileUrl, stampUserEdits, toYaml, type School } from '../lib/school.ts';
import { validateYaml } from '../lib/validate.ts';
import { catalog } from '../state.ts';

const TEMPLATE = `id: new-school
name: New school
sites:
  - id: main
    address: ""
values: {}
`;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Form fields for the catalog's `editor_fields`: checkboxes for multi_enum (several values
 * at once), radio buttons for enum, one checkbox for bool. They edit the YAML text.
 */
function formFields(area: HTMLTextAreaElement, onEdit: () => void): { root: HTMLElement; sync: () => void } {
  const syncs: (() => void)[] = [];
  const fieldsets = catalog.editorFields.map((id) => {
    const d = catalog.byId.get(id) as Dimension;
    const name = `field-${id}`;
    const options: [string, unknown][] = d.type === 'bool' ? [['true', true]] : (catalog.valueSets[d.values!] ?? []).map((v) => [v, v]);
    const inputs = options.map(([key]) => h('input', { type: d.type === 'enum' ? 'radio' : 'checkbox', name, value: key }));
    const note = h('span', { class: 'hint' });
    const read = (): unknown => {
      const on = options.filter((_, i) => inputs[i].checked).map(([, v]) => v);
      if (d.type === 'multi_enum') return on;
      if (d.type === 'bool') return inputs[0].checked;
      return on[0];
    };
    for (const input of inputs) {
      input.addEventListener('change', () => {
        area.value = writeField(area.value, d, read(), today());
        onEdit();
      });
    }
    syncs.push(() => {
      const f = readField(area.value, id);
      const value = f.state === 'ok' ? f.value : undefined;
      const picked = ([] as unknown[]).concat(value ?? []);
      options.forEach(([, v], i) => {
        inputs[i].checked = picked.includes(v);
        inputs[i].disabled = f.state !== 'ok';
      });
      note.textContent = f.state === 'several' ? t('editor.field_several') : f.state === 'invalid' ? t('editor.field_fix_yaml') : '';
    });
    return h('fieldset', { class: 'form-field', 'data-dim': id },
      h('legend', {}, t(`dim.${id}`)),
      ...options.map(([key], i) => h('label', {}, inputs[i], ' ', d.type === 'bool' ? t('value.yes') : t(`enum.${d.values}.${key}`))),
      note);
  });
  const root = fieldsets.length ? h('div', { class: 'form-fields' }, h('p', { class: 'hint' }, t('editor.fields')), ...fieldsets) : h('div', {});
  return { root, sync: () => syncs.forEach((f) => f()) };
}

export function renderEditor(existing: School | undefined, all: readonly School[]): HTMLElement {
  const isNew = !existing;
  const area = h('textarea', { rows: '28', spellcheck: 'false', id: 'yaml', class: 'yaml' });
  area.value = existing ? toYaml(existing, catalog) : TEMPLATE;
  const summary = h('div', { class: 'summary', 'aria-live': 'polite' });
  const copyButton = h('button', { type: 'button' }, t('editor.copy'));
  const downloadButton = h('button', { type: 'button' }, t('editor.download'));
  const githubLink = h('a', { class: 'button', target: '_blank', rel: 'noopener noreferrer' }, t('editor.github'));
  const status = h('span', { class: 'hint', 'aria-live': 'polite' });
  let output = '';
  let id = '';
  const fields = formFields(area, () => update());

  function update(): void {
    fields.sync();
    const { school, errors } = validateYaml(area.value, catalog, all, isNew);
    const valid = errors.length === 0 && school !== undefined;
    summary.className = `summary ${valid ? 'ok' : 'bad'}`;
    summary.replaceChildren(valid ? t('editor.valid') : h('span', {}, t('editor.problems', { n: errors.length }), h('ul', {}, ...errors.slice(0, 12).map((e) => h('li', {}, e)))));
    if (valid) {
      const stamped = stampUserEdits(existing, school, today());
      output = toYaml(stamped, catalog);
      id = school.id;
      githubLink.href = isNew ? githubNewFileUrl(id, output) : githubEditFileUrl(id);
      githubLink.removeAttribute('aria-disabled');
    } else {
      githubLink.removeAttribute('href');
      githubLink.setAttribute('aria-disabled', 'true');
    }
    copyButton.disabled = !valid;
    downloadButton.disabled = !valid;
    status.textContent = '';
  }

  area.addEventListener('input', update);
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output);
      status.textContent = t('editor.copied');
    } catch {
      status.textContent = t('editor.copy_failed');
    }
  });
  downloadButton.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([output], { type: 'text/yaml' }));
    h('a', { href: url, download: `${id}.yaml` }).click();
    URL.revokeObjectURL(url);
  });
  update();

  return h(
    'section',
    { class: 'editor' },
    h('p', {}, h('a', { href: existing ? `#/school/${encodeURIComponent(existing.id)}` : '#/' }, t('detail.back'))),
    h('h1', {}, isNew ? t('editor.title_new') : t('editor.title_edit', { name: existing.name })),
    h('p', { class: 'hint' }, t('editor.intro'), ' ', h('code', {}, filePath(existing?.id ?? '<id>'))),
    fields.root,
    area,
    summary,
    h('div', { class: 'actions' }, copyButton, downloadButton, githubLink, status),
    h('p', { class: 'hint' }, isNew ? t('editor.hint_new') : t('editor.hint_edit')),
  );
}
