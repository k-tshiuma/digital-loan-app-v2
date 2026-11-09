// The staff session (JWT in localStorage). Admin app only: the borrower app never contains this code.
// api.ts installs it as the request core's session, so every API call uses the staff token.
import { readTokenPayload, isTokenUsable, type SessionStore } from '@quickloan/ui-core/services/apiCore';
import { UserRole } from '@quickloan/ui-core/types';

const STAFF_TOKEN_KEY = 'quickloan_staff_token_v1';

export type StaffRole = Exclude<UserRole, 'borrower'>;
export interface StaffAccount {
  id: string;
  email: string;
  fullName: string;
  role: StaffRole;
}
export interface StaffSessionData {
  role: StaffRole;
  token: string;
  staff?: StaffAccount;
}

/** The saved session, if its token is still usable and really a staff token. */
function load(): StaffSessionData | null {
  try {
    const cached = JSON.parse(localStorage.getItem(STAFF_TOKEN_KEY) || 'null') as StaffSessionData | null;
    if (cached && isTokenUsable(cached.token)) {
      const payload = readTokenPayload(cached.token);
      if (payload === null || payload.type === 'staff') return cached;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export const staffSession: SessionStore & {
  getSession(): StaffSessionData | null;
  getToken(role?: StaffRole): string | null;
  save(role: StaffRole, token: string, staff?: StaffAccount): void;
} = {
  scope: 'staff',
  get() {
    return load()?.token ?? null;
  },
  clear() {
    localStorage.removeItem(STAFF_TOKEN_KEY);
  },
  getSession: load,
  /** The token, optionally only if it is for `role` (the demo role picker caches one role at a time). */
  getToken(role) {
    const s = load();
    return s && (!role || s.role === role) ? s.token : null;
  },
  save(role, token, staff) {
    localStorage.setItem(STAFF_TOKEN_KEY, JSON.stringify({ role, token, ...(staff ? { staff } : {}) }));
  },
};
