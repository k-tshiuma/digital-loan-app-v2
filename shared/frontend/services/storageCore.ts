// The browser-storage model both apps share: storage keys, demo seed data, loading and saving, and the
// operations both apps perform on an application (read, save, status change, audit, notifications).
// Each app extends it with its own part: borrower-app/frontend/src/services/storage.ts (sign-in helpers,
// drafts, submission, inbox) and admin-app/frontend/src/services/storage.ts (audit list, funding handoff,
// exports, config). Each app runs on its own origin, so each has its own copy of this data.
import {
  LoanApplication,
  User,
  AuditEvent,
  NotificationItem,
  CanonicalStatus,
  Language,
  ApplicationConfig,
  StatusHistoryItem,
} from '../types';
import { DEFAULT_APP_CONFIG } from '../config/appConfig';
import { t, isEnabledLanguage } from '../i18n/translations';
import { statusLabel, statusReasonLabel } from '../i18n/options';
import { calculateIndicativeEligibility } from './eligibilityScoring';

export const STORAGE_KEYS = {
  USERS: 'quickloan_users_v1',
  APPLICATIONS: 'quickloan_applications_v1',
  ACTIVE_APPLICATION_ID: 'quickloan_active_app_id',
  CURRENT_USER_ID: 'quickloan_current_user_id',
  AUDIT_EVENTS: 'quickloan_audit_events_v1',
  NOTIFICATIONS: 'quickloan_notifications_v1',
  CONFIG: 'quickloan_config_v1',
  FUNDING_INTEGRATIONS: 'quickloan_funding_integrations_v1',
  DRAFT_BACKUP: 'quickloan_draft_backup_v1',
};

