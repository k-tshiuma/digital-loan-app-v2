// Admin dashboard: the browser-storage model (shared part in @quickloan/ui-core/services/storageCore) plus the
// Back Office's own operations: the audit list, the simulated funding handoff, exports and the config.
import { AuditEvent, ApplicationConfig, FundingIntegrationRecord } from '@quickloan/ui-core/types';
import { StorageCore } from '@quickloan/ui-core/services/storageCore';

class AdminStorageService extends StorageCore {
  private memoryFundingIntegrations: FundingIntegrationRecord[] = [];

  public getAuditEvents(entityId?: string): AuditEvent[] {
    if (!entityId) return this.memoryAuditEvents;
    return this.memoryAuditEvents.filter((e) => e.entityId === entityId);
  }

  // --- Funding Entity Integration & Export ---
  public simulateFundingHandoff(appId: string, actorName = 'Funding Dispatcher'): FundingIntegrationRecord {
    const app = this.memoryApps.get(appId);
    if (!app) throw new Error('Application not found');

    const record: FundingIntegrationRecord = {
      id: `fund_${Date.now()}`,
      applicationId: app.id,
      providerCode: 'BANK_LEUMI_FINTECH_DIRECT',
      operation: 'submit_application',
      externalReference: `EXT-LEUMI-${Math.floor(100000 + Math.random() * 900000)}`,
      status: 'success',
      attemptCount: 1,
      requestMetadata: {
        requestNumber: app.requestNumber,
        borrowerName: app.borrowerDetails?.fullName,
        loanAmountNIS: app.loanRequest?.requestedAmountNis,
        repaymentMonths: app.loanRequest?.repaymentPeriodMonths,
        documentsCount: app.documents.length,
      },
      responseMetadata: {
        statusCode: 200,
        decisionEngine: 'LEUMI_CREDIT_V4',
        handoffToken: `tok_${Math.random().toString(36).substr(2, 12)}`,
      },
      lastAttemptAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    this.memoryFundingIntegrations.unshift(record);
    this.updateApplicationStatus(appId, 'Forwarded to Funding Entity', 'funding_entity', actorName, 'Real-time API push completed to funding partner gateway.');

    return record;
  }

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
