import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlowStatusHub } from '../FlowStatusHub';
import { FlowApplicationView } from '@quickloan/ui-core/types';

const prompt = {
  required: true as const,
  terms: {
    type: 'general' as const,
    version: '2.0',
    sha256: 'f'.repeat(64),
    textEn: '1. First clause.\n8. Once your loan is approved, QuickLoan will transfer your application to a licensed bank (the "funding partner").',
    textHe: '1. סעיף ראשון.\n8. לאחר אישור ההלוואה, QuickLoan תעביר את בקשתך לגוף המממן.',
    effectiveFrom: '2026-11-24T00:00:00.000Z',
  },
};

function approvedApp(overrides: Partial<FlowApplicationView> = {}): FlowApplicationView {
  return {
    id: 'app_1',
    requestNumber: 'REQ-2026-100001',
    flowStatus: 'LOAN_APPROVED',
    group: 'approved_final',
    unlockedStep: 3,
    stepStates: { 1: 'approved', 2: 'approved', 3: 'approved' },
    nextAction: null,
    isCompleted: true,
    completedAt: '2026-11-20T10:00:00.000Z',
    canStartNewApplication: false,
    loanRepaidAt: null,
    status: 'Approved',
    rejection: null,
    staffMessage: null,
    partnerConsent: prompt,
    needsRegistrationConsent: false,
    steps: {
      1: { state: 'approved', submittedAt: null, data: null },
      2: { state: 'approved', submittedAt: null, data: null },
      3: { state: 'approved', submittedAt: null, data: null },
    },
    loanBreakdown: null,
    language: 'en',
    leadSource: 'manual',
    account: { email: 'a@example.com', phoneNumber: '050-1234567', fullName: 'Somchai Worker', authProvider: null },
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  } as FlowApplicationView;
}

afterEach(() => vi.unstubAllGlobals());

describe('Updated terms for the funding partner (status hub)', () => {
  it('shows the terms and accepts them only after the box is ticked', async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify({ success: true, application: approvedApp({ partnerConsent: null }), _sent: init?.body }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<FlowStatusHub application={approvedApp()} language="en" onNavigateToStep={vi.fn()} onApplicationUpdated={onUpdated} />);

    expect(screen.getByText('Please accept the updated terms')).toBeInTheDocument();
    expect(screen.getByText(/transfer your application to a licensed bank/)).toBeInTheDocument();
    const accept = screen.getByRole('button', { name: 'Accept the updated terms' });
    expect(accept).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    await user.click(accept);
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/flow\/application\/partner-consent$/);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ accepted: true, version: '2.0', language: 'en' });
    expect(onUpdated.mock.calls[0][0].partnerConsent).toBeNull();
  });

  it('shows the Hebrew text in Hebrew', () => {
    render(<FlowStatusHub application={approvedApp()} language="he" onNavigateToStep={vi.fn()} onApplicationUpdated={vi.fn()} />);
    expect(screen.getByText('נא לאשר את התנאים המעודכנים')).toBeInTheDocument();
    expect(screen.getByText(/תעביר את בקשתך לגוף המממן/)).toBeInTheDocument();
  });

  it('asks again when the terms changed meanwhile', async () => {
    const newer = { ...prompt, terms: { ...prompt.terms, version: '2.1' } };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/partner-consent')) {
        return new Response(JSON.stringify({ success: false, code: 'TERMS_VERSION_CHANGED', error: 'The terms have been updated.' }), { status: 409 });
      }
      return new Response(JSON.stringify({ success: true, application: approvedApp({ partnerConsent: newer }) }), { status: 200 });
    }));
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<FlowStatusHub application={approvedApp()} language="en" onNavigateToStep={vi.fn()} onApplicationUpdated={onUpdated} />);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Accept the updated terms' }));
    expect(await screen.findByText('The terms were updated again. Please read the new version and accept it.')).toBeInTheDocument();
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ partnerConsent: newer })));
  });

  it('is not shown when nothing needs accepting', () => {
    render(<FlowStatusHub application={approvedApp({ partnerConsent: null })} language="en" onNavigateToStep={vi.fn()} onApplicationUpdated={vi.fn()} />);
    expect(screen.queryByText('Please accept the updated terms')).toBeNull();
  });
});
