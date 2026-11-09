import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authTokens, request, SESSION_EXPIRED_EVENT } from '../apiCore';

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

  it('clears only the staff token for a staff request', async () => {
    authTokens.set(token({ sub: 'u1', type: 'borrower' }));
    authTokens.setStaff('credit_reviewer', token({ sub: 's1', type: 'staff', role: 'credit_reviewer' }));
    vi.stubGlobal('fetch', respond(401, { success: false }));
    await expect(request('/flow/applications', { scope: 'staff' })).rejects.toMatchObject({ status: 401 });
    expect(authTokens.getStaff()).toBeNull();
    expect(authTokens.get()).not.toBeNull();
    expect(events).toEqual(['staff']);
  });

  it('leaves everything alone for a 401 to a request without a token (e.g. a wrong password)', async () => {
    authTokens.set(token({ sub: 'u1', type: 'borrower' }));
    vi.stubGlobal('fetch', respond(401, { success: false, error: 'Incorrect password. Please try again.' }));
    await expect(request('/users/login', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({ status: 401 });
    expect(authTokens.get()).not.toBeNull();
    expect(events).toEqual([]);
  });

  it('keeps a token saved by a new sign-in while the request was on its way', async () => {
    const oldToken = token({ sub: 'u1', type: 'borrower' });
    const newToken = token({ sub: 'u1', type: 'borrower', fresh: true });
    authTokens.set(oldToken);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      authTokens.set(newToken);
      return { status: 401, ok: false, json: () => Promise.resolve({ success: false }) };
    }));
    await expect(request('/flow/application')).rejects.toMatchObject({ status: 401 });
    expect(authTokens.get()).toBe(newToken);
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
