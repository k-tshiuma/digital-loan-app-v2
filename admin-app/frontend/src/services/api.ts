// Backend client for the admin dashboard (staff scope). The borrower app has its own
// (frontend/src/services/api.ts); both build on the shared request core in @quickloan/ui-core/services/apiCore.
import { normalizeFlowDetail } from './flowDetail';
import { LoanApplication, Language, AnalyticsSummary, CreditRules } from '@quickloan/ui-core/types';
import {
  ApiError, authTokens, request, resolveFileUrl, downloadApplicationPdf,
  type ApiScope, type StaffRole, type StaffAccount,
} from '@quickloan/ui-core/services/apiCore';

// Re-exported so the dashboard imports everything API-related from this file.
export { API_BASE_URL, ApiError, isNetworkError, authTokens, SESSION_EXPIRED_EVENT } from '@quickloan/ui-core/services/apiCore';
export type { ApiScope, StaffRole, StaffAccount } from '@quickloan/ui-core/services/apiCore';

export const apiService = {

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

  async listAllApplications(): Promise<LoanApplication[]> {
    const res = await request<{ applications: LoanApplication[] }>('/applications', { scope: 'staff' });
    return res.applications;
  },

  /** Absolute, token-bearing URL for <img src> / <a href> to a server-stored file. */
  resolveFileUrl(url: string | undefined, scope: ApiScope = 'borrower'): string | undefined {
    return resolveFileUrl(url, scope);
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

  async flowStaffLogin(email: string, password: string): Promise<{ token: string; staff: StaffAccount }> {
    const res = await request<{ token: string; staff: StaffAccount }>(
      '/auth/staff-login',
      { method: 'POST', body: { email, password }, auth: false }
    );
    authTokens.setStaff(res.staff.role, res.token, res.staff);
    return res;
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
