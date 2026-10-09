// Pathways: stages, transitions (mechanism or association, never causal) and paths with costs.
// Pure functions shared by the build (checks, diagrams) and the browser (Paths page).

export type Lang = 'en' | 'bg';
export interface Text { en: string; bg: string }

export interface Stage {
  id: string;
  sector: 'state' | 'private' | 'other';
  grades: string;
  school?: string;
  context?: boolean;
  label: Text;
}

export const SOURCE_TYPES = ['official', 'school_self_report', 'crowdsourced', 'media'] as const;
export const CAVEATS = ['selection', 'tutoring', 'small_n', 'self_reported', 'incomplete_coverage', 'denominator_unclear'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export type Caveat = (typeof CAVEATS)[number];

export interface Evidence {
  year: number;
  sample_size: number;
  source_type: SourceType;
  verification: 'verified_against_official' | 'consistent_with_official' | 'unverified' | 'contradicted';
  confidence: 'high' | 'medium' | 'low';
  caveats?: Caveat[];
  url: string;
  label: Text;
}

export interface Transition {
  id: string;
  kind: 'mechanism' | 'association';
  from: string;
  to?: string;
  outcome?: Text;
  label: Text;
  gate?: Text;
  sources?: string[];
  evidence?: Evidence[];
}

export interface PathCost {
  fees: { grades: [number, number]; eur: number }[];
  tutoring?: [number, number][];
  sibling_discount?: number;
  once?: number;
  sources: string[];
  unknowns?: Text[];
}

export interface Path {
  id: string;
  label: Text;
  steps: string[];
  cost: PathCost;
}

export interface Pathways {
  stages: Stage[];
  transitions: Transition[];
  paths: Path[];
}

/** Below this many pupils an association is flagged as a small sample. */
export const SMALL_N = 20;
export const isSmallSample = (e: Evidence): boolean => e.sample_size < SMALL_N;

/** Caveats of an evidence record, with the automatic ones added. */
export function caveatsOf(e: Evidence): Caveat[] {
  const out = new Set<Caveat>(e.caveats ?? []);
  if (isSmallSample(e)) out.add('small_n');
  if (e.source_type === 'school_self_report') out.add('self_reported');
  return [...out];
}

/**
 * Causal wording the data can't support (the transitions describe rules or associations).
 * Checked on every label, gate and evidence text in both languages.
 */
export const CAUSAL_WORDING = [
  /\bboost(s|ed|ing)?\b/i,
  /\b(raise|raises|increase|increases|improve|improves)\s+(your|the|their)?\s*(chance|chances|odds)\b/i,
  /\b(leads?|leading) to (admission|success)\b/i,
  /\bfeeder\b/i,
  /\bguarantee(s|d)?\b/i,
  /(повишава|увеличава|подобрява)\s+(шанса|шансовете|вероятността)/i,
  /гарантира/i,
];

export function causalWording(text: string): string | undefined {
  return CAUSAL_WORDING.find((re) => re.test(text))?.source;
}

function texts(t: Transition): string[] {
  const all: (Text | undefined)[] = [t.label, t.gate, t.outcome, ...(t.evidence ?? []).map((e) => e.label)];
  return all.flatMap((x) => (x ? [x.en, x.bg] : []));
}

/** Cross-reference and wording checks (the JSON schema checks the shape). */
export function checkPathways(p: Pathways): string[] {
  const errors: string[] = [];
  const stages = new Map<string, Stage>();
  for (const s of p.stages) {
    if (stages.has(s.id)) errors.push(`stages: duplicate id "${s.id}"`);
    stages.set(s.id, s);
  }
  const ids = new Set<string>();
  for (const t of p.transitions) {
    const where = `transitions/${t.id}`;
    if (ids.has(t.id)) errors.push(`${where}: duplicate id`);
    ids.add(t.id);
    if (!stages.has(t.from)) errors.push(`${where}: unknown stage "${t.from}"`);
    if (t.to && !stages.has(t.to)) errors.push(`${where}: unknown stage "${t.to}"`);
    if (t.kind === 'mechanism' && !t.to) errors.push(`${where}: a mechanism needs "to" (a stage)`);
    if (t.kind === 'association' && !(t.evidence ?? []).length) errors.push(`${where}: an association needs evidence`);
    for (const text of texts(t)) {
      const hit = causalWording(text);
      if (hit) errors.push(`${where}: causal wording ("${text}" matches /${hit}/); describe a rule or an association`);
    }
  }
  const pathIds = new Set<string>();
  for (const path of p.paths) {
    const where = `paths/${path.id}`;
    if (pathIds.has(path.id)) errors.push(`${where}: duplicate id`);
    pathIds.add(path.id);
    path.steps.forEach((s, i) => {
      if (!stages.has(s)) errors.push(`${where}: unknown stage "${s}"`);
      else if (stages.get(s)!.context) errors.push(`${where}: "${s}" is a context stage`);
      if (i > 0 && !mechanismBetween(p, path.steps[i - 1], s)) errors.push(`${where}: no mechanism transition ${path.steps[i - 1]} → ${s}`);
    });
    const seen = new Set<number>();
    for (const f of path.cost.fees) {
      const [a, b] = f.grades;
      if (a > b) errors.push(`${where}: fee grades ${a}-${b} out of order`);
      for (let g = a; g <= b; g++) {
        if (seen.has(g)) errors.push(`${where}: grade ${g} has two fees`);
        seen.add(g);
      }
    }
  }
  return errors;
}

export const mechanismBetween = (p: Pathways, from: string, to: string): Transition | undefined =>
  p.transitions.find((t) => t.kind === 'mechanism' && t.from === from && t.to === to);

/** The mechanism transitions along a path, in order. */
export const pathMechanisms = (p: Pathways, path: Path): Transition[] =>
  path.steps.slice(1).map((s, i) => mechanismBetween(p, path.steps[i], s)!).filter(Boolean);

/** Associations that touch a stage of the path. */
export const pathAssociations = (p: Pathways, path: Path): Transition[] =>
  p.transitions.filter((t) => t.kind === 'association' && (path.steps.includes(t.from) || (t.to !== undefined && path.steps.includes(t.to))));

/** Gates along a path (mechanisms with a gate), in order. */
export const pathGates = (p: Pathways, path: Path): Transition[] => pathMechanisms(p, path).filter((t) => t.gate);

const SOURCE_LABEL: Record<SourceType, Text> = {
  official: { en: 'official', bg: 'официално' },
  school_self_report: { en: 'school self-report', bg: 'данни от училището' },
  crowdsourced: { en: 'crowdsourced', bg: 'от родители' },
  media: { en: 'media', bg: 'медии' },
};
export const sourceTypeLabel = (s: SourceType, lang: Lang): string => SOURCE_LABEL[s][lang];

/** Short evidence tag: year, N and source type, e.g. "2026 · N=72 · school self-report". */
export function evidenceTag(e: Evidence, lang: Lang): string {
  const small = isSmallSample(e) ? (lang === 'bg' ? ' · малка извадка' : ' · small sample') : '';
  return `${e.year} · N=${e.sample_size} · ${sourceTypeLabel(e.source_type, lang)}${small}`;
}

const q = (s: string) => s.replace(/"/g, '#quot;');
const node = (id: string) => id.replace(/-/g, '_');

/**
 * Mermaid flowchart of one path: mechanism edges solid, association edges dashed with a label
 * (what was observed, year, N, source type). Deterministic text, generated at build time.
 */
export function pathFlowchart(p: Pathways, path: Path, lang: Lang): string {
  const stages = new Map(p.stages.map((s) => [s.id, s]));
  const lines = ['flowchart LR'];
  const declared = new Set<string>();
  const declare = (id: string) => {
    if (declared.has(id)) return;
    declared.add(id);
    const s = stages.get(id)!;
    lines.push(`  ${node(id)}["${q(s.label[lang])}"]`);
  };
  for (const s of path.steps) declare(s);
  for (const t of pathMechanisms(p, path)) lines.push(`  ${node(t.from)} -->|"${q(t.label[lang])}"| ${node(t.to!)}`);
  const smallIds: string[] = [];
  pathAssociations(p, path).forEach((t, i) => {
    const e = t.evidence![0];
    const label = `${t.label[lang]} (${evidenceTag(e, lang)})`;
    declare(t.from);
    let target: string;
    if (t.to) {
      declare(t.to);
      target = node(t.to);
    } else {
      target = `o${i + 1}`;
      lines.push(`  ${target}(["${q(t.outcome![lang])}"])`);
      lines.push(`  class ${target} outcome`);
    }
    lines.push(`  ${node(t.from)} -.->|"${q(label)}"| ${target}`);
    if (isSmallSample(e)) smallIds.push(target);
  });
  for (const id of declared) if (stages.get(id)!.context) lines.push(`  class ${node(id)} context`);
  for (const id of smallIds) lines.push(`  class ${id} small`);
  lines.push('  classDef outcome fill:#f6f8fa,stroke:#59636e,stroke-dasharray:4 3');
  lines.push('  classDef context fill:#fff,stroke:#59636e,stroke-dasharray:4 3');
  lines.push('  classDef small fill:#eeeeee,stroke:#999999,color:#666666,stroke-dasharray:4 3');
  return lines.join('\n') + '\n';
}
