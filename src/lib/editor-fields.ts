// Form fields shown above the YAML editor for a few catalog dimensions (catalog
// `editor_fields`). They read from and write into the YAML text, so the YAML stays
// the single source of truth. Pure: no DOM.
import { isMap, isSeq, parseDocument } from 'yaml';
import type { Dimension } from './catalog.ts';

export type FieldState =
  | { state: 'invalid' } // the YAML doesn't parse or has no values map
  | { state: 'several' } // more than one entry: edit them in the YAML
  | { state: 'ok'; value: unknown }; // undefined = no value yet

export function readField(text: string, dimId: string): FieldState {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length > 0) return { state: 'invalid' };
  const values = doc.get('values');
  if (values !== undefined && values !== null && !isMap(values)) return { state: 'invalid' };
  const raw = doc.getIn(['values', dimId]);
  if (raw === undefined || raw === null) return { state: 'ok', value: undefined };
  const js = (raw as { toJSON?: () => unknown }).toJSON?.() ?? raw;
  if (Array.isArray(js)) return js.length === 1 ? { state: 'ok', value: (js[0] as { v?: unknown }).v } : { state: 'several' };
  return { state: 'ok', value: (js as { v?: unknown }).v };
}

/**
 * Sets (or removes, for an empty selection) the value of one dimension in the YAML text.
 * A new value gets "user-edit" provenance with the given date; an existing entry keeps
 * its src here (the editor re-stamps changed values when copying or downloading).
 */
export function writeField(text: string, dim: Dimension, value: unknown, date: string, nonce: string = Date.now().toString(36)): string {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length > 0) return text;
  const empty = value === undefined || (Array.isArray(value) && value.length === 0);
  if (!isMap(doc.get('values'))) doc.set('values', doc.createNode({}));
  const values = doc.get('values') as ReturnType<typeof doc.createNode> & { flow?: boolean };
  const existing = doc.getIn(['values', dim.id]);
  if (empty) {
    doc.deleteIn(['values', dim.id]);
  } else if (isMap(existing)) {
    doc.setIn(['values', dim.id, 'v'], doc.createNode(value, { flow: true }));
  } else if (isSeq(existing) && existing.items.length === 1) {
    doc.setIn(['values', dim.id, 0, 'v'], doc.createNode(value, { flow: true }));
  } else {
    const ref = `src-u${nonce}-${dim.id.replace(/[^a-z0-9]+/g, '-')}`;
    doc.setIn(['values', dim.id], doc.createNode({ v: value, src: { kind: 'user-edit', source_ref: ref, date } }, { flow: true }));
  }
  if (isMap(values)) values.flow = values.items.length === 0;
  return doc.toString({ lineWidth: 0, flowCollectionPadding: true });
}
