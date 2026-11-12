// An approved loan can't be approved again: "Approve loan" is disabled in the lead popup whether it was
// opened with "Inspect" or by clicking the "Loan Approved" status, and clicking it changes nothing.
// The check uses the application's stored status, not the way the popup was opened.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackOffice } from '../BackOffice';
import { storageService } from '../../services/storage';
import { LoanApplication } from '@quickloan/ui-core/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rowOf = (requestNumber: string) =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .find((r) => r.textContent?.includes(requestNumber))!;

const closePopup = async (user: ReturnType<typeof userEvent.setup>) => {
  const closers = screen.getAllByRole('button', { name: /^Close/ });
  await user.click(closers[closers.length - 1]);
};

describe('Approved lead: classic application popup', () => {
  it('disables Approve loan for an approved application and keeps it working for one under review', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const base = storageService.getAllApplications()[0];
    const approved = { ...base, id: 'app_lock_approved', requestNumber: 'REQ-2026-LOCKA', status: 'Approved' } as LoanApplication;
    const underReview = { ...base, id: 'app_lock_review', requestNumber: 'REQ-2026-LOCKR', status: 'Under Review' } as LoanApplication;
    storageService.saveApplication(approved);
    storageService.saveApplication(underReview);
    const historyBefore = (storageService.getApplication('app_lock_approved')?.statusHistory || []).length;

    const user = userEvent.setup();
    render(<BackOffice language="en" currentRole="credit_reviewer" onRoleChange={() => {}} onCloseBackOffice={() => {}} />);

    // Opened with "Inspect"
    await user.click(within(rowOf('REQ-2026-LOCKA')).getByRole('button', { name: 'Inspect' }));
    let approve = screen.getByRole('button', { name: 'Approve loan' });
    expect(approve).toBeDisabled();
    await user.click(approve);
    expect(storageService.getApplication('app_lock_approved')?.status).toBe('Approved');
    expect((storageService.getApplication('app_lock_approved')?.statusHistory || []).length).toBe(historyBefore);
    await closePopup(user);

    // Opened by clicking the status in the row
    await user.click(within(rowOf('REQ-2026-LOCKA')).getByText('Approved'));
    expect(screen.getByRole('button', { name: 'Approve loan' })).toBeDisabled();
    await closePopup(user);

    // Not approved yet: unchanged
    await user.click(within(rowOf('REQ-2026-LOCKR')).getByRole('button', { name: 'Inspect' }));
    approve = screen.getByRole('button', { name: 'Approve loan' });
    expect(approve).toBeEnabled();
    await user.click(approve);
    expect(storageService.getApplication('app_lock_review')?.status).toBe('Approved');
  });
});

describe('Approved lead: 3-step application popup', () => {
  const flowApp = (id: string, requestNumber: string, flowStatus: string, status: string) => ({
    id,
    requestNumber,
    flowVersion: 2,
    flowStatus,
    group: flowStatus === 'LOAN_APPROVED' ? 'approved_final' : 'completed',
    status,
    applicantName: 'Chinedu Okafor',
    language: 'en',
    phoneNumber: '+972553592974',
    requestedAmountNis: 6000,
    repaymentPeriodMonths: 6,
    documents: [],
    consents: [],
    statusHistory: [],
    createdAt: '2026-11-11T15:00:00.000Z',
    updatedAt: '2026-11-11T15:10:00.000Z',
  });

  it('disables Approve loan for LOAN_APPROVED via Inspect and via Loan Approved, and keeps it for final processing', async () => {
    const approvedApp = flowApp('app_flow_ok', 'REQ-2026-200001', 'LOAN_APPROVED', 'Approved');
    const finalApp = flowApp('app_flow_final', 'REQ-2026-200002', 'PENDING_FINAL_PROCESSING', 'Received');
    const decisions: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = String(url).replace(/^.*\/api/, '');
        const ok = (body: object) => new Response(JSON.stringify({ success: true, ...body }), { status: 200 });
        if (path.endsWith('/final-decision')) {
          decisions.push(path);
          return ok({});
        }
        if (path === '/applications') return ok({ applications: [approvedApp, finalApp] });
        for (const app of [approvedApp, finalApp]) {
          if (path === `/flow/applications/${app.id}`) {
            return ok({ application: app, view: { group: app.group, stepStates: {} }, user: {}, acceptances: [], reviews: [] });
          }
        }
        return ok({});
      })
    );

    const user = userEvent.setup();
    render(<BackOffice language="en" currentRole="credit_reviewer" onRoleChange={() => {}} onCloseBackOffice={() => {}} />);
    await waitFor(() => expect(screen.getByText('REQ-2026-200001')).toBeInTheDocument());

    // Opened with "Inspect"
    await user.click(within(rowOf('REQ-2026-200001')).getByRole('button', { name: 'Inspect' }));
    const approve = await screen.findByRole('button', { name: 'Approve loan' });
    expect(approve).toBeDisabled();
    await user.click(approve);
    expect(decisions).toEqual([]);
    await closePopup(user);

    // Opened by clicking "Loan Approved" in the row
    await user.click(within(rowOf('REQ-2026-200001')).getByText('Loan Approved'));
    expect(await screen.findByRole('button', { name: 'Approve loan' })).toBeDisabled();
    await closePopup(user);

    // Final processing: approval still works
    await user.click(within(rowOf('REQ-2026-200002')).getByRole('button', { name: 'Inspect' }));
    const approveFinal = await screen.findByRole('button', { name: 'Approve loan' });
    expect(approveFinal).toBeEnabled();
    await user.click(approveFinal);
    await waitFor(() => expect(decisions).toEqual(['/flow/applications/app_flow_final/final-decision']));
  });
});
