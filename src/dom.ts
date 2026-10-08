// Tiny DOM builder. Text is always added as text nodes (never innerHTML), so
// data from YAML files can't inject markup.
type Attrs = Record<string, string | boolean | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === true) el.setAttribute(name, '');
    else if (typeof value === 'string') el.setAttribute(name, value);
  }
  for (const child of children) {
    if (child) el.append(child);
  }
  return el;
}
