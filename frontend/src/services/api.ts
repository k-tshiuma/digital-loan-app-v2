import { normalizeFlowDetail } from './flowDetail';
import {
  User,
  LoanApplication,
  Language,
  NotificationItem,
  AnalyticsSummary,
  CreditRules,
  UserRole,
} from '../types';

export const API_BASE_URL: string =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL) || 'http://localhost:5000/api';
const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

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
async function request<T = any>(
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

type AuthResponse = { success: true; user: User; token: string };

function storeAuth(res: AuthResponse): User {
  authTokens.set(res.token);
  return res.user;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const apiService = {
  // --- Auth (Phase 1) ------------------------------------------------------
  isAuthenticated(): boolean {
    return !!authTokens.get();
  },

  /** The signed-in borrower, as the backend knows them. */
  async getMe(): Promise<User> {
    const res = await request<{ success: true; user: User }>('/users/me');
    return res.user;
  },

  async updatePreferredLanguage(language: Language): Promise<User> {
    const res = await request<{ success: true; user: User }>('/users/me/language', { method: 'PUT', body: { language } });
    return res.user;
  },

  async lookupPhone(phoneNumber: string): Promise<{ exists: boolean; hasPassword: boolean }> {
    return request('/users/lookup', { method: 'POST', body: { phoneNumber }, auth: false });
  },

  /** `language` is the language on screen; the SMS is sent in it. */
  async requestOtp(phoneNumber: string, language?: Language): Promise<{ demoCode?: string; expiresInSeconds: number }> {
    return request('/users/request-otp', { method: 'POST', body: { phoneNumber, language }, auth: false });
  },

  async verifyOTP(phoneNumber: string, code: string, preferredLanguage?: Language): Promise<User> {
    return storeAuth(await request('/users/verify-otp', { method: 'POST', body: { phoneNumber, code, preferredLanguage }, auth: false }));
  },

  async loginWithPassword(identifier: string, password: string): Promise<User> {
    return storeAuth(await request('/users/login', { method: 'POST', body: { identifier, password }, auth: false }));
  },

  /** Completes registration for a phone number that was just verified via OTP. */
  async register(details: { fullName: string; email: string; phoneNumber: string; password: string; preferredLanguage?: Language }): Promise<User> {
    return storeAuth(await request('/users/register', { method: 'POST', body: details }));
  },

  async loginWithGoogleDemo(profile: { email: string; name: string }, preferredLanguage: Language): Promise<User> {
    return storeAuth(await request('/users/google-demo', { method: 'POST', body: { ...profile, preferredLanguage }, auth: false }));
  },

  async forgotPassword(identifier: string, language?: Language): Promise<{ message: string; demoCode?: string }> {
    return request('/users/forgot-password', { method: 'POST', body: { identifier, language }, auth: false });
  },

  async resetPassword(identifier: string, code: string, newPassword: string): Promise<User> {
    return storeAuth(await request('/users/reset-password', { method: 'POST', body: { identifier, code, newPassword }, auth: false }));
  },

  logout() {
    authTokens.clear();
  },

  /** Back-office demo auth: obtains (and caches) a staff JWT for the selected role. Blocked if a borrower is signed in. */
  async ensureStaffToken(role: StaffRole): Promise<string> {
    if (authTokens.get()) {
      throw new ApiError('Back-office access required', 403);
    }
    const cached = authTokens.getStaff(role);
    if (cached) return cached;
    const res = await request<{ token: string }>('/auth/staff-token', { method: 'POST', body: { role }, auth: false });
    const existingStaff = authTokens.getStaffSession()?.staff;
    authTokens.setStaff(role, res.token, existingStaff);
    return res.token;
  },

  // --- Applications --------------------------------------------------------
  async saveApplication(app: LoanApplication, scope: ApiScope = 'borrower'): Promise<LoanApplication> {
    const res = await request<{ application: LoanApplication }>(`/applications/${app.id}`, { method: 'PUT', body: app, scope });
    return res.application;
  },

  async getActiveApplication(userId: string, scope: ApiScope = 'borrower'): Promise<{ application: LoanApplication; isReturningUser: boolean; previousDocumentsReport?: any[] }> {
    return request(`/applications/active/${userId}`, { scope });
  },

  async getApplication(id: string, scope: ApiScope = 'borrower'): Promise<LoanApplication> {
    const res = await request<{ application: LoanApplication }>(`/applications/${id}`, { scope });
    return res.application;
  },

  async getApplicationHistory(userId: string): Promise<LoanApplication[]> {
    const res = await request<{ applications: LoanApplication[] }>(`/applications/history/${userId}`);
    return res.applications;
  },

  async listAllApplications(): Promise<LoanApplication[]> {
    const res = await request<{ applications: LoanApplication[] }>('/applications', { scope: 'staff' });
    return res.applications;
  },

  // --- Files (Phase 2) -----------------------------------------------------
  async uploadFile(file: File, scope: ApiScope = 'borrower'): Promise<{ filename: string; url: string; mimeType: string; size: number; originalName: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await request<{ file: any }>('/upload', { method: 'POST', formData, scope });
    return res.file;
  },

  /** Absolute, token-bearing URL for <img src> / <a href> to a server-stored file. */
  resolveFileUrl(url: string | undefined, scope: ApiScope = 'borrower'): string | undefined {
    if (!url) return undefined;
    if (!url.startsWith('/api/')) return url;
    const token = scope === 'staff' ? authTokens.getStaff() : authTokens.get();
    return `${API_ORIGIN}${url}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },

  // --- Real-time (Phase 4) -------------------------------------------------
  /** Opens an SSE stream for an application. Returns null when not authenticated. */
  openApplicationEvents(applicationId: string): EventSource | null {
    const token = authTokens.get();
    if (!token) return null;
    return new EventSource(`${API_BASE_URL}/applications/${applicationId}/events?token=${encodeURIComponent(token)}`);
  },

  // --- Notifications (Phase 5) ---------------------------------------------
  /** The user's notifications, newest first. The backend's `read` flag is exposed as `isRead`, like local ones. */
  async getNotifications(userId: string): Promise<NotificationItem[]> {
    const res = await request<{ notifications: NotificationItem[] }>(`/notifications/${userId}`);
    return (res.notifications || []).map((n) => ({ ...n, isRead: n.isRead ?? !!n.read }));
  },

  async markNotificationRead(id: string): Promise<void> {
    await request(`/notifications/${id}/read`, { method: 'PATCH' });
  },

  async markAllNotificationsRead(userId: string): Promise<void> {
    await request(`/notifications/${userId}/read-all`, { method: 'POST' });
  },

  // --- PDF (Phase 7) -------------------------------------------------------
  /** `language` picks the PDF language (the language on screen); without it the backend uses the application's. */
  async downloadApplicationPdf(
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
  },

  // --- Analytics (Phase 3) -------------------------------------------------
  async getAnalyticsSummary(): Promise<AnalyticsSummary> {
    const res = await request<{ summary: AnalyticsSummary }>('/analytics/summary', { scope: 'staff' });
    return res.summary;
  },

  // --- Credit rules (Phase 8) ----------------------------------------------
  async getCreditRules(): Promise<{ rules: CreditRules; defaults: CreditRules }> {
    return request('/config/credit-rules', { scope: 'staff' });
  },

  async updateCreditRules(rules: Partial<CreditRules>): Promise<{ rules: CreditRules; rescored: number }> {
    return request('/config/credit-rules', { method: 'PUT', body: { rules }, scope: 'staff' });
  },

  // -------------------------------------------------------------------------
  // 3-Step Approval Workflow Endpoints
  // -------------------------------------------------------------------------
  async flowRegister(details: {
    fullName: string;
    email: string;
    phoneNumber: string;
    password: string;
    code: string;
    language?: Language;
    registration: { disclaimerAccepted: boolean; locationGranted: boolean };
    /** Files uploaded in this form before the account existed; the backend moves them to the new account. */
    uploadedFiles?: string[];
  }): Promise<{ user: User; token: string; application: import('../types').FlowApplicationView }> {
    const res = await request<{ user: User; token: string; application: import('../types').FlowApplicationView }>(
      '/flow/register',
      { method: 'POST', body: details, auth: false }
    );
    authTokens.set(res.token);
    return res;
  },

  async flowGoogle(body: {
    idToken?: string;
    demo?: { email: string; name: string };
    language?: Language;
    registration?: { disclaimerAccepted: boolean; locationGranted: boolean };
  }): Promise<{ user: User; token: string; application: import('../types').FlowApplicationView }> {
    const res = await request<{ user: User; token: string; application: import('../types').FlowApplicationView }>(
      '/flow/google',
      { method: 'POST', body, auth: false }
    );
    authTokens.set(res.token);
    return res;
  },

  async flowStaffLogin(email: string, password: string): Promise<{ token: string; staff: StaffAccount }> {
    const res = await request<{ token: string; staff: StaffAccount }>(
      '/auth/staff-login',
      { method: 'POST', body: { email, password }, auth: false }
    );
    authTokens.setStaff(res.staff.role, res.token, res.staff);
    return res;
  },

  async getFlowApplication(): Promise<import('../types').FlowApplicationView> {
    const res = await request<{ application: import('../types').FlowApplicationView }>('/flow/application');
    return res.application;
  },

  async submitRegistrationConsent(payload: { disclaimerAccepted: boolean; locationGranted: boolean }): Promise<import('../types').FlowApplicationView> {
    const res = await request<{ application: import('../types').FlowApplicationView }>(
      '/flow/application/registration-consent',
      { method: 'POST', body: payload }
    );
    return res.application;
  },

  async saveFlowStepDraft(step: number, data: any): Promise<import('../types').FlowApplicationView> {
    const res = await request<{ application: import('../types').FlowApplicationView }>(
      `/flow/application/steps/${step}/draft`,
      { method: 'PUT', body: { data } }
    );
    return res.application;
  },

  async submitFlowStep(step: number, data?: any): Promise<import('../types').FlowApplicationView> {
    const res = await request<{ application: import('../types').FlowApplicationView }>(
      `/flow/application/steps/${step}/submit`,
      { method: 'POST', body: { data } }
    );
    return res.application;
  },

  async getCurrentTerms(): Promise<{ terms: Record<string, import('../types').TermsVersionRecord> }> {
    return request('/flow/terms/current');
  },

  // Staff Back Office Flow
  async listFlowApplications(params?: { group?: string; status?: string; q?: string }): Promise<{
    applications: any[];
    counts: { total: number; byGroup: Record<string, number>; byStatus: Record<string, number> };
  }> {
    const query = new URLSearchParams();
    if (params?.group) query.set('group', params.group);
    if (params?.status) query.set('status', params.status);
    if (params?.q) query.set('q', params.q);
    const qs = query.toString();
    return request(`/flow/applications${qs ? `?${qs}` : ''}`, { scope: 'staff' });
  },

  async getFlowApplicationDetail(id: string, revealBank = false): Promise<any> {
    const raw = await request(`/flow/applications/${id}${revealBank ? '?revealBank=1' : ''}`, { scope: 'staff' });
    return normalizeFlowDetail(raw);
  },

  async submitStepDecision(id: string, step: number, decision: 'approve' | 'reject' | 'request_changes', note?: string): Promise<any> {
    return request(`/flow/applications/${id}/steps/${step}/decision`, {
      method: 'POST',
      body: { decision, note },
      scope: 'staff',
    });
  },

  async submitFinalDecision(id: string, payload: { status: string; reason?: string; missingNote?: string }): Promise<any> {
    return request(`/flow/applications/${id}/final-decision`, {
      method: 'POST',
      body: payload,
      scope: 'staff',
    });
  },

  async sendApplicantStaffMessage(id: string, message: string): Promise<any> {
    return request(`/flow/applications/${id}/message`, {
      method: 'POST',
      body: { message },
      scope: 'staff',
    });
  },

  async getFlowSummary(): Promise<{ summary: any }> {
    return request('/flow/summary', { scope: 'staff' });
  },
};
