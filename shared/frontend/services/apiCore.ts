// The backend request core shared by both apps: base URL, error type, token storage and the request
// helper. Each app builds its own endpoint methods on top of it (see api.ts).
import { User, UserRole, LoanApplication, Language } from '../types';

export const API_BASE_URL: string =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL) || 'http://localhost:5000/api';
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

const TOKEN_KEY = 'quickloan_auth_token';
const STAFF_TOKEN_KEY = 'quickloan_staff_token_v1';

export type ApiScope = 'borrower' | 'staff';
export type StaffRole = Exclude<UserRole, 'borrower'>;
export interface StaffAccount {
  id: string;
  email: string;
  fullName: string;
  role: StaffRole;
}

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
function tokenPayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

function tokenExpiry(token: string): number | null {
  const exp = tokenPayload(token)?.exp;
  return typeof exp === 'number' ? exp * 1000 : null;
}

const isTokenValid = (token: string | null): token is string => {
  if (!token) return false;
  const exp = tokenExpiry(token);
  return exp === null || exp > Date.now() + 5000;
};

export const authTokens = {
  get(): string | null {
    const t = localStorage.getItem(TOKEN_KEY);
    return isTokenValid(t) ? t : null;
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
    const sub = t ? tokenPayload(t)?.sub : null;
    return typeof sub === 'string' ? sub : null;
  },
  getStaff(role?: StaffRole): string | null {
    try {
      const cached = JSON.parse(localStorage.getItem(STAFF_TOKEN_KEY) || 'null') as { role: StaffRole; token: string; staff?: StaffAccount } | null;
      if (cached && isTokenValid(cached.token) && (!role || cached.role === role)) {
        const payload = tokenPayload(cached.token);
        if (payload === null || payload.type === 'staff') {
          return cached.token;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  },
  getStaffSession(): { role: StaffRole; token: string; staff?: StaffAccount } | null {
    try {
      const cached = JSON.parse(localStorage.getItem(STAFF_TOKEN_KEY) || 'null') as { role: StaffRole; token: string; staff?: StaffAccount } | null;
      if (cached && isTokenValid(cached.token)) {
        const payload = tokenPayload(cached.token);
        if (payload === null || payload.type === 'staff') {
          return cached;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  },
  setStaff(role: StaffRole, token: string, staff?: StaffAccount) {
    localStorage.setItem(STAFF_TOKEN_KEY, JSON.stringify({ role, token, ...(staff ? { staff } : {}) }));
  },
  clearStaff() {
    localStorage.removeItem(STAFF_TOKEN_KEY);
  },
};

// ---------------------------------------------------------------------------
// Core request helper — attaches Authorization: Bearer <token>
// ---------------------------------------------------------------------------
export async function request<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; formData?: FormData; scope?: ApiScope; auth?: boolean } = {}
): Promise<T> {
  const { method = 'GET', body, formData, scope = 'borrower', auth = true } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = scope === 'staff' ? authTokens.getStaff() : authTokens.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
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
export function resolveFileUrl(url: string | undefined, scope: ApiScope = 'borrower'): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith('/api/')) return url;
  const token = scope === 'staff' ? authTokens.getStaff() : authTokens.get();
  return `${API_ORIGIN}${url}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/** `language` picks the PDF language (the language on screen); without it the backend uses the application's. */
export async function downloadApplicationPdf(
  app: LoanApplication | Pick<LoanApplication, 'id' | 'requestNumber'>,
  scope: ApiScope = 'borrower',
  language?: Language
): Promise<void> {
  const token = scope === 'staff' ? authTokens.getStaff() : authTokens.get();
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
