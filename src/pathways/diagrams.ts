// Pre-rendered Mermaid diagrams (generated/diagrams/**/*.svg, see scripts/pathways/render-diagrams.ts),
// shown as images: no Mermaid runtime in the browser and the CSP stays strict.
import { h } from '../dom.ts';

const urls = import.meta.glob('../../generated/diagrams/**/*.svg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** e.g. diagram('paths', 'state-smg', 'en'): an <img>, or null when the SVG is missing. */
export function diagram(kind: string, id: string, lang: string, alt: string): HTMLElement | null {
  const url = urls[`../../generated/diagrams/${kind}/${id}.${lang}.svg`] ?? urls[`../../generated/diagrams/${kind}/${id}.en.svg`];
  if (!url) return null;
  return h('a', { href: url, target: '_blank', rel: 'noopener', class: 'diagram' }, h('img', { src: url, alt }));
}
