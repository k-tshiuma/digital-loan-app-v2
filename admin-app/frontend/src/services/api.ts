// Backend client for the admin dashboard. The borrower app has its own (borrower-app/frontend/src/services/api.ts);
// both build on the shared request core in @quickloan/ui-core/services/apiCore. Every call uses the staff session.
import { normalizeFlowDetail } from './flowDetail';
import { LoanApplication, Language, AnalyticsSummary, CreditRules } from '@quickloan/ui-core/types';
import { request, resolveFileUrl, downloadApplicationPdf, setSessionStore } from '@quickloan/ui-core/services/apiCore';
import { staffSession, type StaffRole, type StaffAccount } from './staffSession';

setSessionStore(staffSession);

// Re-exported so the dashboard imports everything API-related from this file.
export { API_BASE_URL, ApiError, isNetworkError, SESSION_EXPIRED_EVENT } from '@quickloan/ui-core/services/apiCore';
export { staffSession } from './staffSession';
export type { StaffRole, StaffAccount, StaffSessionData } from './staffSession';

export const apiService = {

  /** Back-office demo auth: obtains (and caches) a staff JWT for the selected role. */
  async ensureStaffToken(role: StaffRole): Promise<string> {
    const cached = staffSession.getToken(role);
    if (cached) return cached;
    const res = await request<{ token: string }>('/auth/staff-token', { method: 'POST', body: { role }, auth: false });
    staffSession.save(role, res.token, staffSession.getSession()?.staff);
    return res.token;
  },

  // --- Applications --------------------------------------------------------
  async saveApplication(app: LoanApplication): Promise<LoanApplication> {
    const res = await request<{ application: LoanApplication }>(`/applications/${app.id}`, { method: 'PUT', body: app });
    return res.application;
  },

  async listAllApplications(): Promise<LoanApplication[]> {
    const res = await request<{ applications: LoanApplication[] }>('/applications');
    return res.applications;
  },

  /** Absolute, token-bearing URL for <img src> / <a href> to a server-stored file. */
  resolveFileUrl(url: string | undefined): string | undefined {
    return resolveFileUrl(url);
  },

  // --- PDF (Phase 7) -------------------------------------------------------
  /** `language` picks the PDF language (the language on screen); without it the backend uses the application's. */
  async downloadApplicationPdf(
    app: LoanApplication | Pick<LoanApplication, 'id' | 'requestNumber'>,
    language?: Language
  ): Promise<void> {
    return downloadApplicationPdf(app, language);
  },

  // --- Analytics (Phase 3) -------------------------------------------------
  async getAnalyticsSummary(): Promise<AnalyticsSummary> {
    const res = await request<{ summary: AnalyticsSummary }>('/analytics/summary');
    return res.summary;
  },

  // --- Credit rules (Phase 8) ----------------------------------------------
  async getCreditRules(): Promise<{ rules: CreditRules; defaults: CreditRules }> {
    return request('/config/credit-rules');
  },

  async updateCreditRules(rules: Partial<CreditRules>): Promise<{ rules: CreditRules; rescored: number }> {
    return request('/config/credit-rules', { method: 'PUT', body: { rules } });
  },

  async flowStaffLogin(email: string, password: string): Promise<{ token: string; staff: StaffAccount }> {
    const res = await request<{ token: string; staff: StaffAccount }>(
      '/auth/staff-login',
      { method: 'POST', body: { email, password }, auth: false }
    );
    staffSession.save(res.staff.role, res.token, res.staff);
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
    return request(`/flow/applications${qs ? `?${qs}` : ''}`);
  },

  async getFlowApplicationDetail(id: string, revealBank = false): Promise<any> {
    const raw = await request(`/flow/applications/${id}${revealBank ? '?revealBank=1' : ''}`);
    return normalizeFlowDetail(raw);
  },

  async submitStepDecision(id: string, step: number, decision: 'approve' | 'reject' | 'request_changes', note?: string): Promise<any> {
    return request(`/flow/applications/${id}/steps/${step}/decision`, {
      method: 'POST',
      body: { decision, note },
    });
  },

  async submitFinalDecision(id: string, payload: { status: string; reason?: string; missingNote?: string }): Promise<any> {
    return request(`/flow/applications/${id}/final-decision`, {
      method: 'POST',
      body: payload,
    });
  },

  async sendApplicantStaffMessage(id: string, message: string): Promise<any> {
    return request(`/flow/applications/${id}/message`, {
      method: 'POST',
      body: { message },
    });
  },

  async getFlowSummary(): Promise<{ summary: any }> {
    return request('/flow/summary');
  },
};
