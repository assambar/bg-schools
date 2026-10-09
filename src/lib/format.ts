// Turns stored values into display text in the current language. Generic: record types
// are formatted from their field definitions in the domain catalog.
import type { Dimension, Domain, RecordType } from './domain.ts';
import { getLang, has, t } from './i18n.ts';
import type { Money } from './entity.ts';

const num = (n: number) => n.toLocaleString(getLang() === 'bg' ? 'bg-BG' : 'en-GB');
const yesNo = (b: unknown) => t(b ? 'value.yes' : 'value.no');
/** A unit with a label (unit.<unit>) is translated; others (%, sessions/week) are shown as written. */
const unitText = (unit: string | undefined) => (!unit ? '' : has(`unit.${unit}`) ? t(`unit.${unit}`) : unit);

export function formatMoney(m: Money): string {
  const cur = t(`enum.currency.${m.currency}`);
  const amount = m.amount !== undefined ? num(m.amount) : `${num(m.min!)}–${num(m.max!)}`;
  // A symbol (one character, e.g. €) goes before the amount, a code or word after it.
  const value = [...cur].length === 1 ? `${cur}${amount}` : `${amount} ${cur}`;
  const months = m.months ? ` (${t('value.months', { n: m.months })})` : '';
  return `${value} / ${t(`enum.per.${m.per}`)}${months}`;
}

function formatRecord(rec: RecordType, o: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [name, f] of Object.entries(rec.fields)) {
    const v = o[name];
    if (v === undefined || f.hidden) continue;
    let text: string | undefined;
    if (f.type === 'bool') text = v ? f.labels?.[0] && t(f.labels[0]) : f.labels?.[1] && t(f.labels[1]);
    else if (f.type === 'enum') text = t(`enum.${f.values}.${v}`);
    else if (f.type === 'money') text = formatMoney(v as Money);
    else if (f.format) text = t(f.format, { ...(o as Record<string, string | number>), v: v as string | number });
    else text = String(v);
    if (text) parts.push(text);
  }
  return parts.join(' · ');
}

export function formatValue(dom: Domain, d: Dimension, v: unknown): string {
  const o = v as Record<string, unknown>;
  switch (d.type) {
    case 'bool': return yesNo(v);
    case 'int':
    case 'number': return `${num(v as number)}${d.unit ? ` ${unitText(d.unit)}` : ''}`;
    case 'text': case 'url': case 'time_range': case 'date': return String(v);
    case 'text_list': case 'date_list': return (v as string[]).join(', ');
    case 'enum': return t(`enum.${d.values}.${v}`);
    case 'multi_enum': return (v as string[]).map((x) => t(`enum.${d.values}.${x}`)).join(', ');
    case 'range': return `${o.min}–${o.max} ${unitText(d.unit)}`.trim();
    case 'money': return formatMoney(v as Money);
    default: return dom.records[d.type] ? formatRecord(dom.records[d.type], o) : JSON.stringify(v);
  }
}
