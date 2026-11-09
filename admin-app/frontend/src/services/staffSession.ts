// The staff session record. Admin app only: the borrower app never contains this code.
// The token itself is in the admin API's HttpOnly cookie (ql_staff); this keeps only the role, the account and
// the expiry, to restore the dashboard on start-up. api.ts installs it as the request core's session. The old
// saved token (quickloan_staff_token_v1) is deleted by apiCore on start-up.
import { readTokenPayload, isUnexpired, newSessionId, type SessionStore } from '@quickloan/ui-core/services/apiCore';
import { UserRole } from '@quickloan/ui-core/types';

const STAFF_SESSION_KEY = 'quickloan_staff_session_v2';

export type StaffRole = Exclude<UserRole, 'borrower'>;
export interface StaffAccount {
  id: string;
  email: string;
  fullName: string;
  role: StaffRole;
}
export interface StaffSessionData {
  /** Changes with every sign-in. */
  id: string;
  role: StaffRole;
  /** Token expiry (JWT seconds), or null if unknown. */
  exp: number | null;
  staff?: StaffAccount;
}

/** The saved session, if it hasn't expired. */
function load(): StaffSessionData | null {
  try {
    const s = JSON.parse(localStorage.getItem(STAFF_SESSION_KEY) || 'null') as StaffSessionData | null;
    if (s && s.id && s.role && isUnexpired(s.exp)) return s;
  } catch {
    /* ignore */
  }
  return null;
}

export const staffSession: SessionStore & {
  getSession(): StaffSessionData | null;
  /** True when signed in, optionally only as `role` (the demo role picker signs in one role at a time). */
  hasRole(role?: StaffRole): boolean;
  /** Records a sign-in from the token in the response: only its expiry is kept, with the role and account. */
  save(role: StaffRole, token: string, staff?: StaffAccount): StaffSessionData;
} = {
  scope: 'staff',
  get() {
    return load()?.id ?? null;
  },
  clear() {
    localStorage.removeItem(STAFF_SESSION_KEY);
  },
  getSession: load,
  hasRole(role) {
    const s = load();
    return !!s && (!role || s.role === role);
  },
  save(role, token, staff) {
    const payload = readTokenPayload(token);
    if (payload && payload.type !== undefined && payload.type !== 'staff') throw new Error('Not a staff session');
    const data: StaffSessionData = {
      id: newSessionId(),
      role,
      exp: typeof payload?.exp === 'number' ? payload.exp : null,
      ...(staff ? { staff } : {}),
    };
    localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(data));
    return data;
  },
};
