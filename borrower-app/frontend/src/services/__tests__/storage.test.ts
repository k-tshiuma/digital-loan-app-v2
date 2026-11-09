// Phase 6: offline notifications from the browser-storage model are written in the user's language.
// (Moved from the shared suite when storage.ts was split per app: they use the borrower's sign-in and submission.)
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DEFAULT_STATUS_REASONS, statusLabel } from '@quickloan/ui-core/i18n/options';
import { t } from '@quickloan/ui-core/i18n/translations';
import { storageService } from '../storage';

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
