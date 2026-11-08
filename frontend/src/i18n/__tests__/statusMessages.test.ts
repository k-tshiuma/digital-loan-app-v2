// Phase 6: status reasons and offline notifications are shown in the user's language.
import fs from 'fs';
import path from 'path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DEFAULT_STATUS_REASONS, statusReasonLabel, statusLabel } from '@quickloan/ui-core/i18n/options';
import { t } from '@quickloan/ui-core/i18n/translations';
import { storageService } from '@quickloan/ui-core/services/storage';

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

  it('knows every fixed reason the backend writes into the status history', () => {
    // server.js and the route modules split out of it (routes/borrower, routes/admin, routes/shared).
    const backend = path.resolve(__dirname, '../../../../backend');
    const files = [
      path.join(backend, 'server.js'),
      ...['borrower', 'admin', 'shared'].flatMap((dir) =>
        fs.readdirSync(path.join(backend, 'routes', dir)).filter((f) => f.endsWith('.js')).map((f) => path.join(backend, 'routes', dir, f))
      ),
    ];
    const server = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const known = Object.values(DEFAULT_STATUS_REASONS) as string[];
    // `reason: 'text'` or `reason: (...) || 'fallback text'`
    const written = [...server.matchAll(/reason:\s*(?:'([^']+)'|[^\n]*\|\|\s*'([^']+)')/g)].map((m) => m[1] ?? m[2]);
    expect(written.length).toBeGreaterThan(0);
    expect(written.filter((r) => !known.includes(r))).toEqual([]);
  });
});

describe('Offline notification fallback (storage.ts)', () => {
  afterEach(() => {
    storageService.logout();
    vi.restoreAllMocks();
  });

  function submittedAppFor(userLang: 'he' | 'en' | 'th', appLang: 'he' | 'en') {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { user } = storageService.loginWithGoogle({ email: `notif-${Math.random()}@example.com`, name: 'Test' }, userLang);
    const app = storageService.getOrCreateActiveApplication(user, appLang);
    storageService.saveApplication(app);
    storageService.submitApplication(app.id);
    return { user, app };
  }

  const latest = (userId: string, type: string) =>
    storageService.getNotifications(userId).find((n) => n.notificationType === type)!;

  it('uses the user\'s language and translated status names', () => {
    const { user, app } = submittedAppFor('he', 'en');
    storageService.updateApplicationStatus(app.id, 'Approved', 'credit_reviewer', 'CR', DEFAULT_STATUS_REASONS.approved);
    const n = latest(user.id, 'STATUS_Approved');
    expect(n.language).toBe('he');
    expect(n.title).toContain(statusLabel('he', 'Approved'));
    expect(n.message).toContain(t('he', 'statusApprovedDesc'));
    expect(latest(user.id, 'SUBMISSION_CONFIRMATION').title).toBe(t('he', 'applicationSubmittedTitle'));
  });

  it('translates the default rejection reason but keeps a typed one', () => {
    const { user, app } = submittedAppFor('he', 'he');
    storageService.updateApplicationStatus(app.id, 'Rejected', 'credit_reviewer', 'CR', DEFAULT_STATUS_REASONS.rejected);
    expect(latest(user.id, 'STATUS_Rejected').message).toContain(t('he', 'reason.rejected'));

    const second = submittedAppFor('he', 'he');
    storageService.updateApplicationStatus(second.app.id, 'Rejected', 'credit_reviewer', 'CR', 'Employer could not be verified');
    expect(latest(second.user.id, 'STATUS_Rejected').message).toContain('Employer could not be verified');
  });

  it('falls back to English for an on-hold language', () => {
    const { user, app } = submittedAppFor('th', 'en');
    storageService.updateApplicationStatus(app.id, 'Approved', 'credit_reviewer', 'CR');
    const n = latest(user.id, 'STATUS_Approved');
    expect(n.language).toBe('en');
    expect(n.title).toBe('QuickLoan: Approved');
  });
});