// Seed initial applications for rich back-office and testing experience
const SEED_APPLICATIONS: LoanApplication[] = [
  {
    id: 'app_seed_1',
    userId: 'user_seed_1',
    requestNumber: 'REQ-2026-000118',
    isSubmitted: true,
    submittedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    status: 'Under Review',
    language: 'th',
    currentStep: 11,
    borrowerDetails: {
      fullName: 'Somchai Prasert',
      passportNumber: 'AA9845123',
      countryOfOrigin: 'Thailand',
      dateOfBirth: '1992-05-14',
      mobilePhoneNumber: '+972501234567',
      addressCity: 'Netanya',
      addressStreet: 'Herzl St 42, Moshav Beit Yanai Farm',
      addressFull: 'Herzl St 42, Moshav Beit Yanai Farm, Netanya',
      maritalStatus: 'Married',
    },
    residencyDetails: {
      visaType: 'b1_agri',
      visaExpiryDate: '2027-04-30',
      dateOfEntry: '2022-03-10',
      yearsOfResidency: 4.4,
    },
    employmentDetails: {
      employerName: 'Moshav Beit Yanai Agri Corp',
      staffingAgencyName: 'Central Manpower Israel',
      jobTenureMonths: 28,
      monthlySalaryNis: 7800,
      salaryPaymentMethod: 'Bank transfer',
    },
    loanRequest: {
      requestedAmountNis: 6000,
      loanPurpose: 'Cash flow',
      repaymentPeriodMonths: 6,
      repaymentSource: 'Bank transfer',
      estimatedMonthlyPaymentNis: 1045,
      totalRepaymentNis: 6330,
    },
    guarantor: {
      hasGuarantor: true,
      fullName: 'Kovit Somwang',
      passportOrIdNumber: 'TH5521990',
      mobilePhoneNumber: '+972528994411',
      relationship: 'Friend',
    },
    documents: [
      {
        id: 'doc_1',
        applicationId: 'app_seed_1',
        documentTypeCode: 'PASSPORT',
        originalFilename: 'somchai_passport.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: 245000,
        storageKey: 's3://quickloan-docs/somchai_passport.jpg',
        uploadSource: 'camera',
        qualityStatus: 'passed',
        ocrStatus: 'completed',
        ocrExtractedData: {
          passportNumber: 'AA9845123',
          fullName: 'SOMCHAI PRASERT',
          confidence: 0.98,
        },
        userConfirmed: true,
        uploadedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: 'doc_2',
        applicationId: 'app_seed_1',
        documentTypeCode: 'WORK_VISA',
        originalFilename: 'somchai_visa.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: 310000,
        storageKey: 's3://quickloan-docs/somchai_visa.jpg',
        uploadSource: 'camera',
        qualityStatus: 'passed',
        ocrStatus: 'completed',
        ocrExtractedData: {
          visaExpiryDate: '2027-04-30',
          confidence: 0.95,
        },
        userConfirmed: true,
        uploadedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: 'doc_3',
        applicationId: 'app_seed_1',
        documentTypeCode: 'PAY_SLIP',
        originalFilename: 'payslip_july2026.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 520000,
        storageKey: 's3://quickloan-docs/payslip_july2026.pdf',
        uploadSource: 'file',
        qualityStatus: 'passed',
        ocrStatus: 'not_requested',
        userConfirmed: true,
        uploadedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: 'doc_4',
        applicationId: 'app_seed_1',
        documentTypeCode: 'EMPLOYMENT_CONFIRMATION',
        originalFilename: 'agri_corp_letter.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 410000,
        storageKey: 's3://quickloan-docs/agri_corp_letter.pdf',
        uploadSource: 'file',
        qualityStatus: 'passed',
        ocrStatus: 'not_requested',
        userConfirmed: true,
        uploadedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: 'doc_5',
        applicationId: 'app_seed_1',
        documentTypeCode: 'BANK_STATEMENT',
        originalFilename: 'mizrahi_statement.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 680000,
        storageKey: 's3://quickloan-docs/mizrahi_statement.pdf',
        uploadSource: 'file',
        qualityStatus: 'passed',
        ocrStatus: 'not_requested',
        userConfirmed: true,
        uploadedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      },
    ],
    consents: [
      {
        id: 'con_1',
        applicationId: 'app_seed_1',
        consentType: 'terms_and_conditions',
        consentVersion: '2026.1',
        consentGiven: true,
        givenAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: 'con_2',
        applicationId: 'app_seed_1',
        consentType: 'credit_check',
        consentVersion: '2026.1',
        consentGiven: true,
        givenAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      },
    ],
    digitalSignature: {
      id: 'sig_1',
      applicationId: 'app_seed_1',
      signatureMethod: 'typed_name',
      signatureValue: 'Somchai Prasert',
      signedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      ipAddress: '82.80.114.22',
      deviceMetadata: 'Mobile Safari / iPhone 13 (iOS 19.4)',
    },
    statusHistory: [
      {
        id: 'sh_1',
        applicationId: 'app_seed_1',
        fromStatus: null,
        toStatus: 'Received',
        changedByType: 'borrower',
        changedByName: 'Somchai Prasert',
        createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: 'sh_2',
        applicationId: 'app_seed_1',
        fromStatus: 'Received',
        toStatus: 'Under Review',
        changedByType: 'credit_reviewer',
        changedByName: 'Dana Ben-Ari (Credit Officer)',
        reason: 'Initial document check verified; proceeding with credit assessment.',
        createdAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
      },
    ],
    createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
  },
  {
    id: 'app_seed_2',
    userId: 'user_seed_2',
    requestNumber: 'REQ-2026-000122',
    isSubmitted: true,
    submittedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
    status: 'Additional Document Required',
    language: 'tl',
    currentStep: 11,
    borrowerDetails: {
      fullName: 'Maria Santos',
      passportNumber: 'P7829104B',
      countryOfOrigin: 'Philippines',
      dateOfBirth: '1988-11-20',
      mobilePhoneNumber: '+972547788990',
      addressCity: 'Tel Aviv-Yafo',
      addressStreet: 'Ibn Gabirol 112',
      addressFull: 'Ibn Gabirol 112, Apt 4, Tel Aviv-Yafo',
      maritalStatus: 'Single',
    },
    residencyDetails: {
      visaType: 'b1_care',
      visaExpiryDate: '2027-09-15',
      dateOfEntry: '2021-08-01',
      yearsOfResidency: 5.0,
    },
    employmentDetails: {
      employerName: 'Levy Family Care',
      staffingAgencyName: 'Matan Caregiving Agency',
      jobTenureMonths: 36,
      monthlySalaryNis: 8200,
      salaryPaymentMethod: 'Bank transfer',
    },
    loanRequest: {
      requestedAmountNis: 5000,
      loanPurpose: 'Cash flow',
      repaymentPeriodMonths: 6,
      repaymentSource: 'Bank transfer',
      estimatedMonthlyPaymentNis: 875,
      totalRepaymentNis: 5250,
    },
    guarantor: {
      hasGuarantor: false,
    },
    documents: [
      {
        id: 'doc_201',
        applicationId: 'app_seed_2',
        documentTypeCode: 'PASSPORT',
        originalFilename: 'maria_passport.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: 280000,
        storageKey: 's3://quickloan-docs/maria_passport.jpg',
        uploadSource: 'camera',
        qualityStatus: 'passed',
        ocrStatus: 'completed',
        ocrExtractedData: {
          passportNumber: 'P7829104B',
          fullName: 'MARIA SANTOS',
        },
        userConfirmed: true,
        uploadedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
      },
    ],
    consents: [
      {
        id: 'con_201',
        applicationId: 'app_seed_2',
        consentType: 'terms_and_conditions',
        consentVersion: '2026.1',
        consentGiven: true,
        givenAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
      },
    ],
    digitalSignature: {
      id: 'sig_201',
      applicationId: 'app_seed_2',
      signatureMethod: 'typed_name',
      signatureValue: 'Maria Santos',
      signedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
    },
    statusHistory: [
      {
        id: 'sh_201',
        applicationId: 'app_seed_2',
        fromStatus: null,
        toStatus: 'Received',
        changedByType: 'borrower',
        createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: 'sh_202',
        applicationId: 'app_seed_2',
        fromStatus: 'Received',
        toStatus: 'Additional Document Required',
        changedByType: 'credit_reviewer',
        changedByName: 'Ronit Shapira (Senior Underwriter)',
        reason: 'Please upload the latest 3 months bank statement to complete income verification.',
        createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
      },
    ],
    missingDocumentNotes: 'Please upload bank statement covering May-July 2026.',
    createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
  },
  {
    id: 'app_seed_3',
    userId: 'user_seed_3',
    requestNumber: 'REQ-2026-000109',
    isSubmitted: true,
    submittedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
    status: 'Forwarded to Funding Entity',
    language: 'zh',
    currentStep: 11,
    borrowerDetails: {
      fullName: 'Zhang Wei',
      passportNumber: 'E90184421',
      countryOfOrigin: 'China',
      dateOfBirth: '1985-02-18',
      mobilePhoneNumber: '+972533344556',
      addressCity: 'Petah Tikva',
      addressStreet: 'Jabotinsky 88',
      addressFull: 'Jabotinsky 88, Petah Tikva',
      maritalStatus: 'Married',
    },
    residencyDetails: {
      visaType: 'b1_const',
      visaExpiryDate: '2027-11-30',
      dateOfEntry: '2020-01-15',
      yearsOfResidency: 6.6,
    },
    employmentDetails: {
      employerName: 'Shikun & Binui Construction Ltd.',
      jobTenureMonths: 48,
      monthlySalaryNis: 11500,
      salaryPaymentMethod: 'Bank transfer',
    },
    loanRequest: {
      requestedAmountNis: 10000,
      loanPurpose: 'Investment',
      repaymentPeriodMonths: 12,
      repaymentSource: 'Bank transfer',
      estimatedMonthlyPaymentNis: 915,
      totalRepaymentNis: 11080,
    },
    guarantor: { hasGuarantor: false },
    documents: [],
    consents: [],
    statusHistory: [
      {
        id: 'sh_301',
        applicationId: 'app_seed_3',
        fromStatus: 'Received',
        toStatus: 'Under Review',
        changedByType: 'system',
        createdAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: 'sh_302',
        applicationId: 'app_seed_3',
        fromStatus: 'Under Review',
        toStatus: 'Approved',
        changedByType: 'credit_reviewer',
        changedByName: 'Credit Board Alpha',
        createdAt: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: 'sh_303',
        applicationId: 'app_seed_3',
        fromStatus: 'Approved',
        toStatus: 'Forwarded to Funding Entity',
        changedByType: 'funding_entity',
        changedByName: 'Bank Leumi FinTech Partner Bridge',
        reason: 'Loan package transmitted securely via TLS 1.3 REST handoff.',
        createdAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
      },
    ],
    createdAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
  },
];

