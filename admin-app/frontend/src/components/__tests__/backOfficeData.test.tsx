// The back office opens in the borrower view. Staff-only endpoints must not be called there
// (they answered 403); once a staff role is picked, the dashboard signs in as that role first (the API sets
// the HttpOnly session cookie), and the token is never kept or sent by the app.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { BackOffice } from '../BackOffice';

let calls: Array<{ path: string; method: string; auth: string | null; csrf: string | null; credentials?: RequestCredentials }> = [];

beforeEach(() => {
  calls = [];
  localStorage.removeItem('quickloan_staff_session_v2');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api/, '');
      const headers = (init?.headers || {}) as Record<string, string>;
      calls.push({
        path,
        method: init?.method || 'GET',
        auth: headers.Authorization || null,
        csrf: headers['X-QuickLoan-Request'] || null,
        credentials: init?.credentials,
      });
      const ok = (body: object) => new Response(JSON.stringify({ success: true, ...body }), { status: 200 });
      if (path === '/auth/staff-token') return ok({ token: 'staff.jwt.token' });
      if (path === '/applications') return ok({ applications: [] });
      if (path.startsWith('/config/credit-rules')) return ok({ rules: {} });
      return ok({});
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderAs = (role: 'borrower' | 'credit_reviewer') =>
  render(<BackOffice language="en" currentRole={role} onRoleChange={() => {}} onCloseBackOffice={() => {}} />);

describe('Back office data loading', () => {
  it('borrower view does not call the staff-only endpoints', async () => {
    renderAs('borrower');
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c.path === '/applications' || c.path.startsWith('/config/credit-rules'))).toEqual([]);
  });

  it('a staff role signs in first; the list request relies on the session cookie', async () => {
    renderAs('credit_reviewer');
    await waitFor(() => expect(calls.some((c) => c.path === '/applications')).toBe(true));
    const tokenIdx = calls.findIndex((c) => c.path === '/auth/staff-token');
    const listIdx = calls.findIndex((c) => c.path === '/applications');
    expect(tokenIdx).toBeGreaterThanOrEqual(0);
    expect(tokenIdx).toBeLessThan(listIdx);
    expect(calls[listIdx]).toMatchObject({ auth: null, csrf: '1', credentials: 'include' });
    expect(JSON.stringify(localStorage)).not.toContain('staff.jwt.token');
  });
});
