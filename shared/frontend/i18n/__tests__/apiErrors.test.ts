import { describe, it, expect } from 'vitest';
import { localizeError, KNOWN_ERROR_KEYS } from '../../i18n/apiErrors';
import { ApiError } from '../../services/apiCore';
import { TRANSLATIONS, t } from '../../i18n/translations';

describe('localizeError (T3.4)', () => {
  it('translates a known backend error to Hebrew', () => {
    const err = new ApiError('Incorrect password. Please try again.', 401);
    expect(localizeError(err, 'he')).toBe(t('he', 'err.incorrectPassword'));
  });

  it('translates known errors given as plain strings (local fallback)', () => {
    expect(localizeError('No account found with this phone number or email.', 'he')).toBe(t('he', 'err.noAccount'));
  });

  it('shows an unknown message as-is in English', () => {
    expect(localizeError(new ApiError('Weird server thing', 400), 'en')).toBe('Weird server thing');
  });

  it('replaces an unknown message with the fallback in Hebrew', () => {
    expect(localizeError(new ApiError('Weird server thing', 400), 'he')).toBe(t('he', 'err.generic'));
    expect(localizeError(new ApiError('Weird', 400), 'he', 'err.pdfFailed')).toBe(t('he', 'err.pdfFailed'));
  });

  it('uses the network message when fetch itself fails', () => {
    expect(localizeError(new TypeError('Failed to fetch'), 'he')).toBe(t('he', 'err.network'));
  });

  it('uses the fallback for empty errors in English too', () => {
    expect(localizeError(undefined, 'en')).toBe(t('en', 'err.generic'));
  });

  it('every mapped key exists in English and Hebrew', () => {
    const missing = KNOWN_ERROR_KEYS.filter((k) => !TRANSLATIONS.en[k] || !TRANSLATIONS.he[k]);
    expect(missing).toEqual([]);
  });
});