export class StorageCore {
  protected memoryUsers: Map<string, User> = new Map();
  protected memoryApps: Map<string, LoanApplication> = new Map();
  protected memoryAuditEvents: AuditEvent[] = [];
  protected memoryNotifications: NotificationItem[] = [];
  protected memoryConfig: ApplicationConfig = { ...DEFAULT_APP_CONFIG };

  constructor() {
    this.init();
  }

  protected init() {
    try {
      // Load applications
      const appsJson = localStorage.getItem(STORAGE_KEYS.APPLICATIONS);
      if (appsJson) {
        const list: LoanApplication[] = JSON.parse(appsJson);
        list.forEach((app) => this.memoryApps.set(app.id, app));
      } else {
        SEED_APPLICATIONS.forEach((app) => this.memoryApps.set(app.id, app));
        this.saveApps();
      }

      // Load users
      const usersJson = localStorage.getItem(STORAGE_KEYS.USERS);
      if (usersJson) {
        const list: User[] = JSON.parse(usersJson);
        list.forEach((u) => this.memoryUsers.set(u.id, u));
      } else {
        const seedUsers: User[] = [
          {
            id: 'user_seed_1',
            phoneNumber: '+972501234567',
            phoneVerifiedAt: new Date().toISOString(),
            preferredLanguage: 'th',
            roles: ['borrower'],
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: 'user_seed_2',
            phoneNumber: '+972547788990',
            phoneVerifiedAt: new Date().toISOString(),
            preferredLanguage: 'tl',
            roles: ['borrower'],
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];
        seedUsers.forEach((u) => this.memoryUsers.set(u.id, u));
        this.saveUsers();
      }

      // Load audits
      const auditJson = localStorage.getItem(STORAGE_KEYS.AUDIT_EVENTS);
      if (auditJson) {
        this.memoryAuditEvents = JSON.parse(auditJson);
      }

      // Load notifications
      const notifJson = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
      if (notifJson) {
        this.memoryNotifications = JSON.parse(notifJson);
      }

      // Load config
      const configJson = localStorage.getItem(STORAGE_KEYS.CONFIG);
      if (configJson) {
        this.memoryConfig = JSON.parse(configJson);
      }
    } catch {
      // Fallback
    }
  }

  protected saveApps() {
    try {
      const list = Array.from(this.memoryApps.values());
      localStorage.setItem(STORAGE_KEYS.APPLICATIONS, JSON.stringify(list));
    } catch {}
  }

  protected saveUsers() {
    try {
      const list = Array.from(this.memoryUsers.values());
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(list));
    } catch {}
  }

