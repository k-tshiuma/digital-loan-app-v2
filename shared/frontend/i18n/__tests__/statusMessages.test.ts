// Phase 6: status reasons are shown in the user's language. The offline notifications that use them are
// tested in borrower-app/frontend/src/services/__tests__/storage.test.ts.
import { describe, it, expect } from 'vitest';
import { DEFAULT_STATUS_REASONS, statusReasonLabel, statusLabel } from '../../i18n/options';
import { t } from '../../i18n/translations';

const HEBREW = /[֐-׿]/;

describe('statusReasonLabel', () => {
  it('translates every default reason the app writes', () => {
    for (const [code, english] of Object.entries(DEFAULT_STATUS_REASONS)) {
      expect(statusReasonLabel('he', english)).toBe(t('he', `reason.${code}`));
      expect(statusReasonLabel('en', english)).toBe(english);
    }
  });

  it('translates generated reasons with their values', () => {
    expect(statusReasonLabel('he', 'Status updated to Approved')).toBe(
      t('he', 'reason.statusUpdatedTo', { status: statusLabel('he', 'Approved') })
    );
    expect(statusReasonLabel('he', 'Borrower uploaded additional document: visa.pdf')).toContain('visa.pdf');
    expect(statusReasonLabel('he', 'Borrower uploaded additional document: visa.pdf')).toMatch(HEBREW);
  });

  it('shows staff-typed reasons as typed', () => {
    expect(statusReasonLabel('he', 'Salary slip unreadable')).toBe('Salary slip unreadable');
    expect(statusReasonLabel('he', undefined)).toBe('');
  });

});
