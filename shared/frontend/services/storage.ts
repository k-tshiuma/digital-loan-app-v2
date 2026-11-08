import {
  LoanApplication,
  User,
  OTPCode,
  AuditEvent,
  NotificationItem,
  CanonicalStatus,
  Language,
  ApplicationConfig,
  FundingIntegrationRecord,
  UploadedFile,
  StatusHistoryItem,
} from '../types';
import { DEFAULT_APP_CONFIG } from '../config/appConfig';
import { t, isEnabledLanguage } from '../i18n/translations';
import { DEFAULT_STATUS_REASONS, statusLabel, statusReasonLabel } from '../i18n/options';
import { calculateIndicativeEligibility } from './eligibilityScoring';

const STORAGE_KEYS = {
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

class StorageService {
  private memoryUsers: Map<string, User> = new Map();
  private memoryApps: Map<string, LoanApplication> = new Map();
  private memoryOtpCodes: Map<string, OTPCode> = new Map();
  private memoryAuditEvents: AuditEvent[] = [];
  private memoryNotifications: NotificationItem[] = [];
  private memoryConfig: ApplicationConfig = { ...DEFAULT_APP_CONFIG };
  private memoryFundingIntegrations: FundingIntegrationRecord[] = [];

  constructor() {
    this.init();
  }

  private init() {
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

  private saveApps() {
    try {
      const list = Array.from(this.memoryApps.values());
      localStorage.setItem(STORAGE_KEYS.APPLICATIONS, JSON.stringify(list));
    } catch {}
  }

  private saveUsers() {
    try {
      const list = Array.from(this.memoryUsers.values());
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(list));
    } catch {}
  }

  private saveAudits() {
    try {
      localStorage.setItem(STORAGE_KEYS.AUDIT_EVENTS, JSON.stringify(this.memoryAuditEvents));
    } catch {}
  }

  private saveNotifications() {
    try {
      localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(this.memoryNotifications));
    } catch {}
  }

  private saveConfig() {
    try {
      localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(this.memoryConfig));
    } catch {}
  }

  // --- Auth & Registration ---
  public findUserByPhone(phoneNumber: string): User | undefined {
    const clean = phoneNumber.replace(/[\s()-]/g, '');
    return Array.from(this.memoryUsers.values()).find((u) => {
      const uClean = u.phoneNumber.replace(/[\s()-]/g, '');
      return uClean === clean || u.phoneNumber === phoneNumber;
    });
  }

  public findUserByEmail(email: string): User | undefined {
    const cleanEmail = email.trim().toLowerCase();
    return Array.from(this.memoryUsers.values()).find((u) => u.email?.toLowerCase() === cleanEmail);
  }

  public registerUser(details: {
    fullName: string;
    email: string;
    phoneNumber: string;
    password?: string;
    preferredLanguage?: Language;
  }): { success: boolean; user?: User; error?: string } {
    const existingByPhone = this.findUserByPhone(details.phoneNumber);
    if (existingByPhone && existingByPhone.password) {
      return { success: false, error: 'An account with this phone number already exists. Please sign in.' };
    }

    const existingByEmail = details.email ? this.findUserByEmail(details.email) : undefined;
    if (existingByEmail && existingByEmail.id !== existingByPhone?.id) {
      return { success: false, error: 'An account with this email address already exists. Please sign in.' };
    }

    let user = existingByPhone;
    if (user) {
      user.fullName = details.fullName;
      user.email = details.email;
      if (details.password) user.password = details.password;
      if (details.preferredLanguage) user.preferredLanguage = details.preferredLanguage;
      user.phoneVerifiedAt = new Date().toISOString();
      user.updatedAt = new Date().toISOString();
    } else {
      user = {
        id: `user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        phoneNumber: details.phoneNumber,
        fullName: details.fullName,
        email: details.email,
        password: details.password,
        authProvider: details.password ? 'password' : 'phone',
        phoneVerifiedAt: new Date().toISOString(),
        preferredLanguage: details.preferredLanguage || 'en',
        roles: ['borrower'],
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.memoryUsers.set(user.id, user);
    }

    this.saveUsers();
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, user.id);

    this.logAuditEvent({
      actorType: 'borrower',
      actorId: user.id,
      actorName: user.fullName || details.phoneNumber,
      entityType: 'users',
      entityId: user.id,
      action: 'USER_REGISTERED',
      metadata: { phoneNumber: details.phoneNumber, email: details.email },
    });

    return { success: true, user };
  }

  public loginWithPassword(identifier: string, password: string): { success: boolean; user?: User; error?: string } {
    const cleanId = identifier.trim();
    const isEmail = cleanId.includes('@');
    const user = isEmail ? this.findUserByEmail(cleanId) : this.findUserByPhone(cleanId);

    if (!user) {
      return { success: false, error: 'No account found with this phone number or email.' };
    }

    if (user.password && user.password !== password) {
      return { success: false, error: 'Incorrect password. Please try again.' };
    }

    user.updatedAt = new Date().toISOString();
    this.saveUsers();
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, user.id);

    this.logAuditEvent({
      actorType: 'borrower',
      actorId: user.id,
      actorName: user.fullName || user.phoneNumber,
      entityType: 'users',
      entityId: user.id,
      action: 'USER_SIGNED_IN_PASSWORD',
      metadata: { identifier },
    });

    return { success: true, user };
  }

  public loginWithGoogle(profile: { email: string; name: string; avatarUrl?: string }, preferredLanguage: Language = 'en'): { success: boolean; user: User } {
    let user = this.findUserByEmail(profile.email);
    if (!user) {
      user = {
        id: `user_google_${Date.now()}`,
        phoneNumber: '+972500000000',
        fullName: profile.name,
        email: profile.email,
        authProvider: 'google',
        phoneVerifiedAt: new Date().toISOString(),
        preferredLanguage,
        roles: ['borrower'],
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.memoryUsers.set(user.id, user);
    } else {
      user.fullName = profile.name;
      user.updatedAt = new Date().toISOString();
    }

    this.saveUsers();
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, user.id);

    this.logAuditEvent({
      actorType: 'borrower',
      actorId: user.id,
      actorName: profile.name,
      entityType: 'users',
      entityId: user.id,
      action: 'USER_SIGNED_IN_GOOGLE',
      metadata: { email: profile.email },
    });

    return { success: true, user };
  }

  public generateOTP(phoneNumber: string, preferredLanguage: Language = 'en'): { code: string; expiresAt: string; user: User } {
    let user = this.findUserByPhone(phoneNumber);
    if (!user) {
      user = {
        id: `user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        phoneNumber,
        preferredLanguage,
        roles: ['borrower'],
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.memoryUsers.set(user.id, user);
      this.saveUsers();
    }

    // Generate 6 digit code (deterministic demo helper if phone ends in 4567 -> 123456)
    const code = phoneNumber.endsWith('4567') ? '123456' : Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + this.memoryConfig.otpExpirationSeconds * 1000).toISOString();

    const otpRecord: OTPCode = {
      id: `otp_${Date.now()}`,
      userId: user.id,
      codeHash: code,
      expiresAt,
      attempts: 0,
      createdAt: new Date().toISOString(),
    };

    this.memoryOtpCodes.set(phoneNumber, otpRecord);

    this.logAuditEvent({
      actorType: 'system',
      actorId: user.id,
      actorName: 'SMS Gateway Mock',
      entityType: 'otp_codes',
      entityId: otpRecord.id,
      action: 'OTP_GENERATED',
      metadata: { phoneNumber, channel: 'sms' },
    });

    return { code, expiresAt, user };
  }

  public verifyOTP(phoneNumber: string, inputCode: string): { success: boolean; user?: User; error?: string } {
    const cleanCode = String(inputCode || '').trim();
    const record = this.memoryOtpCodes.get(phoneNumber);
    const isDemoAccepted = cleanCode === '123456' || (cleanCode.length === 6 && /^\d{6}$/.test(cleanCode));

    if (!record) {
      // Fallback check for demo / testing: accept 123456 or any 6-digit code for any phone number
      if (isDemoAccepted) {
        let user = this.findUserByPhone(phoneNumber);
        if (!user) {
          user = {
            id: `user_${Date.now()}`,
            phoneNumber,
            preferredLanguage: 'en',
            roles: ['borrower'],
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          this.memoryUsers.set(user.id, user);
          this.saveUsers();
        }
        localStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, user.id);
        return { success: true, user };
      }
      return { success: false, error: 'No active OTP request found for this number' };
    }

    if (new Date(record.expiresAt).getTime() < Date.now()) {
      return { success: false, error: 'OTP code has expired. Please request a new code.' };
    }

    if (record.codeHash !== cleanCode && !isDemoAccepted) {
      record.attempts = (record.attempts || 0) + 1;
      return { success: false, error: 'Incorrect verification code. Please try again.' };
    }

    record.consumedAt = new Date().toISOString();
    let user = this.memoryUsers.get(record.userId);
    if (!user) {
      user = this.findUserByPhone(phoneNumber);
    }
    if (!user) {
      user = {
        id: record.userId || `user_${Date.now()}`,
        phoneNumber,
        preferredLanguage: 'en',
        roles: ['borrower'],
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.memoryUsers.set(user.id, user);
    }

    user.phoneVerifiedAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    this.saveUsers();
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, user.id);

    this.logAuditEvent({
      actorType: 'borrower',
      actorId: user?.id,
      actorName: phoneNumber,
      entityType: 'users',
      entityId: user?.id || 'unknown',
      action: 'PHONE_AUTHENTICATED',
      metadata: { phoneNumber },
    });

    return { success: true, user };
  }

  public getCurrentUser(): User | null {
    const uid = localStorage.getItem(STORAGE_KEYS.CURRENT_USER_ID);
    if (!uid) return null;
    return this.memoryUsers.get(uid) || null;
  }

  /**
   * Make a user returned by the backend the session user, keeping the backend's id.
   *
   * The local login helpers (verifyOTP, loginWithPassword, ...) create their own local user with a
   * different id. Any such local copy with the same phone number or email is merged into this user:
   * its drafts and notifications move to the backend id, and its offline password is kept.
   * Without this, a reload restored the local id and every API call for it returned 403.
   */
  public adoptUser(serverUser: User): User {
    const samePerson = (u: User) =>
      u.id !== serverUser.id &&
      ((!!serverUser.phoneNumber && !serverUser.phoneNumber.startsWith('google:') && !!u.phoneNumber &&
        u.phoneNumber.replace(/[\s()-]/g, '') === serverUser.phoneNumber.replace(/[\s()-]/g, '')) ||
        (!!serverUser.email && !!u.email && u.email.toLowerCase() === serverUser.email.toLowerCase()));
    const twins = Array.from(this.memoryUsers.values()).filter(samePerson);
    const existing = this.memoryUsers.get(serverUser.id);

    const merged: User = {
      ...twins[0],
      ...existing,
      ...serverUser,
      password: serverUser.password ?? existing?.password ?? twins.find((t) => t.password)?.password,
    };

    if (twins.length > 0) {
      const twinIds = new Set(twins.map((t) => t.id));
      this.memoryApps.forEach((app) => {
        if (app.userId && twinIds.has(app.userId)) app.userId = merged.id;
      });
      this.memoryNotifications.forEach((n) => {
        if (n.userId && twinIds.has(n.userId)) n.userId = merged.id;
      });
      twins.forEach((t) => this.memoryUsers.delete(t.id));
      this.saveApps();
      this.saveNotifications();
    }

    this.memoryUsers.set(merged.id, merged);
    this.saveUsers();
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, merged.id);
    return merged;
  }

  /**
   * The session user on start-up. `tokenSubject` is the user id in the saved backend token, if any.
   * Browsers that saved a local user id before adoptUser existed are repaired here, before any request.
   */
  public restoreSession(tokenSubject: string | null): User | null {
    const current = this.getCurrentUser();
    if (!tokenSubject || current?.id === tokenSubject) return current;
    const known = this.memoryUsers.get(tokenSubject);
    if (known) return this.adoptUser(known);
    // Only the local copy is known: give it the backend id (details are refreshed from the API later).
    if (current) return this.adoptUser({ ...current, id: tokenSubject });
    return null;
  }

  /** Update the saved user's preferred language in the local copy. */
  public updateUserLanguage(userId: string, language: Language): User | null {
    const user = this.memoryUsers.get(userId);
    if (!user) return null;
    user.preferredLanguage = language;
    user.updatedAt = new Date().toISOString();
    this.saveUsers();
    return user;
  }

  public logout() {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_APPLICATION_ID);
  }

  // --- Duplicate Application Business Rule ---
  /**
   * "Prevent creation of a second open application associated with the same passport number or the same phone number."
   */
  public checkDuplicateOpenApplication(phoneNumber?: string, passportNumber?: string, excludeAppId?: string): { isDuplicate: boolean; existingRequestNumber?: string } {
    const openStatuses: CanonicalStatus[] = [
      'Received',
      'Under Review',
      'Additional Document Required',
      'Approved',
      'Forwarded to Funding Entity',
    ];

    for (const app of this.memoryApps.values()) {
      if (excludeAppId && app.id === excludeAppId) continue;
      if (!openStatuses.includes(app.status)) continue;

      if (phoneNumber && app.borrowerDetails?.mobilePhoneNumber === phoneNumber) {
        return { isDuplicate: true, existingRequestNumber: app.requestNumber };
      }
      if (passportNumber && app.borrowerDetails?.passportNumber.trim().toUpperCase() === passportNumber.trim().toUpperCase()) {
        return { isDuplicate: true, existingRequestNumber: app.requestNumber };
      }
    }
    return { isDuplicate: false };
  }

  // Evaluates documents from a previous application for safe reuse
  public evaluateReusableDocuments(prevApp: LoanApplication): UploadedFile[] {
    const reusableDocs: UploadedFile[] = [];
    if (!prevApp || !Array.isArray(prevApp.documents)) return reusableDocs;

    for (const d of prevApp.documents) {
      if (!d || !d.documentTypeCode) continue;
      let isValid = true;
      let reason = 'Reused from previous verified on-file records';

      // Visa validity check: must have >= 6 months remaining
      if (d.documentTypeCode === 'WORK_VISA' || d.documentTypeCode === 'WORKERS_CARD') {
        const expiry = prevApp.residencyDetails?.visaExpiryDate;
        if (expiry) {
          const expDate = new Date(expiry);
          const sixMonthsFromNow = new Date();
          sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
          if (expDate < sixMonthsFromNow) {
            isValid = false;
            reason = 'Visa expires in under 6 months or is expired. Please upload renewed visa permit.';
          }
        }
      }

      // Pay slip check: must be recent (past 90 days)
      if (d.documentTypeCode === 'PAY_SLIP') {
        const uploadedDate = new Date(d.uploadedAt || prevApp.submittedAt || 0);
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        if (uploadedDate < ninetyDaysAgo) {
          isValid = false;
          reason = 'Pay slip is older than 3 months. Israeli lending rules require recent proof of income.';
        }
      }

      if (isValid) {
        reusableDocs.push({
          ...d,
          id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          isReused: true,
          reusedFromAppId: prevApp.id,
          validityStatus: 'valid',
          validityReason: reason,
        });
      }
    }
    return reusableDocs;
  }

  // --- Application Lifecycle & Drafts ---
  public getOrCreateActiveApplication(user: User, preferredLanguage: Language): LoanApplication {
    const userApps = Array.from(this.memoryApps.values()).filter((a) => a.userId === user.id);

    // Find previous submitted or filled application for pre-populating on-file details
    const prevApp = userApps
      .filter((a) => a.isSubmitted || (a.borrowerDetails && a.borrowerDetails.passportNumber))
      .sort((a, b) => new Date(b.submittedAt || b.updatedAt || b.createdAt).getTime() - new Date(a.submittedAt || a.updatedAt || a.createdAt).getTime())[0];

    const activeAppId = localStorage.getItem(STORAGE_KEYS.ACTIVE_APPLICATION_ID);
    let existingDraft: LoanApplication | undefined;

    if (activeAppId) {
      const active = this.memoryApps.get(activeAppId);
      if (active && active.userId === user.id && !active.isSubmitted) {
        existingDraft = active;
      }
    }

    if (!existingDraft) {
      existingDraft = userApps.find((a) => !a.isSubmitted);
    }

    // If an existing unsubmitted draft exists, automatically ensure any saved profile/documents on file are prefilled
    if (existingDraft) {
      let draftModified = false;

      if (prevApp && prevApp.id !== existingDraft.id) {
        if ((!existingDraft.borrowerDetails || !existingDraft.borrowerDetails.passportNumber) && prevApp.borrowerDetails?.passportNumber) {
          existingDraft.borrowerDetails = { ...prevApp.borrowerDetails };
          draftModified = true;
        }
        if (!existingDraft.residencyDetails && prevApp.residencyDetails) {
          existingDraft.residencyDetails = { ...prevApp.residencyDetails };
          draftModified = true;
        }
        if (!existingDraft.employmentDetails && prevApp.employmentDetails) {
          existingDraft.employmentDetails = { ...prevApp.employmentDetails };
          draftModified = true;
        }
        if (!existingDraft.bankAccount && prevApp.bankAccount) {
          existingDraft.bankAccount = { ...prevApp.bankAccount };
          existingDraft.bankAccountConfirmed = prevApp.bankAccountConfirmed || false;
          draftModified = true;
        }
        if ((!existingDraft.guarantors || existingDraft.guarantors.length === 0) && (prevApp.guarantors?.length || prevApp.guarantor?.hasGuarantor)) {
          existingDraft.guarantors = prevApp.guarantors ? [...prevApp.guarantors] : (prevApp.guarantor ? [{
            id: 'g_1',
            fullName: prevApp.guarantor.fullName || '',
            passportOrIdNumber: prevApp.guarantor.passportOrIdNumber || '',
            mobilePhoneNumber: prevApp.guarantor.mobilePhoneNumber || '',
            relationship: prevApp.guarantor.relationship || 'Co-worker',
            otherRelationshipDetails: prevApp.guarantor.otherRelationshipDetails,
            idDocument: prevApp.guarantor.passportPhoto,
          }] : []);
          existingDraft.guarantor = prevApp.guarantor || existingDraft.guarantor;
          draftModified = true;
        }
        if ((!existingDraft.documents || existingDraft.documents.length === 0) && prevApp.documents?.length) {
          const reused = this.evaluateReusableDocuments(prevApp);
          if (reused.length > 0) {
            existingDraft.documents = reused;
            draftModified = true;
          }
        }
        existingDraft.isReturningUser = true;
      } else if (user.fullName && (!existingDraft.borrowerDetails || !existingDraft.borrowerDetails.fullName)) {
        existingDraft.borrowerDetails = {
          fullName: user.fullName,
          mobilePhoneNumber: user.phoneNumber || '',
          passportNumber: '',
          countryOfOrigin: '',
          dateOfBirth: '1995-06-15',
          addressCity: '',
          addressStreet: '',
          addressFull: '',
          maritalStatus: 'Single',
        };
        draftModified = true;
      }

      if (draftModified) {
        this.saveApplication(existingDraft);
      }
      localStorage.setItem(STORAGE_KEYS.ACTIVE_APPLICATION_ID, existingDraft.id);
      return existingDraft;
    }

    // No existing draft: generate fresh draft pre-filled with on-file records
    const reusableDocs = prevApp ? this.evaluateReusableDocuments(prevApp) : [];

    // Generate unique sequential human-readable request number: REQ-2026-000XXX
    const nextSeq = 100 + this.memoryApps.size + 1;
    const year = new Date().getFullYear();
    const requestNumber = `REQ-${year}-${String(nextSeq).padStart(6, '0')}`;

    const newApp: LoanApplication = {
      id: `app_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      userId: user.id,
      requestNumber,
      isSubmitted: false,
      status: 'Received',
      language: preferredLanguage || user.preferredLanguage || 'en',
      currentStep: prevApp ? 6 : 3,
      isReturningUser: !!prevApp,
      borrowerDetails: prevApp?.borrowerDetails ? { ...prevApp.borrowerDetails } : {
        fullName: user.fullName || '',
        mobilePhoneNumber: user.phoneNumber || '',
        passportNumber: '',
        countryOfOrigin: '',
        dateOfBirth: '',
        addressCity: '',
        addressStreet: '',
        addressFull: '',
        maritalStatus: 'Single',
      },
      residencyDetails: prevApp?.residencyDetails ? { ...prevApp.residencyDetails } : undefined,
      employmentDetails: prevApp?.employmentDetails ? { ...prevApp.employmentDetails } : undefined,
      bankAccount: prevApp?.bankAccount ? { ...prevApp.bankAccount } : undefined,
      bankAccountConfirmed: prevApp ? !!prevApp.bankAccountConfirmed : false,
      guarantor: prevApp?.guarantor ? { ...prevApp.guarantor } : { hasGuarantor: false },
      guarantors: prevApp?.guarantors ? [...prevApp.guarantors] : (prevApp?.guarantor?.hasGuarantor ? [{
        id: 'g_1',
        fullName: prevApp.guarantor.fullName || '',
        passportOrIdNumber: prevApp.guarantor.passportOrIdNumber || '',
        mobilePhoneNumber: prevApp.guarantor.mobilePhoneNumber || '',
        relationship: prevApp.guarantor.relationship || 'Co-worker',
        otherRelationshipDetails: prevApp.guarantor.otherRelationshipDetails,
        idDocument: prevApp.guarantor.passportPhoto,
      }] : []),
      documents: reusableDocs,
      consents: [],
      statusHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const initialScore = calculateIndicativeEligibility(newApp);
    newApp.eligibilityScore = initialScore.rawScore;
    newApp.eligibilityBreakdown = initialScore;

    this.memoryApps.set(newApp.id, newApp);
    this.saveApps();
    localStorage.setItem(STORAGE_KEYS.ACTIVE_APPLICATION_ID, newApp.id);

    this.logAuditEvent({
      actorType: 'borrower',
      actorId: user.id,
      entityType: 'applications',
      entityId: newApp.id,
      action: 'APPLICATION_CREATED',
      metadata: { requestNumber },
    });

    return newApp;
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

  public submitApplication(appId: string, ipAddress = '127.0.0.1'): LoanApplication {
    const app = this.memoryApps.get(appId);
    if (!app) throw new Error('Application not found');

    if (app.isSubmitted) {
      return app; // Idempotency protection against double submission
    }

    app.isSubmitted = true;
    app.submittedAt = new Date().toISOString();
    app.status = 'Received';
    app.currentStep = 10; // Submission success step

    const historyItem: StatusHistoryItem = {
      id: `sh_${Date.now()}`,
      applicationId: app.id,
      fromStatus: null,
      toStatus: 'Received',
      changedByType: 'borrower',
      changedByName: app.borrowerDetails?.fullName || 'Borrower',
      reason: DEFAULT_STATUS_REASONS.submitted,
      createdAt: new Date().toISOString(),
    };

    app.statusHistory = [historyItem, ...(app.statusHistory || [])];
    this.saveApplication(app);

    this.logAuditEvent({
      actorType: 'borrower',
      actorId: app.userId,
      actorName: app.borrowerDetails?.fullName,
      entityType: 'applications',
      entityId: app.id,
      action: 'APPLICATION_SUBMITTED',
      metadata: {
        requestNumber: app.requestNumber,
        loanAmount: app.loanRequest?.requestedAmountNis,
        period: app.loanRequest?.repaymentPeriodMonths,
      },
      ipAddress,
    });

    // Send instant SMS & Push notification in user language
    const lang = this.notificationLanguage(app);
    this.createNotification({
      userId: app.userId,
      applicationId: app.id,
      channel: 'sms',
      notificationType: 'SUBMISSION_CONFIRMATION',
      language: lang,
      title: t(lang, 'applicationSubmittedTitle'),
      message: `${t(lang, 'yourRequestNumber')}: ${app.requestNumber}. ${t(lang, 'keepRequestNumberNotice')}`,
      deliveryStatus: 'delivered',
    });

    return app;
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

  public getAuditEvents(entityId?: string): AuditEvent[] {
    if (!entityId) return this.memoryAuditEvents;
    return this.memoryAuditEvents.filter((e) => e.entityId === entityId);
  }

  // --- Notifications ---
  /** Same rule as the backend: the user's current language, then the application's, then English. */
  private notificationLanguage(app: LoanApplication): Language {
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

  public getNotifications(userId?: string): NotificationItem[] {
    if (!userId) return this.memoryNotifications;
    return this.memoryNotifications.filter((n) => n.userId === userId);
  }

  public markNotificationAsRead(id: string) {
    const notif = this.memoryNotifications.find((n) => n.id === id);
    if (notif) {
      notif.read = true;
      notif.isRead = true;
      this.saveNotifications();
    }
  }

  public markNotificationRead(id: string) {
    this.markNotificationAsRead(id);
  }

  public markAllNotificationsRead(userId?: string) {
    this.memoryNotifications.forEach((n) => {
      if (!userId || n.userId === userId) {
        n.read = true;
        n.isRead = true;
      }
    });
    this.saveNotifications();
  }

  public getUserApplications(userId: string): LoanApplication[] {
    return this.getAllApplications().filter((a) => a.userId === userId);
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

export const storageService = new StorageService();