  protected saveAudits() {
    try {
      localStorage.setItem(STORAGE_KEYS.AUDIT_EVENTS, JSON.stringify(this.memoryAuditEvents));
    } catch {}
  }

  protected saveNotifications() {
    try {
      localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(this.memoryNotifications));
    } catch {}
  }

  protected saveConfig() {
    try {
      localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(this.memoryConfig));
    } catch {}
  }

  public saveApplication(app: LoanApplication): LoanApplication {
    app.updatedAt = new Date().toISOString();
    
    // Authoritative calculation of indicative eligibility
    const score = calculateIndicativeEligibility(app);
    app.eligibilityScore = score.rawScore;
    app.eligibilityBreakdown = score;

    this.memoryApps.set(app.id, { ...app });
    this.saveApps();

    // Update user account in memoryUsers if fullName provided
    if (app.userId) {
      const u = this.memoryUsers.get(app.userId);
      if (u) {
        if (app.borrowerDetails?.fullName && app.borrowerDetails.fullName !== u.fullName) {
          u.fullName = app.borrowerDetails.fullName;
        }
        u.updatedAt = new Date().toISOString();
        this.saveUsers();
      }
    }

    // Also store local draft backup for offline resilience
    try {
      localStorage.setItem(STORAGE_KEYS.DRAFT_BACKUP, JSON.stringify(app));
    } catch {}

    return app;
  }

  public getApplication(id: string): LoanApplication | null {
    return this.memoryApps.get(id) || null;
  }

  public getAllApplications(): LoanApplication[] {
    return Array.from(this.memoryApps.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  // --- Canonical Status Changes & Back Office ---
  public updateApplicationStatus(
    appId: string,
    newStatus: CanonicalStatus,
    actorType: 'customer_service' | 'credit_reviewer' | 'system_admin' | 'funding_entity',
    actorName: string,
    reason?: string,
    missingDocNotes?: string
  ): LoanApplication {
    const app = this.memoryApps.get(appId);
    if (!app) throw new Error('Application not found');

    const previousStatus = app.status;
    app.status = newStatus;
    if (missingDocNotes) {
      app.missingDocumentNotes = missingDocNotes;
    }

    const historyItem: StatusHistoryItem = {
      id: `sh_${Date.now()}`,
      applicationId: app.id,
      fromStatus: previousStatus,
      toStatus: newStatus,
      changedByType: actorType,
      changedByName: actorName,
      reason: reason || `Status updated to ${newStatus}`,
      createdAt: new Date().toISOString(),
    };

    app.statusHistory = [historyItem, ...(app.statusHistory || [])];
    this.saveApplication(app);

    this.logAuditEvent({
      actorType,
      actorName,
      entityType: 'applications',
      entityId: app.id,
      action: `STATUS_CHANGED_${newStatus.replace(/\s+/g, '_').toUpperCase()}`,
      metadata: { previousStatus, newStatus, reason },
    });

    // Dispatch translated notification (staff-typed notes are sent as typed)
    const lang = this.notificationLanguage(app);
    let statusDesc = '';
    if (newStatus === 'Received') statusDesc = t(lang, 'statusReceivedDesc');
    else if (newStatus === 'Under Review') statusDesc = t(lang, 'statusUnderReviewDesc');
    else if (newStatus === 'Additional Document Required') statusDesc = missingDocNotes || t(lang, 'statusAdditionalDocDesc');
    else if (newStatus === 'Approved') statusDesc = t(lang, 'statusApprovedDesc');
    else if (newStatus === 'Rejected') statusDesc = reason ? statusReasonLabel(lang, reason) : t(lang, 'statusRejectedDesc');
    else if (newStatus === 'Forwarded to Funding Entity') statusDesc = t(lang, 'statusForwardedDesc');

    this.createNotification({
      userId: app.userId,
      applicationId: app.id,
      channel: 'sms',
      notificationType: `STATUS_${newStatus}`,
      language: lang,
      title: `QuickLoan: ${statusLabel(lang, newStatus)}`,
      message: `[${app.requestNumber}] ${statusDesc}`,
      deliveryStatus: 'delivered',
    });

    return app;
  }

  // --- Audit Logging (Append-Only) ---
  public logAuditEvent(event: Omit<AuditEvent, 'id' | 'createdAt'>): AuditEvent {
    const audit: AuditEvent = {
      ...event,
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      createdAt: new Date().toISOString(),
    };
    this.memoryAuditEvents.unshift(audit);
    this.saveAudits();
    return audit;
  }

  // --- Notifications ---
  /** Same rule as the backend: the user's current language, then the application's, then English. */
  protected notificationLanguage(app: LoanApplication): Language {
    const user = app.userId ? this.memoryUsers.get(app.userId) : undefined;
    const lang = user?.preferredLanguage || app.language;
    return isEnabledLanguage(lang) ? lang : 'en';
  }

  public createNotification(notif: Omit<NotificationItem, 'id' | 'createdAt'>): NotificationItem {
    const item: NotificationItem = {
      ...notif,
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      createdAt: new Date().toISOString(),
      attemptedAt: new Date().toISOString(),
      deliveredAt: new Date().toISOString(),
      read: false,
    };
    this.memoryNotifications.unshift(item);
    this.saveNotifications();
    return item;
  }
}
