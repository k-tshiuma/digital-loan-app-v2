import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FundingPanel } from '../FundingPanel';

const APP = 'app_fund_1';

function overview(extra: Record<string, any> = {}) {
  return {
    partner: { code: 'sandbox_bank', name: 'Partner Bank (sandbox)', configured: true, sandbox: true, problem: null },
    consent: { given: true, version: '2.0', acceptedAt: '2026-11-24T10:00:00.000Z' },
    handoffs: [],
    permissions: { push: true, requestConsent: false, refresh: false },
    pushBlockedBy: null,
    ...extra,
  };
}

function handoff(extra: Record<string, any> = {}) {
  return {
    id: 'fund_1', applicationId: APP, partnerCode: 'sandbox_bank', status: 'SENT', externalReference: 'SBX-LN-123456', partnerStatus: 'RECEIVED',
    decisionReason: null, attemptCount: 1, payloadSha256: 'a'.repeat(64),
    requestSummary: { documents: [{ type: 'PASSPORT', size: 10, sha256: 'b' }, { type: 'GUARANTOR_ID', size: 10, sha256: 'c' }] },
    responseSummary: null, errorCode: null, error: null, retryable: false, pushedByName: 'Credit Reviewer', pushedByRole: 'credit_reviewer',
    createdAt: '2026-11-24T11:00:00.000Z', updatedAt: null, lastAttemptAt: null, lastCheckedAt: null, completedAt: null,
    ...extra,
  };
}

/** fetch stub: GET overview answers from `overviews` in turn (the last one repeats); POSTs answer from `posts`. */
function stubApi(overviews: object[], posts: Record<string, { status: number; body: object }> = {}) {
  let i = 0;
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api/, '');
    if ((init?.method || 'GET') === 'GET' && path === `/flow/applications/${APP}/funding`) {
      const body = overviews[Math.min(i++, overviews.length - 1)];
      return new Response(JSON.stringify({ success: true, ...body }), { status: 200 });
    }
    const hit = Object.entries(posts).find(([suffix]) => path.endsWith(suffix));
    if (hit) return new Response(JSON.stringify(hit[1].body), { status: hit[1].status });
    return new Response(JSON.stringify({ success: false, error: 'unexpected' }), { status: 500 });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}
const posted = (spy: ReturnType<typeof vi.fn>, suffix: string) =>
  spy.mock.calls.filter(([u, init]) => String(u).endsWith(suffix) && (init as RequestInit | undefined)?.method === 'POST');

afterEach(() => vi.unstubAllGlobals());

