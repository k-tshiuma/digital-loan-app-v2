import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authTokens, request, setSessionStore, SESSION_EXPIRED_EVENT, resolveFileUrl, endServerSession } from '../apiCore';

// A syntactically valid, unexpired token (the client only reads its payload).
const token = (payload: Record<string, unknown>) =>
  `x.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload }))}.y`;

function respond(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({ status, ok: status < 400, json: () => Promise.resolve(body) });
}

describe('request(): a rejected session signs the user out', () => {
  let events: string[];
  const listener = (e: Event) => events.push((e as CustomEvent<{ scope: string }>).detail.scope);

  beforeEach(() => {
    localStorage.clear();
    events = [];
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);
  });
  afterEach(() => {
    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
    vi.unstubAllGlobals();
  });

  it('clears the borrower token and fires the event on a 401', async () => {
    authTokens.set(token({ sub: 'u1', type: 'borrower' }));
    vi.stubGlobal('fetch', respond(401, { success: false, error: 'Invalid or expired session. Please sign in again.' }));
    await expect(request('/flow/application')).rejects.toMatchObject({ status: 401 });
    expect(authTokens.get()).toBeNull();
    expect(events).toEqual(['borrower']);
  });

  it('uses the session store the app installed (the admin app: its staff session)', async () => {
    authTokens.set(token({ sub: 'u1', type: 'borrower' }));
    let staffSessionId: string | null = 'staff-session-1';
    const seen: { headers: Record<string, string>; credentials?: string }[] = [];
    setSessionStore({ scope: 'staff', get: () => staffSessionId, clear: () => { staffSessionId = null; } });
    try {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: { headers: Record<string, string>; credentials?: string }) => {
        seen.push(init);
        return { status: 401, ok: false, json: () => Promise.resolve({ success: false }) };
      }));
      await expect(request('/flow/applications')).rejects.toMatchObject({ status: 401 });
      expect(seen[0].headers.Authorization).toBeUndefined();
      expect(staffSessionId).toBeNull();
      expect(authTokens.get()).not.toBeNull();
      expect(events).toEqual(['staff']);
    } finally {
      setSessionStore(authTokens);
    }
  });

  it('leaves everything alone for a 401 to a request without a token (e.g. a wrong password)', async () => {
    authTokens.set(token({ sub: 'u1', type: 'borrower' }));
    vi.stubGlobal('fetch', respond(401, { success: false, error: 'Incorrect password. Please try again.' }));
    await expect(request('/users/login', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({ status: 401 });
    expect(authTokens.get()).not.toBeNull();
    expect(events).toEqual([]);
  });

  it('keeps a session started by a new sign-in while the request was on its way', async () => {
    authTokens.set(token({ sub: 'u1', type: 'borrower' }));
    let newSession: string | null = null;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      authTokens.set(token({ sub: 'u1', type: 'borrower' })); // same user, same second: still a new session
      newSession = authTokens.get();
      return { status: 401, ok: false, json: () => Promise.resolve({ success: false }) };
    }));
    await expect(request('/flow/application')).rejects.toMatchObject({ status: 401 });
    expect(newSession).not.toBeNull();
    expect(authTokens.get()).toBe(newSession);
    expect(events).toEqual([]);
  });

  it('does nothing special for other errors', async () => {
    authTokens.set(token({ sub: 'u1', type: 'borrower' }));
    vi.stubGlobal('fetch', respond(403, { success: false, error: 'Forbidden' }));
    await expect(request('/flow/application')).rejects.toMatchObject({ status: 403 });
    expect(authTokens.get()).not.toBeNull();
    expect(events).toEqual([]);
  });
});

describe('HttpOnly cookie sessions: the app never keeps or sends the token', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('a sign-in keeps only the user id and expiry', () => {
    const t = token({ sub: 'user_42', type: 'borrower' });
    authTokens.set(t);
    expect(JSON.stringify(localStorage)).not.toContain(t);
    expect(authTokens.subject()).toBe('user_42');
    expect(authTokens.get()).toMatch(/^s_/);
  });

  it('an expired session counts as signed out', () => {
    authTokens.set(`x.${btoa(JSON.stringify({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 10 }))}.y`);
    expect(authTokens.get()).toBeNull();
    expect(authTokens.subject()).toBeNull();
  });

  it('every request sends the cookie and the CSRF header, never an Authorization header', async () => {
    authTokens.set(token({ sub: 'u1', type: 'borrower' }));
    const fetchMock = respond(200, { success: true });
    vi.stubGlobal('fetch', fetchMock);
    await request('/flow/application/steps/1/draft', { method: 'PUT', body: { a: 1 } });
    const init = fetchMock.mock.calls[0][1];
    expect(init.credentials).toBe('include');
    expect(init.headers['X-QuickLoan-Request']).toBe('1');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('file links carry no token', () => {
    authTokens.set(token({ sub: 'u1', type: 'borrower' }));
    expect(resolveFileUrl('/api/uploads/a.pdf')).toMatch(/\/api\/uploads\/a\.pdf$/);
    expect(resolveFileUrl('/api/uploads/a.pdf')).not.toContain('token');
  });

  it('signing out asks the API to delete its cookie, and never throws when offline', async () => {
    const fetchMock = respond(200, { success: true });
    vi.stubGlobal('fetch', fetchMock);
    await endServerSession();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/logout$/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(endServerSession()).resolves.toBeUndefined();
  });

  it('removes tokens saved by older versions on start-up (borrower, and staff from the single-app days)', async () => {
    localStorage.setItem('quickloan_auth_token', token({ sub: 'old', type: 'borrower' }));
    localStorage.setItem('quickloan_staff_token_v1', JSON.stringify({ role: 'credit_reviewer', token: token({ type: 'staff' }) }));
    vi.resetModules();
    await import('../apiCore');
    expect(localStorage.getItem('quickloan_auth_token')).toBeNull();
    expect(localStorage.getItem('quickloan_staff_token_v1')).toBeNull();
  });
});
