import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { domainLabelKeys } from '../src/lib/domain.ts';
import { formatValue } from '../src/lib/format.ts';
import { detectLang, dictionaries, LANGS, setLang, t } from '../src/lib/i18n.ts';
import { setup } from './helpers.ts';

const { dom: catalog, i18n } = setup();
const core = (lang: string) => JSON.parse(readFileSync(`src/i18n/${lang}.json`, 'utf8')) as Record<string, string>;

describe('dictionaries', () => {
  it('has English and Bulgarian with identical keys', () => {
    expect(LANGS).toEqual(expect.arrayContaining(['bg', 'en']));
    const en = Object.keys(dictionaries.en).sort();
    for (const lang of LANGS) expect(Object.keys(dictionaries[lang]).sort(), lang).toEqual(en);
  });

  it('keeps generic UI strings and domain strings apart, with the same keys in every language', () => {
    for (const lang of LANGS) {
      expect(Object.keys(core(lang)).sort(), lang).toEqual(Object.keys(core('en')).sort());
      expect(Object.keys(i18n[lang]).sort(), lang).toEqual(Object.keys(i18n.en).sort());
      expect(Object.keys(core(lang)).filter((k) => k in i18n[lang]), lang).toEqual([]);
    }
  });

  it('labels every domain group, dimension, enum value, scope value and area in every language', () => {
    for (const lang of LANGS) {
      const missing = domainLabelKeys(catalog).filter((k) => !(k in dictionaries[lang]));
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
    expect(formatValue(catalog, offering, { offered: true, location: 'off_site', included: false })).toBe('Yes · off site · extra cost');
    expect(formatValue(catalog, tuition, { min: 500, max: 580, currency: 'EUR', per: 'month' })).toBe('€500–580 / month');
    setLang('bg');
    expect(formatValue(catalog, offering, { offered: true, location: 'on_site', included: true })).toBe('Да · на място · включено');
    expect(formatValue(catalog, tuition, { amount: 400, currency: 'BGN', per: 'month' })).toBe('400 лв. / месец');
  });
});
