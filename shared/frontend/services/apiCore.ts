// The backend request core shared by both apps: base URL, error type, token storage and the request
// helper. Each app builds its own endpoint methods on top of it (see api.ts).
import { User, LoanApplication, Language } from '../types';

export const API_BASE_URL: string =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL) || 'http://localhost:5000/api';
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

const TOKEN_KEY = 'quickloan_auth_token';

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
// Token storage (JWT in localStorage, per plan step 1.6)
// ---------------------------------------------------------------------------
/** The payload of a JWT, without checking it (the server does that). */
export function readTokenPayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/** False for a missing token or one that expires within 5 s. */
export const isTokenUsable = (token: string | null): token is string => {
  if (!token) return false;
  const exp = readTokenPayload(token)?.exp;
  return typeof exp !== 'number' || exp * 1000 > Date.now() + 5000;
};

/**
 * Where an app keeps its login token. Each app has exactly one: the borrower app the default below
 * (`authTokens`), the admin app its staff session (admin-app/frontend/src/services/staffSession.ts),
 * installed with setSessionStore. Every request, file URL and PDF download uses it.
 */
export interface SessionStore {
  /** Sent as detail.scope with SESSION_EXPIRED_EVENT: 'borrower' or 'staff'. */
  scope: string;
  get(): string | null;
  clear(): void;
}

/** The borrower session (the default). */
export const authTokens = {
  scope: 'borrower',
  get(): string | null {
    const t = localStorage.getItem(TOKEN_KEY);
    return isTokenUsable(t) ? t : null;
  },
  set(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
  },
  /** The backend user id in the saved borrower token, if it is still valid. */
  subject(): string | null {
    const t = this.get();
    const sub = t ? readTokenPayload(t)?.sub : null;
    return typeof sub === 'string' ? sub : null;
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
// Core request helper — attaches Authorization: Bearer <token>
// ---------------------------------------------------------------------------
export async function request<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; formData?: FormData; auth?: boolean } = {}
): Promise<T> {
  const { method = 'GET', body, formData, auth = true } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const sentToken = auth ? session.get() : null;
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  // 401 to a request that carried a token: the session is no longer valid. Unless the user has signed in
  // again meanwhile, drop the token and tell the app.
  if (res.status === 401 && sentToken && session.get() === sentToken) {
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

/** Absolute, token-bearing URL for <img src> / <a href> to a server-stored file. */
export function resolveFileUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith('/api/')) return url;
  const token = session.get();
  return `${API_ORIGIN}${url}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/** `language` picks the PDF language (the language on screen); without it the backend uses the application's. */
export async function downloadApplicationPdf(
  app: LoanApplication | Pick<LoanApplication, 'id' | 'requestNumber'>,
  language?: Language
): Promise<void> {
  const token = session.get();
  const pdfUrl = `${API_BASE_URL}/applications/${app.id}/pdf${language ? `?lang=${encodeURIComponent(language)}` : ''}`;
  let res: Response | null = null;

  try {
    res = await fetch(pdfUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(app),
    });
  } catch {
    // POST attempt failed; fallback to GET
  }

  if (!res || !res.ok) {
    try {
      res = await fetch(pdfUrl, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
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
