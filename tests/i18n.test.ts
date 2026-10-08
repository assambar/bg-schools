import { describe, expect, it } from 'vitest';
import { catalogLabelKeys } from '../src/lib/catalog.ts';
import { formatValue } from '../src/lib/format.ts';
import { detectLang, dictionaries, LANGS, setLang, t } from '../src/lib/i18n.ts';
import { loadCatalog } from '../scripts/schema.ts';

const { catalog } = loadCatalog();

describe('dictionaries', () => {
  it('has English and Bulgarian with identical keys', () => {
    expect(LANGS).toEqual(expect.arrayContaining(['bg', 'en']));
    const en = Object.keys(dictionaries.en).sort();
    for (const lang of LANGS) expect(Object.keys(dictionaries[lang]).sort(), lang).toEqual(en);
  });

  it('labels every catalog group, dimension, enum value, grade and neighbourhood in every language', () => {
    for (const lang of LANGS) {
      const missing = catalogLabelKeys(catalog).filter((k) => !(k in dictionaries[lang]));
      expect(missing, lang).toEqual([]);
    }
  });

  it('has no empty strings', () => {
    for (const lang of LANGS) for (const [k, v] of Object.entries(dictionaries[lang])) expect(v.trim(), `${lang}:${k}`).not.toBe('');
  });
});

describe('t() and language detection', () => {
  it('fills parameters and switches language', () => {
    setLang('en');
    expect(t('list.heading', { n: 3 })).toBe('Schools (3)');
    setLang('bg');
    expect(t('list.heading', { n: 3 })).toBe('Училища (3)');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('prefers the saved choice, then the browser, then Bulgarian', () => {
    expect(detectLang('en', ['bg-BG'])).toBe('en');
    expect(detectLang(null, ['en-US', 'bg'])).toBe('en');
    expect(detectLang(null, ['fr-FR'])).toBe('bg');
    expect(detectLang('xx', [])).toBe('bg');
  });

  it('formats structured values in the current language', () => {
    const offering = catalog.byId.get('activity.swimming')!;
    const tuition = catalog.byId.get('tuition')!;
    setLang('en');
    expect(formatValue(offering, { offered: true, location: 'off_site', included: false })).toBe('Yes · off site · extra cost');
    expect(formatValue(tuition, { min: 500, max: 580, currency: 'EUR', per: 'month' })).toBe('€500–580 / month');
    setLang('bg');
    expect(formatValue(offering, { offered: true, location: 'on_site', included: true })).toBe('Да · на място · включено');
    expect(formatValue(tuition, { amount: 400, currency: 'BGN', per: 'month' })).toBe('400 лв. / месец');
  });
});
