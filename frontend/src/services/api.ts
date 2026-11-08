// Backend client for the borrower app. The admin dashboard has its own (admin-app/frontend/src/services/api.ts);
// both build on the shared request core in @quickloan/ui-core/services/apiCore.
import { User, LoanApplication, Language, NotificationItem } from '@quickloan/ui-core/types';
import {
  API_BASE_URL, authTokens, request, storeAuth, resolveFileUrl, downloadApplicationPdf,
  type ApiScope,
} from '@quickloan/ui-core/services/apiCore';

// The shared request core lives in apiCore.ts; re-exported so existing imports from this file keep working.
export { API_BASE_URL, ApiError, isNetworkError, authTokens } from '@quickloan/ui-core/services/apiCore';
export type { ApiScope, StaffRole, StaffAccount } from '@quickloan/ui-core/services/apiCore';

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

  // --- Files (Phase 2) -----------------------------------------------------
  async uploadFile(file: File, scope: ApiScope = 'borrower'): Promise<{ filename: string; url: string; mimeType: string; size: number; originalName: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await request<{ file: any }>('/upload', { method: 'POST', formData, scope });
    return res.file;
  },

  /** Absolute, token-bearing URL for <img src> / <a href> to a server-stored file. */
  resolveFileUrl(url: string | undefined, scope: ApiScope = 'borrower'): string | undefined {
    return resolveFileUrl(url, scope);
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
    return downloadApplicationPdf(app, scope, language);
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
  }): Promise<{ user: User; token: string; application: import('@quickloan/ui-core/types').FlowApplicationView }> {
    const res = await request<{ user: User; token: string; application: import('@quickloan/ui-core/types').FlowApplicationView }>(
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
  }): Promise<{ user: User; token: string; application: import('@quickloan/ui-core/types').FlowApplicationView }> {
    const res = await request<{ user: User; token: string; application: import('@quickloan/ui-core/types').FlowApplicationView }>(
      '/flow/google',
      { method: 'POST', body, auth: false }
    );
    authTokens.set(res.token);
    return res;
  },

  async getFlowApplication(): Promise<import('@quickloan/ui-core/types').FlowApplicationView> {
    const res = await request<{ application: import('@quickloan/ui-core/types').FlowApplicationView }>('/flow/application');
    return res.application;
  },

  async submitRegistrationConsent(payload: { disclaimerAccepted: boolean; locationGranted: boolean }): Promise<import('@quickloan/ui-core/types').FlowApplicationView> {
    const res = await request<{ application: import('@quickloan/ui-core/types').FlowApplicationView }>(
      '/flow/application/registration-consent',
      { method: 'POST', body: payload }
    );
    return res.application;
  },

  async saveFlowStepDraft(step: number, data: any): Promise<import('@quickloan/ui-core/types').FlowApplicationView> {
    const res = await request<{ application: import('@quickloan/ui-core/types').FlowApplicationView }>(
      `/flow/application/steps/${step}/draft`,
      { method: 'PUT', body: { data } }
    );
    return res.application;
  },

  async submitFlowStep(step: number, data?: any): Promise<import('@quickloan/ui-core/types').FlowApplicationView> {
    const res = await request<{ application: import('@quickloan/ui-core/types').FlowApplicationView }>(
      `/flow/application/steps/${step}/submit`,
      { method: 'POST', body: { data } }
    );
    return res.application;
  },

  async getCurrentTerms(): Promise<{ terms: Record<string, import('@quickloan/ui-core/types').TermsVersionRecord> }> {
    return request('/flow/terms/current');
  },
};
