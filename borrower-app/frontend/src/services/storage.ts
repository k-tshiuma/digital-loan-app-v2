// Borrower app: the browser-storage model (shared part in @quickloan/ui-core/services/storageCore) plus the
// borrower's own operations: local sign-in helpers and OTP, the session user, drafts and returning-user prefill,
// submission, and the notification inbox.
import {
  LoanApplication,
  User,
  OTPCode,
  CanonicalStatus,
  Language,
  NotificationItem,
  UploadedFile,
  StatusHistoryItem,
} from '@quickloan/ui-core/types';
import { t } from '@quickloan/ui-core/i18n/translations';
import { DEFAULT_STATUS_REASONS } from '@quickloan/ui-core/i18n/options';
import { calculateIndicativeEligibility } from '@quickloan/ui-core/services/eligibilityScoring';
import { StorageCore, STORAGE_KEYS } from '@quickloan/ui-core/services/storageCore';

class BorrowerStorageService extends StorageCore {
  private memoryOtpCodes: Map<string, OTPCode> = new Map();

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
}

export const storageService = new BorrowerStorageService();
