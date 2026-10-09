// Turns stored values into display text in the current language.
import type { Dimension } from './catalog.ts';
import { getLang, t } from './i18n.ts';
import type { Money } from './school.ts';

const num = (n: number) => n.toLocaleString(getLang() === 'bg' ? 'bg-BG' : 'en-GB');
const yesNo = (b: unknown) => t(b ? 'value.yes' : 'value.no');

export function formatMoney(m: Money): string {
  const cur = t(`enum.currency.${m.currency}`);
  const amount = m.amount !== undefined ? num(m.amount) : `${num(m.min!)}–${num(m.max!)}`;
  const value = m.currency === 'EUR' ? `${cur}${amount}` : `${amount} ${cur}`;
  const months = m.months ? ` (${t('value.months', { n: m.months })})` : '';
  return `${value} / ${t(`enum.per.${m.per}`)}${months}`;
}

export function formatValue(d: Dimension, v: unknown): string {
  const o = v as Record<string, unknown>;
  const parts = (...p: (string | false | undefined)[]) => p.filter(Boolean).join(' · ');
  switch (d.type) {
    case 'bool': return yesNo(v);
    case 'int':
    case 'number': return `${num(v as number)}${d.unit ? ` ${d.unit === 'years' ? t('unit.years') : d.unit}` : ''}`;
    case 'text': case 'url': case 'time_range': return String(v);
    case 'text_list': case 'date_list': return (v as string[]).join(', ');
    case 'date': return String(v);
    case 'enum': return t(`enum.${d.values}.${v}`);
    case 'multi_enum': return (v as string[]).map((x) => t(`enum.${d.values}.${x}`)).join(', ');
    case 'range': return `${o.min}–${o.max} ${d.unit === 'years' ? t('unit.years') : (d.unit ?? '')}`.trim();
    case 'money': return formatMoney(v as Money);
    case 'fee_item': return parts(t(o.included ? 'value.included' : 'value.extra'), o.price ? formatMoney(o.price as Money) : undefined);
    case 'rating': return parts(`${o.score}/${o.max}`, o.count !== undefined && t('value.reviews', { n: o.count as number }), o.site as string);
    case 'offering': return parts(
      yesNo(o.offered),
      o.location !== undefined && t(`enum.location.${o.location}`),
      o.included !== undefined && t(o.included ? 'value.included' : 'value.extra'),
      o.frequency as string, o.partner as string,
      o.from_age !== undefined && t('value.from_age', { n: o.from_age as number }),
    );
    case 'service': return parts(
      t(o.available ? 'value.available' : 'value.not_available'),
      o.included !== undefined && t(o.included ? 'value.included' : 'value.extra'),
      o.hours as string, o.frequency as string, o.price ? formatMoney(o.price as Money) : undefined,
    );
    case 'link': return parts(
      yesNo(o.exists), o.name as string, o.grades !== undefined && t('value.grades', { g: o.grades as string }),
      o.same_campus === true && t('value.same_campus'), o.curriculum as string,
      o.tuition ? formatMoney(o.tuition as Money) : undefined,
    );
  }
}
