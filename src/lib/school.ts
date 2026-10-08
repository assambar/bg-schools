// Pure helpers shared by the app and the tests. No DOM access here.
import { stringify } from 'yaml';

export const REPO = 'assambar/bg-schools';
export const BRANCH = 'main';
export const DATA_DIR = 'data/schools';

export const TYPES = ['kindergarten', 'preschool', 'school'] as const;
export const STATUSES = [
  'research',
  'check',
  'call-needed',
  'to-visit',
  'visited',
  'shortlisted',
  'rejected',
] as const;

export interface School {
  id: string;
  name: string;
  type?: (typeof TYPES)[number];
  district?: string;
  website?: string;
  status: (typeof STATUSES)[number];
  open_day?: string;
  notes?: string;
}

/** Key order used in every generated file, so diffs stay small and predictable. */
export const FIELD_ORDER = [
  'id',
  'name',
  'type',
  'district',
  'website',
  'status',
  'open_day',
  'notes',
] as const;

/** Trim strings and drop empty optional fields, in canonical key order. */
export function normalize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of FIELD_ORDER) {
    let value = input[key];
    if (typeof value === 'string') value = value.trim();
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  // Keep unknown keys (at the end) so the schema can reject them visibly.
  for (const key of Object.keys(input)) {
    if (!(FIELD_ORDER as readonly string[]).includes(key)) out[key] = input[key];
  }
  return out;
}

export function toYaml(entry: Record<string, unknown>): string {
  return stringify(normalize(entry), { lineWidth: 0 });
}

/** "Maple Bear Sofia" -> "maple-bear-sofia". Non-Latin text needs a manual id. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export function filePath(id: string): string {
  return `${DATA_DIR}/${id}.yaml`;
}

/**
 * GitHub's web editor with the new file prefilled. People without write access
 * get an automatic fork and a "Propose new file" pull request.
 */
export function githubNewFileUrl(id: string, yaml: string): string {
  const query = `filename=${encodeURIComponent(filePath(id))}&value=${encodeURIComponent(yaml)}`;
  return `https://github.com/${REPO}/new/${BRANCH}?${query}`;
}

/** GitHub's editor for an existing file. It can't be prefilled; paste the copied YAML. */
export function githubEditFileUrl(id: string): string {
  return `https://github.com/${REPO}/edit/${BRANCH}/${filePath(id)}`;
}
