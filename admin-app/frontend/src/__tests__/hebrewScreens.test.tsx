// Phase 3 render tests for the admin dashboard: Back Office screens shown in Hebrew contain Hebrew
// headings and no English sentences. (The borrower screens' tests are in the borrower app.)
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t } from '@quickloan/ui-core/i18n/translations';
import { storageService } from '../services/storage';
import { englishIn } from '@quickloan/ui-core/test-utils/hebrewText';
import { BackOffice } from '../components/BackOffice';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  window.scrollTo = vi.fn() as any;
  // recharts' ResponsiveContainer needs ResizeObserver
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Back office in Hebrew (T3.5)', () => {
  it('queue headers, filters and actions are Hebrew; the inspector shows Hebrew sections', async () => {
    const user = userEvent.setup();
    render(<BackOffice language="he" currentRole="credit_reviewer" onRoleChange={() => {}} onCloseBackOffice={() => {}} />);

    const table = screen.getByRole('table');
    const headerRow = within(table).getAllByRole('row')[0];
    expect(englishIn(headerRow)).toEqual([]);
    expect(within(headerRow).getByText(t('he', 'bo.col.borrower'))).toBeInTheDocument();

    const statusFilter = screen.getByDisplayValue(t('he', 'bo.allStatuses', { n: storageService.getAllApplications().length }));
    expect(within(statusFilter).getByText(t('he', 'statusUnderReview'))).toBeInTheDocument();

    const inspect = screen.getAllByRole('button', { name: t('he', 'bo.inspect') });
    expect(inspect.length).toBeGreaterThan(0);
    await user.click(inspect[0]);

    expect(screen.getByText(t('he', 'bo.borrowerProfile'))).toBeInTheDocument();
    expect(screen.getByText(t('he', 'bo.riskTitle'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('he', 'bo.approve') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('he', 'bo.reject') })).toBeInTheDocument();
  });
});

describe('Analytics dashboard in Hebrew (T3.7)', () => {
  it('titles and KPI labels are Hebrew', () => {
    const { container } = render(<AnalyticsDashboard applications={storageService.getAllApplications()} language="he" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(t('he', 'an.title'));
    expect(screen.getByText(t('he', 'an.totalApps'))).toBeInTheDocument();
    expect(screen.getByText(t('he', 'an.approvalRate'))).toBeInTheDocument();
    expect(englishIn(container)).toEqual([]);
  });
});
