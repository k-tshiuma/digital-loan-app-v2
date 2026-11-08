import { describe, it, expect } from 'vitest';
import { TRANSLATIONS, t } from '../../i18n/translations';

const en = TRANSLATIONS.en;
const he = TRANSLATIONS.he;
const enKeys = Object.keys(en);

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
