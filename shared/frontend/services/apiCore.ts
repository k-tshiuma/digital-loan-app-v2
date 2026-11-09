// The backend request core shared by both apps: base URL, error type, the session record and the request
// helper. Each app builds its own endpoint methods on top of it (see api.ts).
//
// Sessions live in HttpOnly cookies set by the API (shared/backend/core/sessionCookie.js): the app never sees
// or stores the token. Every request sends the cookie (credentials: 'include') and the X-QuickLoan-Request
// header the API requires for cookie-signed changes (CSRF). The app only remembers who is signed in and until
// when, to restore the session on start-up and to notice when it ends.
import { User, LoanApplication, Language } from '../types';

export const API_BASE_URL: string =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL) || 'http://localhost:5000/api';
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

const SESSION_KEY = 'quickloan_session_v2';
/**
 * Before HttpOnly cookies the tokens themselves were kept under these keys: the borrower token, and the staff
 * token (also on the borrower site, from when the Back Office was part of it). Deleted on start-up in both apps.
 */
const LEGACY_TOKEN_KEYS = ['quickloan_auth_token', 'quickloan_staff_token_v1'];
/** Sent with every request; the API refuses cookie-signed changes without it (CSRF). */
export const CSRF_HEADERS: Record<string, string> = { 'X-QuickLoan-Request': '1' };

export class ApiError extends Error {
  status: number;
  /** Machine-readable error code from the backend (e.g. 'VALIDATION', 'ACCOUNT_EXISTS'). */
  code?: string;
  /** Per-field error codes from a VALIDATION response: { field: 'required' | 'invalid' | ... }. */
  fieldErrors?: Record<string, string>;
  constructor(message: string, status: number, details: { code?: string; fieldErrors?: Record<string, string> } = {}) {
    super(message);
    this.status = status;
    this.code = details.code;
    this.fieldErrors = details.fieldErrors;
  }
}

/** True when the request failed because the backend could not be reached (vs. an API error). */
export const isNetworkError = (err: unknown) => !(err instanceof ApiError);

// ---------------------------------------------------------------------------
// Session record: who is signed in and until when (never the token; that is in the HttpOnly cookie)
// ---------------------------------------------------------------------------
/** The payload of a JWT, without checking it (the server does that). Read once at sign-in, then dropped. */
export function readTokenPayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/** A new id for each sign-in, so a 401 to an older request can't end a newer session. */
export const newSessionId = () => `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/** False when `exp` (JWT seconds) is within 5 s; true without one. */
export const isUnexpired = (exp: unknown) => typeof exp !== 'number' || exp * 1000 > Date.now() + 5000;

/**
 * Where an app records its session. Each app has exactly one: the borrower app the default below
 * (`authTokens`), the admin app its staff session (admin-app/frontend/src/services/staffSession.ts),
 * installed with setSessionStore. `get()` returns the current session's id (not a token), or null.
 */
export interface SessionStore {
  /** Sent as detail.scope with SESSION_EXPIRED_EVENT: 'borrower' or 'staff'. */
  scope: string;
  get(): string | null;
  clear(): void;
}

interface BorrowerSessionRecord {
  id: string;
  sub: string | null;
  exp: number | null;
}

function readBorrowerSession(): BorrowerSessionRecord | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as BorrowerSessionRecord | null;
    return s && s.id && isUnexpired(s.exp) ? s : null;
  } catch {
    return null;
  }
}

try {
  LEGACY_TOKEN_KEYS.forEach((key) => localStorage.removeItem(key));
} catch {
  /* storage unavailable */
}

/** The borrower session (the default). The name is historical: no token is stored. */
export const authTokens = {
  scope: 'borrower',
  /** The current session's id, or null when signed out or past its expiry. */
  get(): string | null {
    return readBorrowerSession()?.id ?? null;
  },
  /** Records a sign-in from the token in the response: only its user id and expiry are kept. */
  set(token: string) {
    const payload = readTokenPayload(token);
    const record: BorrowerSessionRecord = {
      id: newSessionId(),
      sub: typeof payload?.sub === 'string' ? payload.sub : null,
      exp: typeof payload?.exp === 'number' ? payload.exp : null,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(record));
  },
  clear() {
    localStorage.removeItem(SESSION_KEY);
  },
  /** The signed-in borrower's backend user id, if the session is still valid. */
  subject(): string | null {
    return readBorrowerSession()?.sub ?? null;
  },
};

let session: SessionStore = authTokens;

/** The admin app calls this once with its staff session. */
export function setSessionStore(store: SessionStore) {
  session = store;
}

/**
 * Fired on window when the backend rejects a saved token (expired, signed with an old secret, account
 * gone). The token is already cleared; each app listens and returns to its sign-in screen.
 * detail: { scope: 'borrower' | 'staff' }.
 */
export const SESSION_EXPIRED_EVENT = 'quickloan:session-expired';

// ---------------------------------------------------------------------------
// Core request helper: sends the session cookie and the CSRF header
// ---------------------------------------------------------------------------
export async function request<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; formData?: FormData; auth?: boolean } = {}
): Promise<T> {
  const { method = 'GET', body, formData, auth = true } = opts;
  const headers: Record<string, string> = { ...CSRF_HEADERS };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // `auth: false` (sign-in, registration): a 401 there is a wrong password, not an ended session.
  const sentSession = auth ? session.get() : null;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  // 401 to a request made in a session: the session is no longer valid. Unless the user has signed in
  // again meanwhile, forget it and tell the app.
  if (res.status === 401 && sentSession && session.get() === sentSession) {
    session.clear();
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { scope: session.scope } }));
  }
  if (!res.ok || data.success === false) {
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status, { code: data.code, fieldErrors: data.fieldErrors });
  }
  return data as T;
}

export type AuthResponse = { success: true; user: User; token: string };

export function storeAuth(res: AuthResponse): User {
  authTokens.set(res.token);
  return res.user;
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Absolute URL for <img src> / <a href> to a server-stored file. The browser sends the session cookie. */
export function resolveFileUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith('/api/')) return url;
  return `${API_ORIGIN}${url}`;
}

/** Ends the session on the server too: only the API can delete its HttpOnly cookie. Never throws. */
export async function endServerSession(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', headers: { ...CSRF_HEADERS }, credentials: 'include' });
  } catch {
    /* offline: the cookie expires on its own */
  }
}

/** `language` picks the PDF language (the language on screen); without it the backend uses the application's. */
export async function downloadApplicationPdf(
  app: LoanApplication | Pick<LoanApplication, 'id' | 'requestNumber'>,
  language?: Language
): Promise<void> {
  const pdfUrl = `${API_BASE_URL}/applications/${app.id}/pdf${language ? `?lang=${encodeURIComponent(language)}` : ''}`;
  let res: Response | null = null;

  try {
    res = await fetch(pdfUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
      credentials: 'include',
      body: JSON.stringify(app),
    });
  } catch {
    // POST attempt failed; fallback to GET
  }

  if (!res || !res.ok) {
    try {
      res = await fetch(pdfUrl, {
        method: 'GET',
        headers: { ...CSRF_HEADERS },
        credentials: 'include',
      });
    } catch (err) {
      throw new ApiError('Could not connect to server. Please verify the backend is running.', 0);
    }
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || `PDF export failed (${res.status})`, res.status);
  }
  triggerDownload(await res.blob(), `${app.requestNumber || app.id}.pdf`);
}
