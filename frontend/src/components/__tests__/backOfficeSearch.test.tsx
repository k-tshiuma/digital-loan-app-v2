// Regression: the back office search called toLowerCase() on borrower fields that drafts and older
// records may not have, so a query that did not match the request number blanked the whole page.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackOffice } from '../BackOffice';
import { storageService } from '@quickloan/ui-core/services/storage';
import { t } from '@quickloan/ui-core/i18n/translations';
import { LoanApplication } from '@quickloan/ui-core/types';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Back office search', () => {
  it('copes with applications that have no name, passport or country', async () => {
    const sparse = {
      ...storageService.getAllApplications()[0],
      id: `app_sparse_${Date.now()}`,
      requestNumber: 'REQ-2026-SPARSE',
      borrowerDetails: {} as LoanApplication['borrowerDetails'],
    } as LoanApplication;
    storageService.saveApplication(sparse);

    const user = userEvent.setup();
    render(<BackOffice language="en" currentRole="credit_reviewer" onRoleChange={() => {}} onCloseBackOffice={() => {}} />);
    const search = screen.getByPlaceholderText(t('en', 'bo.searchPlaceholder'));

    await user.type(search, 'no-such-borrower');
    expect(screen.getByText(t('en', 'bo.noMatches'))).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'sparse');
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows.some((r) => r.textContent?.includes('REQ-2026-SPARSE'))).toBe(true);
  });
});
