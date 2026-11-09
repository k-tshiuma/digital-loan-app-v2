// Older records stored the visa's display label ("B-1 Work Visa (Agriculture / חקלאות)") or a bare
// "b1" instead of a code. They are shown translated like any other value.
import { describe, it, expect } from 'vitest';
import { optionLabel, canonicalOptionValue } from '../../i18n/options';
import { t } from '../../i18n/translations';
import { VISA_TYPES } from '../../config/appConfig';

describe('legacy visa values', () => {
  it('every old visa label maps to its code', () => {
    for (const v of VISA_TYPES) expect(canonicalOptionValue('visa', v.label)).toBe(v.code);
    expect(canonicalOptionValue('visa', 'b1_agri')).toBe('b1_agri');
    expect(canonicalOptionValue('country', 'Thailand')).toBe('Thailand');
  });

  it('are shown with the translated label', () => {
    expect(optionLabel('he', 'visa', 'B-1 Work Visa (Agriculture / חקלאות)')).toBe(t('he', 'opt.visa.b1_agri'));
    expect(optionLabel('en', 'visa', 'b-1 work visa (agriculture / חקלאות)')).toBe(t('en', 'opt.visa.b1_agri')); // any casing
    expect(optionLabel('he', 'visa', 'b1')).toBe('אשרת עבודה B-1');
    expect(optionLabel('en', 'visa', 'b1')).toBe('B-1 work visa');
  });
});
