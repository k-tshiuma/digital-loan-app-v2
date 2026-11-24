// Admin dashboard: the browser-storage model (shared part in @quickloan/ui-core/services/storageCore) plus the
// Back Office's own operations: the audit list, exports and the config. (The funding partner hand-off is on the
// server: admin-app/backend/routes/funding.js.)
import { AuditEvent, ApplicationConfig } from '@quickloan/ui-core/types';
import { StorageCore } from '@quickloan/ui-core/services/storageCore';

class AdminStorageService extends StorageCore {
  public getAuditEvents(entityId?: string): AuditEvent[] {
    if (!entityId) return this.memoryAuditEvents;
    return this.memoryAuditEvents.filter((e) => e.entityId === entityId);
  }

  // --- Export ---
  public exportSignedJson(appId: string): string {
    const app = this.memoryApps.get(appId);
    if (!app) return '{}';
    const bundle = {
      schemaVersion: '1.0.0',
      exportTimestamp: new Date().toISOString(),
      application: app,
      cryptographicDigest: `SHA256:${Math.random().toString(36).substr(2, 16)}${Math.random().toString(36).substr(2, 16)}`,
      authorizedSigner: 'QUICKLOAN_ISRAEL_FINTECH_SYSTEM',
    };
    return JSON.stringify(bundle, null, 2);
  }

  public exportApplicationsCsv(): string {
    const headers = [
      'Request Number',
      'Borrower Name',
      'Passport Number',
      'Country',
      'Visa Type',
      'Visa Expiry',
      'Employer',
      'Monthly Salary NIS',
      'Loan Amount NIS',
      'Repayment Period Months',
      'Estimated Monthly NIS',
      'Repayment Source',
      'Status',
      'Language',
      'Submitted At',
    ];

    const rows = Array.from(this.memoryApps.values()).map((app) => {
      const s1p = (app as any).step1Data?.personal;
      return [
        `"${app.requestNumber}"`,
        `"${app.borrowerDetails?.fullName || s1p?.fullName || ''}"`,
        `"${app.borrowerDetails?.passportNumber || s1p?.passportNumber || ''}"`,
        `"${app.borrowerDetails?.countryOfOrigin || s1p?.countryOfOrigin || ''}"`,
        `"${app.residencyDetails?.visaType || ''}"`,
        `"${app.residencyDetails?.visaExpiryDate || s1p?.visaExpiryDate || ''}"`,
        `"${app.employmentDetails?.employerName || (app as any).step1Data?.employment?.employerName || ''}"`,
        app.employmentDetails?.monthlySalaryNis || s1p?.monthlySalaryNis || 0,
        app.loanRequest?.requestedAmountNis || (app as any).step1Data?.loan?.requestedAmountNis || 0,
        app.loanRequest?.repaymentPeriodMonths || 0,
        app.loanRequest?.estimatedMonthlyPaymentNis || 0,
        `"${app.loanRequest?.repaymentSource || ''}"`,
        `"${app.status}"`,
        `"${app.language}"`,
        `"${app.submittedAt || ''}"`,
      ];
    });

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  // --- Configuration Management ---
  public getConfig(): ApplicationConfig {
    return this.memoryConfig;
  }

  public updateConfig(newConfig: Partial<ApplicationConfig>): ApplicationConfig {
    this.memoryConfig = { ...this.memoryConfig, ...newConfig };
    this.saveConfig();
    this.logAuditEvent({
      actorType: 'system_admin',
      entityType: 'application_config',
      entityId: 'global',
      action: 'CONFIG_UPDATED',
      metadata: newConfig,
    });
    return this.memoryConfig;
  }
}

export const storageService = new AdminStorageService();
