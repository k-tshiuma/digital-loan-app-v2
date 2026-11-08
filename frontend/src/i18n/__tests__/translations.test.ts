import { describe, it, expect } from 'vitest';
import { TRANSLATIONS, t } from '@quickloan/ui-core/i18n/translations';

const en = TRANSLATIONS.en;
const he = TRANSLATIONS.he;
const enKeys = Object.keys(en);
const heKeys = Object.keys(he);

const HEBREW_CHAR = /[֐-׿]/;
const placeholders = (s: string) => (s.match(/\{\w+\}/g) || []).sort();

// Hebrew values that legitimately contain no Hebrew letters (brand names, codes, symbols).
const NO_HEBREW_ALLOWED = new Set<string>(['currencySymbol', 'phoneNumberPlaceholder']);

describe('Hebrew dictionary (T0.1–T0.5)', () => {
  it('T0.1 has every English key and no extra keys', () => {
    const missing = enKeys.filter((k) => !(k in he));
    const extra = heKeys.filter((k) => !(k in en));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it('T0.2 has no empty values or values equal to their key', () => {
    const bad = heKeys.filter((k) => !he[k] || !he[k].trim() || he[k] === k);
    expect(bad).toEqual([]);
  });

  it('T0.3 keeps the same {placeholders} as English', () => {
    const mismatched = enKeys
      .filter((k) => k in he)
      .filter((k) => placeholders(en[k]).join() !== placeholders(he[k]).join())
      .map((k) => `${k}: en=${placeholders(en[k])} he=${placeholders(he[k])}`);
    expect(mismatched).toEqual([]);
  });

  it('T0.5 every value contains Hebrew letters (except allowlisted keys)', () => {
    const notHebrew = heKeys.filter((k) => !NO_HEBREW_ALLOWED.has(k) && !HEBREW_CHAR.test(he[k]));
    expect(notHebrew).toEqual([]);
  });
});

describe('t() helper (T0.4)', () => {
  const someKey = enKeys.find((k) => k in he && he[k] !== en[k])!;

  it('returns the Hebrew text for he', () => {
    expect(t('he', someKey)).toBe(he[someKey]);
  });

  it('returns the English text for en', () => {
    expect(t('en', someKey)).toBe(en[someKey]);
  });

  it('falls back to English when a key is missing in Hebrew', () => {
    const original = TRANSLATIONS.en.__testOnlyKey;
    TRANSLATIONS.en.__testOnlyKey = 'English only';
    try {
      expect(t('he', '__testOnlyKey')).toBe('English only');
    } finally {
      if (original === undefined) delete TRANSLATIONS.en.__testOnlyKey;
    }
  });

  it('returns the key itself when it exists in no language', () => {
    expect(t('he', 'definitely.not.a.key')).toBe('definitely.not.a.key');
  });

  it('replaces every occurrence of a placeholder', () => {
    TRANSLATIONS.he.__testOnlyKey = '{n} ו-{n} שוב, {name}';
    try {
      expect(t('he', '__testOnlyKey', { n: 3, name: 'דנה' })).toBe('3 ו-3 שוב, דנה');
    } finally {
      delete TRANSLATIONS.he.__testOnlyKey;
    }
  });
});
