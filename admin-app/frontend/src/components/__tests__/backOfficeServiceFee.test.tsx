// "Credit policy & config": the Service Fee field reads and saves GET/PUT /api/config/service-fee.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackOffice } from '../BackOffice';
import { UserRole } from '@quickloan/ui-core/types';

type Call = { path: string; method: string; body: any };

function stubApi(initialFee = 3000) {
  const calls: Call[] = [];
  let fee = initialFee;
  const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api/, '');
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method, body });
    const ok = (b: object) => new Response(JSON.stringify({ success: true, ...b }), { status: 200 });
    if (path === '/config/service-fee') {
      if (method === 'PUT') fee = body.serviceFeeNis;
      return ok({ serviceFeeNis: fee, min: 0, max: 50000, default: 3000 });
    }
    if (path === '/auth/staff-token') return ok({ token: 'staff.jwt.token' });
    if (path === '/applications') return ok({ applications: [] });
    if (path.startsWith('/config/credit-rules')) return ok({ rules: {} });
    return ok({});
  });
  vi.stubGlobal('fetch', fetchSpy);
  return { calls, feePuts: () => calls.filter((c) => c.path === '/config/service-fee' && c.method === 'PUT') };
}

async function openConfig(role: UserRole) {
  const user = userEvent.setup();
  render(<BackOffice language="en" currentRole={role} onRoleChange={() => {}} onCloseBackOffice={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Credit policy & config' }));
  const input = screen.getByLabelText('Service fee (₪)') as HTMLInputElement;
  await waitFor(() => expect(input.value).not.toBe(''));
  return { user, input };
}

describe('Back Office service fee configuration', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the configured fee and saves a new one for a system admin', async () => {
    const api = stubApi(3000);
    const { user, input } = await openConfig('system_admin');
    expect(input.value).toBe('3000');
    expect(input).toBeEnabled();
    expect(screen.queryByText(/Management fee/)).toBeNull();

    await user.clear(input);
    await user.type(input, '1500');
    await user.click(screen.getByRole('button', { name: 'Save configuration changes' }));

    await waitFor(() => expect(api.feePuts()).toHaveLength(1));
    expect(api.feePuts()[0].body).toEqual({ serviceFeeNis: 1500 });
    expect(await screen.findByText('System configuration and credit policy updated successfully.')).toBeInTheDocument();
  });

  it('refuses a fee outside the allowed range without saving it', async () => {
    const api = stubApi(3000);
    const { user, input } = await openConfig('system_admin');

    for (const bad of ['50001', '12.5']) {
      await user.clear(input);
      await user.type(input, bad);
      await user.click(screen.getByRole('button', { name: 'Save configuration changes' }));
      expect(await screen.findByText('Enter a whole number from ₪0 to ₪50,000.')).toBeInTheDocument();
      expect(input).toHaveAttribute('aria-invalid', 'true');
    }
    expect(api.feePuts()).toHaveLength(0);
  });

  it('does not send the fee again when it has not changed', async () => {
    const api = stubApi(2000);
    const { user } = await openConfig('system_admin');
    await user.click(screen.getByRole('button', { name: 'Save configuration changes' }));
    await waitFor(() => expect(api.calls.some((c) => c.path === '/config/credit-rules' && c.method === 'PUT')).toBe(true));
    expect(api.feePuts()).toHaveLength(0);
  });

  it('shows the fee read-only to other staff roles', async () => {
    stubApi(2500);
    const { input } = await openConfig('credit_reviewer');
    expect(input.value).toBe('2500');
    expect(input).toBeDisabled();
  });
});