describe('FundingPanel', () => {
  it('asks for a confirmation listing what is sent, then pushes and reports the reference', async () => {
    const sent = handoff();
    const spy = stubApi([overview(), overview({ handoffs: [sent], permissions: { push: false, requestConsent: false, refresh: true }, pushBlockedBy: 'ALREADY_SENT' })], {
      '/funding/push': { status: 200, body: { success: true, handoff: sent } },
    });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<FundingPanel applicationId={APP} language="en" onChanged={onChanged} />);

    expect(await screen.findByText('Partner Bank (sandbox)')).toBeInTheDocument();
    expect(screen.getByText('Sandbox')).toBeInTheDocument();
    expect(screen.getByText(/Accepted terms version 2\.0/)).toBeInTheDocument();
    expect(screen.getByText('This loan has not been sent yet.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Push to Partner' }));
    expect(screen.getByText('Send this loan to Partner Bank (sandbox)?')).toBeInTheDocument();
    expect(screen.getByText('The full bank account number')).toBeInTheDocument();
    expect(screen.getByText('Copies of all uploaded documents')).toBeInTheDocument();
    expect(posted(spy, '/funding/push')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Yes, send it' }));
    expect(await screen.findByText('Sent to the funding partner (reference SBX-LN-123456).')).toBeInTheDocument();
    expect(posted(spy, '/funding/push')).toHaveLength(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('Received by the partner')).toBeInTheDocument());
    expect(screen.getByText('SBX-LN-123456')).toBeInTheDocument();
    expect(screen.getByText('passport, sponsor ID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Push to Partner' })).toBeDisabled();
    expect(screen.getByText('This loan was already sent to the funding partner.')).toBeInTheDocument();
  });

  it('cancelling the confirmation sends nothing', async () => {
    const spy = stubApi([overview()]);
    const user = userEvent.setup();
    render(<FundingPanel applicationId={APP} language="en" />);
    await user.click(await screen.findByRole('button', { name: 'Push to Partner' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Yes, send it')).toBeNull();
    expect(posted(spy, '/funding/push')).toHaveLength(0);
  });

  it('shows a refused push in words, by its error code', async () => {
    stubApi([overview()], { '/funding/push': { status: 409, body: { success: false, code: 'ALREADY_SENT', error: 'This loan was already sent to the funding partner.' } } });
    const user = userEvent.setup();
    render(<FundingPanel applicationId={APP} language="he" />);
    await user.click(await screen.findByRole('button', { name: 'העברה לשותף מימון' }));
    await user.click(screen.getByRole('button', { name: 'כן, לשלוח' }));
    expect(await screen.findByText('ההלוואה כבר נשלחה לגוף המממן.')).toBeInTheDocument();
  });

  it('without the consent: the push is disabled with the reason, and staff can ask the applicant to accept', async () => {
    const spy = stubApi([overview({ consent: { given: false, version: null, acceptedAt: null }, permissions: { push: false, requestConsent: true, refresh: false }, pushBlockedBy: 'PARTNER_CONSENT_REQUIRED' })], {
      '/funding/consent-request': { status: 200, body: { success: true } },
    });
    const user = userEvent.setup();
    render(<FundingPanel applicationId={APP} language="en" />);
    expect(await screen.findByText(/accepted an older version of the terms/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Push to Partner' })).toBeDisabled();
    expect(screen.getByText(/Not available yet: the applicant must first accept the updated terms/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ask the applicant to accept' }));
    expect(await screen.findByText(/The applicant was asked to accept the updated terms/)).toBeInTheDocument();
    expect(posted(spy, '/funding/consent-request')).toHaveLength(1);
  });

  it('shows a failed hand-off with its reason and offers to try again', async () => {
    stubApi([overview({
      handoffs: [handoff({ status: 'FAILED', externalReference: null, attemptCount: 3, errorCode: 'PARTNER_ERROR', error: 'Simulated failure (SANDBOX_FAULT)', retryable: true })],
    })]);
    render(<FundingPanel applicationId={APP} language="en" />);
    expect(await screen.findByText('The funding partner had a temporary error. Try again later.')).toBeInTheDocument();
    expect(screen.getByText('Simulated failure (SANDBOX_FAULT)')).toBeInTheDocument();
    expect(screen.getByText(/Attempts: 3/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('checks the status of a hand-off waiting for the partner', async () => {
    const waiting = handoff({ status: 'IN_REVIEW' });
    const spy = stubApi([
      overview({ handoffs: [waiting], permissions: { push: false, requestConsent: false, refresh: true } }),
      overview({ handoffs: [handoff({ status: 'APPROVED', decisionReason: 'Identity, AML and credit checks passed.', responseSummary: { fundingReference: 'SBX-FUND-777777' } })], permissions: { push: false, requestConsent: false, refresh: false } }),
    ], { '/funding/refresh': { status: 200, body: { success: true, handoff: waiting } } });
    const user = userEvent.setup();
    render(<FundingPanel applicationId={APP} language="en" />);
    expect(await screen.findByText('In compliance review')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check status' }));
    expect(await screen.findByText('Funding approved')).toBeInTheDocument();
    expect(screen.getByText('SBX-FUND-777777')).toBeInTheDocument();
    expect(screen.getByText('Identity, AML and credit checks passed.')).toBeInTheDocument();
    expect(posted(spy, '/funding/refresh')).toHaveLength(1);
  });

  it('warns when the server has no partner connection', async () => {
    stubApi([overview({ partner: { code: 'partner', name: 'Funding partner', configured: false, sandbox: false, problem: 'FUNDING_PARTNER_URL is not set.' }, permissions: { push: false, requestConsent: false, refresh: false }, pushBlockedBy: 'FUNDING_PARTNER_NOT_CONFIGURED' })]);
    render(<FundingPanel applicationId={APP} language="en" />);
    // On the partner card and as the reason next to the disabled button
    expect(await screen.findAllByText('The connection to the funding partner is not set up on the server.')).toHaveLength(2);
    expect(screen.getByText('FUNDING_PARTNER_URL is not set.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Push to Partner' })).toBeDisabled();
  });

  it('a role that may not push sees why, and no button', async () => {
    stubApi([overview({ permissions: { push: false, requestConsent: false, refresh: false }, pushBlockedBy: 'ROLE' })]);
    render(<FundingPanel applicationId={APP} language="en" />);
    expect(await screen.findByText('Only a credit reviewer or a system admin can send a loan to the funding partner.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Push to Partner' })).toBeNull();
  });

  it('is in Hebrew when the dashboard is', async () => {
    stubApi([overview({ handoffs: [handoff({ status: 'REJECTED', decisionReason: 'The work visa expires before the last repayment.' })], permissions: { push: false, requestConsent: false, refresh: false } })]);
    render(<FundingPanel applicationId={APP} language="he" />);
    expect(await screen.findByText('נדחה על ידי הגוף המממן')).toBeInTheDocument();
    expect(screen.getByText('העברות לגוף המממן')).toBeInTheDocument();
    expect(screen.getByText('הסכמת המבקש להעברה')).toBeInTheDocument();
  });
});
