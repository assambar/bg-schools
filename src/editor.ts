import { h } from './dom.ts';
import {
  STATUSES,
  TYPES,
  filePath,
  githubEditFileUrl,
  githubNewFileUrl,
  normalize,
  slugify,
  toYaml,
  type School,
} from './lib/school.ts';
import { validateEntry } from './lib/validate.ts';

type FieldName = 'name' | 'id' | 'type' | 'status' | 'district' | 'website' | 'open_day' | 'notes';
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Add (existing = undefined) or edit a school. Everything happens in the browser. */
export function renderEditor(existing: School | undefined, all: readonly School[]): HTMLElement {
  const isNew = !existing;
  // A new entry may not reuse an existing id; an edited entry keeps its id (= its file name).
  const takenIds = isNew ? all.map((s) => s.id) : [];
  let idTouched = !isNew;

  const controls = {} as Record<FieldName, Control>;
  const errorSlots = {} as Record<FieldName, HTMLElement>;

  function field(name: FieldName, label: string, control: Control, hint?: string): HTMLElement {
    control.id = `f-${name}`;
    control.name = name;
    controls[name] = control;
    errorSlots[name] = h('small', { class: 'error', 'aria-live': 'polite' });
    return h(
      'div',
      { class: 'field' },
      h('label', { for: control.id }, label),
      control,
      hint ? h('small', { class: 'hint' }, hint) : null,
      errorSlots[name],
    );
  }

  const select = (options: readonly string[], blank?: string) =>
    h('select', {}, blank !== undefined ? h('option', { value: '' }, blank) : null, ...options.map((o) => h('option', { value: o }, o)));

  const form = h(
    'form',
    { class: 'editor-form', novalidate: true },
    field('name', 'Name *', h('input', { type: 'text', autocomplete: 'off' })),
    field(
      'id',
      'ID *',
      h('input', { type: 'text', autocomplete: 'off', readonly: !isNew }),
      isNew ? 'Lowercase words joined by dashes. Becomes the file name.' : 'The ID is the file name and can’t be changed here.',
    ),
    field('status', 'Status *', select(STATUSES)),
    field('type', 'Type', select(TYPES, '— not set —')),
    field('district', 'District', h('input', { type: 'text' })),
    field('website', 'Website', h('input', { type: 'text', inputmode: 'url', placeholder: 'https://' })),
    field('open_day', 'Open day', h('input', { type: 'date' })),
    field('notes', 'Notes', h('textarea', { rows: '4' })),
  );
  form.addEventListener('submit', (e) => e.preventDefault());

  if (existing) {
    for (const name of Object.keys(controls) as FieldName[]) {
      controls[name].value = String(existing[name] ?? '');
    }
  } else {
    controls.status.value = 'research';
  }

  const summary = h('div', { class: 'summary', 'aria-live': 'polite' });
  const preview = h('pre', { class: 'yaml' });
  const pathLabel = h('code', {});
  const copyButton = h('button', { type: 'button' }, 'Copy YAML');
  const downloadButton = h('button', { type: 'button' }, 'Download');
  const githubLink = h('a', { class: 'button', target: '_blank', rel: 'noopener noreferrer' }, 'Open in GitHub editor');
  const status = h('span', { class: 'hint', 'aria-live': 'polite' });

  let currentYaml = '';
  let currentId = '';

  function update(): void {
    if (!idTouched) controls.id.value = slugify(controls.name.value);

    const raw: Record<string, unknown> = {};
    for (const name of Object.keys(controls) as FieldName[]) raw[name] = controls[name].value;
    const entry = normalize(raw);
    const errors = validateEntry(entry, takenIds);

    for (const name of Object.keys(errorSlots) as FieldName[]) {
      const messages = errors.filter((e) => e.field === name).map((e) => e.message);
      errorSlots[name].textContent = messages.join('; ');
      controls[name].setAttribute('aria-invalid', String(messages.length > 0));
    }
    const valid = errors.length === 0;
    summary.className = `summary ${valid ? 'ok' : 'bad'}`;
    summary.replaceChildren(
      valid
        ? 'Valid against schema/school.schema.json.'
        : h('span', {}, `${errors.length} problem(s): `, errors.map((e) => `${e.field || 'entry'} ${e.message}`).join('; ')),
    );

    currentId = String(entry.id ?? '');
    currentYaml = toYaml(entry);
    preview.textContent = currentYaml;
    pathLabel.textContent = filePath(currentId || '<id>');

    copyButton.disabled = !valid;
    downloadButton.disabled = !valid;
    if (valid) {
      githubLink.href = isNew ? githubNewFileUrl(currentId, currentYaml) : githubEditFileUrl(currentId);
      githubLink.removeAttribute('aria-disabled');
    } else {
      githubLink.removeAttribute('href');
      githubLink.setAttribute('aria-disabled', 'true');
    }
    status.textContent = '';
  }

  controls.id.addEventListener('input', () => {
    idTouched = controls.id.value !== '';
  });
  form.addEventListener('input', update);
  form.addEventListener('change', update);

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(currentYaml);
      status.textContent = 'Copied.';
    } catch {
      status.textContent = 'Copy failed. Select the YAML above and copy it manually.';
    }
  });

  downloadButton.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([currentYaml], { type: 'text/yaml' }));
    const a = h('a', { href: url, download: `${currentId}.yaml` });
    a.click();
    URL.revokeObjectURL(url);
  });

  update();

  return h(
    'section',
    { class: 'editor' },
    h('p', {}, h('a', { href: '#/' }, '← All schools')),
    h('h1', {}, isNew ? 'Add a school' : `Edit: ${existing.name}`),
    h(
      'div',
      { class: 'editor-grid' },
      form,
      h(
        'div',
        { class: 'output' },
        summary,
        h('h2', {}, 'YAML for ', pathLabel),
        preview,
        h('div', { class: 'actions' }, copyButton, downloadButton, githubLink, status),
        h(
          'p',
          { class: 'hint' },
          isNew
            ? 'Opening in GitHub creates the file pre-filled. If you don’t have write access, GitHub forks the repo and offers a pull request.'
            : 'GitHub’s editor can’t be pre-filled for existing files: copy the YAML first, then replace the file content and propose the change as a pull request.',
          ' Or download the file and open a pull request yourself.',
        ),
      ),
    ),
  );
}
