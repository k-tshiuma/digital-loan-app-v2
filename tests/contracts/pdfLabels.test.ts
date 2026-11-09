// Phase 6b: the PDF (backend/services/pdfLabels.js, messages.js) shows stored values with the
// same wording as the app. These checks fail when one side changes without the other.
import path from 'path';
import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';
import { TRANSLATIONS } from '@quickloan/ui-core/i18n/translations';
import { statusLabel } from '@quickloan/ui-core/i18n/options';
import { DOCUMENT_TYPE_CONFIG, VISA_TYPES } from '@quickloan/ui-core/config/appConfig';
import { CanonicalStatus } from '@quickloan/ui-core/types';

const requireBackend = createRequire(path.resolve(__dirname, '../../shared/backend/package.json'));
const { VALUES, DOC_TITLE_KEYS, LEGACY_VALUES } = requireBackend('./services/pdfLabels.js');
const { STATUS_NAMES } = requireBackend('./services/messages.js');

const SHARED = /^(opt\.|bo\.risk\.|bo\.riskLevel\.|bo\.quality\.|reason\.|doc\.)/;

describe('PDF labels match the frontend dictionaries', () => {
  it('every stored-value label in the PDF has the same English and Hebrew text as the app', () => {
    const mismatches: string[] = [];
    for (const lang of ['en', 'he'] as const) {
      for (const [key, text] of Object.entries(VALUES[lang] as Record<string, string>)) {
        if (TRANSLATIONS[lang][key] !== text) mismatches.push(`${lang} ${key}: app "${TRANSLATIONS[lang][key]}" vs PDF "${text}"`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('the PDF knows every dropdown, document, risk, quality and reason label the app has', () => {
    const missing = Object.keys(TRANSLATIONS.en).filter((k) => SHARED.test(k) && !(k in VALUES.en));
    expect(missing).toEqual([]);
  });

  it('document type titles use the same keys', () => {
    const app = Object.fromEntries(DOCUMENT_TYPE_CONFIG.map((d) => [d.code, d.titleKey]));
    expect(DOC_TITLE_KEYS).toEqual(app);
  });

  it('old visa labels map to the same codes as VISA_TYPES', () => {
    expect(LEGACY_VALUES.visa).toEqual(Object.fromEntries(VISA_TYPES.map((v) => [v.label, v.code])));
  });

  it('status names match', () => {
    for (const lang of ['en', 'he'] as const) {
      for (const [status, name] of Object.entries(STATUS_NAMES[lang] as Record<string, string>)) {
        expect(name, `${lang} ${status}`).toBe(statusLabel(lang, status as CanonicalStatus));
      }
    }
  });
});
