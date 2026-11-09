/**
 * Routes of the 3-step loan application workflow (flowVersion = 2 applications).
 *
 *   registerApplicantPublic(app)  before the global `authenticate` middleware: applicant sign-up, Google
 *   registerStaffPublic(app)      before it too: staff login
 *   registerApplicant(app)        after it: applicant step endpoints and terms
 *   registerStaff(app)            after it: Back Office queue, detail, decisions, messages, audit
 *
 * Applicant and staff routes are registered separately so the borrower and admin backends can each
 * mount only their own (docs/app-separation-plan.md).
 *
 * Every state change goes through services/workflow.js (the transition tables) and is written to
 * audit_log. The applicant is always resolved from the token; the client never supplies a userId.
 */
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { dbGet, dbAll, dbRun, newId, sha256, safeJson } = require('../services/dbHelpers');
const W = require('../services/workflow');
const V = require('../services/flowValidation');
const { calculateLoanRepayment, buildLoanBreakdown } = require('../services/loanCalculator');
const { getAllCurrentTerms } = require('../services/terms');
const { createFlowNotifier } = require('../services/flowNotifications');
const { calculateEligibilityScore } = require('../services/eligibilityScoring');

const REGISTRATION_VERSION = '1.0';
const DOC_STEP_1 = [['passport', 'PASSPORT'], ['visa', 'WORK_VISA'], ['payslip', 'PAY_SLIP']];

const FLOW_JSON = ['borrowerDetails', 'residencyDetails', 'employmentDetails', 'loanRequest', 'guarantor', 'guarantors', 'documents', 'bankAccount', 'statusHistory',
  'eligibilityBreakdown', 'consents', 'step1Data', 'step2Data', 'step3Data', 'loanBreakdown', 'staffMessage'];
const FLOW_UPDATE_COLS = ['requestNumber', 'isSubmitted', 'submittedAt', 'status', 'language', 'currentStep', 'borrowerDetails', 'residencyDetails', 'employmentDetails',
  'loanRequest', 'guarantor', 'guarantors', 'documents', 'bankAccount', 'bankAccountConfirmed', 'statusHistory', 'eligibilityScore', 'eligibilityBreakdown',
  'consents', 'flowStatus', 'unlockedStep', 'rejectedAtStep', 'rejectionReason', 'step1Data', 'step2Data', 'step3Data', 'step1SubmittedAt',
  'step2SubmittedAt', 'step3SubmittedAt', 'flowCompletedAt', 'loanBreakdown', 'staffMessage', 'phoneVerified', 'updatedAt'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mask = (v) => { const s = String(v || ''); return s.length <= 4 ? '****' : `${'*'.repeat(s.length - 4)}${s.slice(-4)}`; };

const MAX_ADOPTED_UPLOADS = 10;
const ADOPT_UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Documents picked in the Step 1 form are uploaded before the account exists, so they are owned by a
 * guest identity: 'anonymous', DEMO_MODE's shared 'demo_user', or the `sub` of a stale token whose
 * user no longer exists. Registration hands those files to the new account; otherwise cleanDocRef
 * drops them and the Step 1 submit fails with "document required". Files owned by a real borrower
 * or staff account, or older than the window, are never moved.
 */
async function adoptGuestUploads(filenames, userId) {
  if (!Array.isArray(filenames)) return [];
  const since = new Date(Date.now() - ADOPT_UPLOAD_WINDOW_MS).toISOString();
  const adopted = [];
  for (const raw of filenames.slice(0, MAX_ADOPTED_UPLOADS)) {
    const filename = path.basename(String(raw || ''));
    if (!filename || filename === '.' || filename === '..') continue;
    const row = await dbGet('SELECT userId, createdAt FROM uploaded_files WHERE filename = ?', [filename]);
    if (!row || row.userId === userId || row.createdAt < since) continue;
    const isGuest = row.userId === 'anonymous' || row.userId === 'demo_user' || (
      !(await dbGet('SELECT id FROM users WHERE id = ?', [row.userId]))
      && !(await dbGet('SELECT id FROM staff_users WHERE id = ?', [row.userId]))
    );
    if (!isGuest) continue;
    const r = await dbRun('UPDATE uploaded_files SET userId = ? WHERE filename = ? AND userId = ?', [userId, filename, row.userId]);
    if (r && r.changes) adopted.push(filename);
  }
  return adopted;
}

function createRateLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    return arr.length <= max;
  };
}

module.exports = function createFlowRoutes(ctx) {
  const {
    DEMO_MODE, BCRYPT_ROUNDS, JWT_SECRET, normalizePhone, sanitizeUser, signUserToken, isStaff, requireStaff, checkOtp,
    nextRequestNumber, parseApp, broadcastAppEvent, sendSms, sendEmail, notifyStatusChange, resolveMessageLanguage,
  } = ctx;

  const notifier = createFlowNotifier({ sendSms, sendEmail, broadcastAppEvent });
  const registerLimiter = createRateLimiter(parseInt(process.env.FLOW_REGISTER_RATE_LIMIT || '30', 10), 60 * 60 * 1000);
  const loginLimiter = createRateLimiter(parseInt(process.env.STAFF_LOGIN_RATE_LIMIT || '30', 10), 15 * 60 * 1000);

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------
  const actorOf = (req) => (isStaff(req)
    ? { type: 'staff', id: req.auth.sub, role: req.auth.role, name: req.auth.name || req.auth.role }
    : { type: 'borrower', id: req.auth && req.auth.sub, role: 'borrower', name: null });

  async function audit(req, { applicationId, action, fromStatus, toStatus, metadata, actor }) {
    const a = actor || (req ? actorOf(req) : { type: 'system', id: null, role: null, name: null });
    await dbRun(
      `INSERT INTO audit_log (id, applicationId, actorType, actorId, actorRole, actorName, action, fromStatus, toStatus, metadata, ipAddress, userAgent, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId('aud'), applicationId || null, a.type, a.id || null, a.role || null, a.name || null, action, fromStatus || null, toStatus || null,
        metadata ? JSON.stringify(metadata) : null, (req && req.ip) || null, req ? String(req.headers['user-agent'] || '').slice(0, 250) : null, new Date().toISOString()]
    );
  }

  const flowRowToApp = (row) => (row ? parseApp(row) : null);
  const getFlowAppByUser = async (userId) =>
    flowRowToApp(await dbGet('SELECT * FROM applications WHERE userId = ? AND flowVersion = 2 ORDER BY createdAt DESC LIMIT 1', [userId]));
  const getFlowAppById = async (id) =>
    flowRowToApp(await dbGet('SELECT * FROM applications WHERE (id = ? OR requestNumber = ?) AND flowVersion = 2', [id, id]));

  /** Legacy fields the rest of the system reads (PDF, scoring, Back Office lists) are derived from the step data. */
  function mirrorLegacy(a) {
    const s1 = a.step1Data || {};
    const s2 = a.step2Data || {};
    const s3 = a.step3Data || {};
    const p = s1.personal || {};
    const prevB = a.borrowerDetails || {};
    a.borrowerDetails = {
      ...prevB,
      fullName: p.fullName || prevB.fullName || '',
      mobilePhoneNumber: p.phoneNumber || prevB.mobilePhoneNumber || '',
      dateOfBirth: p.dateOfBirth || prevB.dateOfBirth || '',
      addressFull: p.address || prevB.addressFull || '',
      passportNumber: p.passportNumber || prevB.passportNumber || '',
      countryOfOrigin: p.countryOfOrigin || '',
    };

    const prevR = a.residencyDetails || {};
    if (p.visaStartDate || p.visaExpiryDate || prevR.visaStartDate || prevR.visaExpiryDate || prevR.visaType) {
      a.residencyDetails = {
        ...prevR,
        visaStartDate: p.visaStartDate || prevR.visaStartDate || '',
        visaExpiryDate: p.visaExpiryDate || prevR.visaExpiryDate || '',
      };
    }

    const e = s1.employment || null;
    const prevE = a.employmentDetails || {};
    const salaryNis = Number(p.monthlySalaryNis) > 0
      ? Number(p.monthlySalaryNis)
      : Number(e && e.monthlySalaryNis) > 0
        ? Number(e.monthlySalaryNis)
        : Number(prevE.monthlySalaryNis) > 0
          ? Number(prevE.monthlySalaryNis)
          : undefined;
    if (e || salaryNis !== undefined) {
      a.employmentDetails = {
        ...prevE,
        ...(e ? {
          employerName: e.employerName,
          companyName: e.companyName,
          manpowerAgent: e.manpowerAgent || undefined,
        } : {}),
        ...(salaryNis !== undefined ? { monthlySalaryNis: salaryNis, salaryCurrency: p.salaryCurrency || 'ILS' } : {}),
      };
    }

    const amount = (s2.loan && s2.loan.requestedAmountNis) || (s1.loan && s1.loan.requestedAmountNis) || 0;
    const months = (s2.loan && s2.loan.repaymentPeriodMonths) || 6;
    if (amount > 0) {
      const r = calculateLoanRepayment(amount, months);
      a.loanRequest = {
        requestedAmountNis: amount,
        repaymentPeriodMonths: months,
        serviceFeeNis: r.serviceFeeNis,
        estimatedMonthlyPaymentNis: r.monthlyPaymentNis,
        totalRepaymentNis: r.totalRepaymentNis,
      };
    }

    const sponsors = Array.isArray(s2.sponsors) ? s2.sponsors : [];
    a.guarantors = sponsors.map((sp, i) => ({ id: sp.id || `g_${i + 1}`, fullName: sp.fullName, passportOrIdNumber: sp.idOrPassportNumber, mobilePhoneNumber: '', relationship: 'Sponsor' }));
    a.guarantor = sponsors.length > 0
      ? { hasGuarantor: true, fullName: sponsors[0].fullName, passportOrIdNumber: sponsors[0].idOrPassportNumber, relationship: 'Sponsor' }
      : { hasGuarantor: false };

    const docs = [];
    const addDoc = (ref, code, step) => {
      if (!ref) return;
      docs.push({
        id: `doc_${ref.filename}`, applicationId: a.id, documentTypeCode: code, originalFilename: ref.originalName, mimeType: ref.mimeType,
        fileSizeBytes: ref.size, storageKey: ref.filename, fileUrl: ref.fileUrl, uploadSource: 'file', qualityStatus: 'not_checked',
        ocrStatus: 'not_requested', userConfirmed: true, uploadedAt: ref.uploadedAt, step,
      });
    };
    DOC_STEP_1.forEach(([key, code]) => addDoc(s1.documents && s1.documents[key], code, 1));
    addDoc(s3.bankDocument, 'BANK_ACCOUNT_DOCUMENT', 3);
    (s3.extraDocuments || []).forEach((d) => addDoc(d, 'ADDITIONAL_DOCUMENT', 3));
    a.documents = docs;

    if (s3.bank && s3.bank.accountNumber) {
      a.bankAccount = { ...s3.bank };
      a.bankAccountConfirmed = true;
    }
    try {
      const el = calculateEligibilityScore(a);
      a.eligibilityScore = el.rawScore;
      a.eligibilityBreakdown = el;
    } catch { /* advisory only */ }
    return a;
  }

  const toDb = (a, col) => {
    if (FLOW_JSON.includes(col)) return JSON.stringify(a[col] ?? (col === 'documents' || col === 'guarantors' || col === 'statusHistory' || col === 'consents' ? [] : null));
    if (col === 'isSubmitted' || col === 'bankAccountConfirmed' || col === 'phoneVerified') return a[col] ? 1 : 0;
    return a[col] ?? null;
  };

  async function insertFlowApp(a) {
    const cols = ['id', 'userId', 'createdAt', 'flowVersion', 'leadSource', ...FLOW_UPDATE_COLS];
    const values = cols.map((c) => (c === 'id' || c === 'userId' || c === 'createdAt' || c === 'leadSource' ? a[c] : c === 'flowVersion' ? 2 : toDb(a, c)));
    await dbRun(`INSERT INTO applications (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, values);
  }

  /**
   * Write the application. With `expectedFlowStatus` the write only happens if the application is
   * still in that status (optimistic lock), which stops double submits and double approvals.
   * Returns true when a row was updated.
   */
  async function updateFlowApp(a, expectedFlowStatus) {
    const sql = `UPDATE applications SET ${FLOW_UPDATE_COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND flowVersion = 2${expectedFlowStatus ? ' AND flowStatus = ?' : ''}`;
    const params = [...FLOW_UPDATE_COLS.map((c) => toDb(a, c)), a.id];
    if (expectedFlowStatus) params.push(expectedFlowStatus);
    const r = await dbRun(sql, params);
    return r.changes === 1;
  }

  const maskBank = (b) => (b && b.accountNumber ? { ...b, accountNumber: mask(b.accountNumber) } : b);

  function stepSummary(a, n) {
    const data = a[`step${n}Data`] || null;
    return { data, submittedAt: a[`step${n}SubmittedAt`] || null };
  }

  async function latestReviews(applicationId) {
    const rows = await dbAll('SELECT * FROM application_step_reviews WHERE applicationId = ? ORDER BY decidedAt ASC', [applicationId]);
    const byStep = {};
    rows.forEach((r) => { byStep[r.step] = { decision: r.decision, note: r.note, decidedAt: r.decidedAt, revision: r.revision }; });
    return { rows, byStep };
  }

  /** What the applicant gets to see (no internal fields). */
  async function applicantView(a, user) {
    const { byStep } = await latestReviews(a.id);
    const states = W.stepStates(a.flowStatus, a.rejectedAtStep);
    const s1 = a.step1Data || {};
    const steps = {};
    [1, 2, 3].forEach((n) => {
      const d = stepSummary(a, n);
      steps[n] = { state: states[n], submittedAt: d.submittedAt, data: n === 1 ? { ...d.data, registration: undefined } : d.data, review: byStep[n] || null };
    });
    return {
      id: a.id,
      requestNumber: a.requestNumber,
      flowStatus: a.flowStatus,
      group: W.groupOf(a.flowStatus),
      unlockedStep: a.unlockedStep || W.unlockedStepFor(a.flowStatus),
      stepStates: states,
      nextAction: W.nextActionFor(a.flowStatus),
      isCompleted: !!a.flowCompletedAt,
      completedAt: a.flowCompletedAt || null,
      status: a.status,
      rejection: a.flowStatus === 'LOAN_REJECTED' ? { atStep: a.rejectedAtStep || null, reason: a.rejectionReason || null } : null,
      staffMessage: a.staffMessage || null,
      needsRegistrationConsent: !(s1.registration && s1.registration.disclaimerAcceptedAt),
      steps,
      loanBreakdown: a.loanBreakdown || null,
      language: a.language,
      leadSource: a.leadSource || null,
      account: user ? { email: user.email || null, phoneNumber: user.phoneNumber && !String(user.phoneNumber).startsWith('google:') ? user.phoneNumber : null, fullName: user.fullName || null, authProvider: user.authProvider || null } : null,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  async function createFlowApp(user, { leadSource, language, phoneNumber, phoneVerified, registration, req }) {
    const now = new Date().toISOString();
    const a = {
      id: newId('app'),
      userId: user.id,
      requestNumber: await nextRequestNumber(),
      isSubmitted: false,
      status: 'Received',
      language: language || user.preferredLanguage || 'en',
      currentStep: 1,
      flowStatus: W.FLOW_STATUS.LEAD_REGISTERED,
      unlockedStep: 1,
      leadSource,
      phoneVerified: !!phoneVerified,
      step1Data: registration ? { registration: { disclaimerAcceptedAt: now, disclaimerVersion: REGISTRATION_VERSION, locationRequested: true, locationGranted: !!registration.locationGranted } } : {},
      step2Data: null,
      step3Data: null,
      documents: [], consents: [], statusHistory: [], guarantors: [],
      borrowerDetails: { fullName: user.fullName || '', mobilePhoneNumber: phoneNumber || (user.phoneNumber && !String(user.phoneNumber).startsWith('google:') ? user.phoneNumber : '') },
      createdAt: now,
      updatedAt: now,
    };
    await insertFlowApp(a);
    await audit(req, { applicationId: a.id, action: 'LEAD_REGISTERED', toStatus: a.flowStatus, metadata: { leadSource, phoneVerified: !!phoneVerified }, actor: { type: 'borrower', id: user.id, role: 'borrower' } });
    if (registration) {
      await audit(req, { applicationId: a.id, action: 'REGISTRATION_CONSENT', metadata: { disclaimerVersion: REGISTRATION_VERSION, locationGranted: !!registration.locationGranted }, actor: { type: 'borrower', id: user.id, role: 'borrower' } });
    }
    return getFlowAppById(a.id);
  }

  const ensureFlowApp = async (user, opts) => (await getFlowAppByUser(user.id)) || createFlowApp(user, opts);

  function requireApplicant(req, res, next) {
    if (isStaff(req)) return res.status(403).json({ success: false, error: 'Applicant account required' });
    dbGet('SELECT * FROM users WHERE id = ?', [req.auth && req.auth.sub]).then((user) => {
      if (!user) return res.status(401).json({ success: false, error: 'Please sign in to continue.' });
      req.user = user;
      return next();
    }, next);
  }

  const parseStep = (req, res) => {
    const n = parseInt(req.params.n, 10);
    if (![1, 2, 3].includes(n)) { res.status(400).json({ success: false, error: 'Unknown step' }); return null; }
    return n;
  };

  // -------------------------------------------------------------------------
  // PUBLIC routes
  // -------------------------------------------------------------------------
  function registerApplicantPublic(app) {
    // Manual registration: email + password + phone (verified by SMS code) -> account + "Lead / Registered" application.
    app.post('/api/flow/register', async (req, res) => {
      if (!registerLimiter(`reg:${req.ip}`)) return res.status(429).json({ success: false, error: 'Too many attempts. Please try again later.' });
      const { fullName, email, password, code, language, registration } = req.body || {};
      const phone = normalizePhone(req.body && req.body.phoneNumber);
      if (!registration || registration.disclaimerAccepted !== true) return res.status(400).json({ success: false, code: 'DISCLAIMER_REQUIRED', error: 'The regulatory disclaimer must be accepted.' });
      if (!email || !EMAIL_RE.test(String(email).trim())) return res.status(400).json({ success: false, code: 'VALIDATION', fieldErrors: { email: 'invalid' }, error: 'A valid email address is required.' });
      if (!password || String(password).length < 8) return res.status(400).json({ success: false, code: 'VALIDATION', fieldErrors: { password: 'invalid' }, error: 'Password must be at least 8 characters.' });
      if (!phone || phone.replace(/\D/g, '').length < 7) return res.status(400).json({ success: false, code: 'VALIDATION', fieldErrors: { phoneNumber: 'invalid' }, error: 'Please enter a valid mobile phone number.' });

      const otp = checkOtp(phone, String(code || '').trim());
      if (!otp.ok) return res.status(otp.status).json({ success: false, code: 'OTP_INVALID', error: otp.error });

      const now = new Date().toISOString();
      const emailClean = String(email).trim();
      const emailOwner = await dbGet('SELECT id FROM users WHERE lower(email) = lower(?)', [emailClean]);
      let user = await dbGet('SELECT * FROM users WHERE phoneNumber = ?', [phone]);
      if (user && user.password) return res.status(409).json({ success: false, code: 'ACCOUNT_EXISTS', error: 'An account with this phone number already exists. Please sign in.' });
      if (emailOwner && (!user || emailOwner.id !== user.id)) return res.status(409).json({ success: false, code: 'ACCOUNT_EXISTS', error: 'An account with this email address already exists. Please sign in.' });

      const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
      const lang = resolveMessageLanguage(language);
      if (user) {
        await dbRun(`UPDATE users SET fullName = ?, email = ?, password = ?, authProvider = 'password', phoneVerifiedAt = ?, updatedAt = ? WHERE id = ?`,
          [fullName || user.fullName || null, emailClean, hash, now, now, user.id]);
      } else {
        const id = newId('user');
        await dbRun(
          `INSERT INTO users (id, phoneNumber, email, fullName, password, authProvider, phoneVerifiedAt, preferredLanguage, roles, isActive, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, 'password', ?, ?, ?, 1, ?, ?)`,
          [id, phone, emailClean, fullName || null, hash, now, lang, JSON.stringify(['borrower']), now, now]
        );
        user = { id };
      }
      user = await dbGet('SELECT * FROM users WHERE id = ?', [user.id]);
      const application = await ensureFlowApp(user, { leadSource: 'manual', language: lang, phoneNumber: phone, phoneVerified: true, registration, req });
      const adopted = await adoptGuestUploads(req.body.uploadedFiles, user.id);
      if (adopted.length > 0) {
        await audit(req, { applicationId: application.id, action: 'UPLOADS_ADOPTED', metadata: { count: adopted.length },
          actor: { type: 'borrower', id: user.id, role: 'borrower', name: null } });
      }
      res.json({ success: true, user: sanitizeUser(user), token: signUserToken(user), application: await applicantView(application, user) });
    });

    // Sign up / sign in with Google. A real Google ID token is verified when GOOGLE_CLIENT_ID is set;
    // in DEMO_MODE a mock profile ({ demo: { email, name } }) is accepted instead.
    app.post('/api/flow/google', async (req, res) => {
      if (!registerLimiter(`g:${req.ip}`)) return res.status(429).json({ success: false, error: 'Too many attempts. Please try again later.' });
      const { idToken, demo, language, registration } = req.body || {};
      let profile = null;
      if (idToken) {
        if (!process.env.GOOGLE_CLIENT_ID) return res.status(501).json({ success: false, code: 'GOOGLE_NOT_CONFIGURED', error: 'Google sign-in is not configured.' });
        try {
          const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(idToken))}`);
          const info = await r.json();
          const issOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
          if (!r.ok || info.aud !== process.env.GOOGLE_CLIENT_ID || !issOk || String(info.email_verified) !== 'true' || Number(info.exp) * 1000 < Date.now()) {
            return res.status(401).json({ success: false, error: 'Google sign-in could not be verified.' });
          }
          profile = { email: info.email, name: info.name || info.given_name || '' };
        } catch {
          return res.status(502).json({ success: false, error: 'Google sign-in could not be verified. Please try again.' });
        }
      } else if (demo && DEMO_MODE) {
        if (!demo.email) return res.status(400).json({ success: false, error: 'Email is required' });
        profile = { email: String(demo.email), name: demo.name || '' };
      } else {
        return res.status(400).json({ success: false, error: 'Google credential is required.' });
      }

      const now = new Date().toISOString();
      let user = await dbGet('SELECT * FROM users WHERE lower(email) = lower(?)', [profile.email]);
      if (user && user.authProvider !== 'google') {
        return res.status(400).json({ success: false, code: 'ACCOUNT_EXISTS', error: 'This email is registered with a password. Please sign in with your email and password.' });
      }
      const lang = resolveMessageLanguage(language);
      if (!user) {
        if (!registration || registration.disclaimerAccepted !== true) return res.status(400).json({ success: false, code: 'DISCLAIMER_REQUIRED', error: 'The regulatory disclaimer must be accepted.' });
        const id = newId('user_google');
        await dbRun(
          `INSERT INTO users (id, phoneNumber, email, fullName, authProvider, phoneVerifiedAt, preferredLanguage, roles, isActive, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, 'google', NULL, ?, ?, 1, ?, ?)`,
          [id, `google:${profile.email.toLowerCase()}`, profile.email, profile.name || null, lang, JSON.stringify(['borrower']), now, now]
        );
        user = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
      }
      const application = await ensureFlowApp(user, { leadSource: 'google', language: lang, phoneVerified: false, registration: registration && registration.disclaimerAccepted === true ? registration : null, req });
      res.json({ success: true, user: sanitizeUser(user), token: signUserToken(user), application: await applicantView(application, user) });
    });
  }

  function registerStaffPublic(app) {
    // Back Office sign-in with a real staff account.
    app.post('/api/auth/staff-login', async (req, res) => {
      if (!loginLimiter(`staff:${req.ip}`)) return res.status(429).json({ success: false, error: 'Too many attempts. Please try again later.' });
      const { email, password } = req.body || {};
      const generic = () => res.status(401).json({ success: false, error: 'Incorrect email or password.' });
      if (!email || !password) return generic();
      const staff = await dbGet('SELECT * FROM staff_users WHERE lower(email) = lower(?)', [String(email).trim()]);
      if (!staff || !staff.isActive) { await audit(req, { action: 'STAFF_LOGIN_FAILED', metadata: { email: String(email).slice(0, 100) }, actor: { type: 'staff', id: null, role: null } }); return generic(); }
      if (staff.lockedUntil && new Date(staff.lockedUntil).getTime() > Date.now()) {
        return res.status(423).json({ success: false, error: 'Account temporarily locked. Please try again later.' });
      }
      const ok = await bcrypt.compare(String(password), staff.password);
      const now = new Date().toISOString();
      if (!ok) {
        const attempts = (staff.failedAttempts || 0) + 1;
        const lock = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
        await dbRun('UPDATE staff_users SET failedAttempts = ?, lockedUntil = ?, updatedAt = ? WHERE id = ?', [lock ? 0 : attempts, lock, now, staff.id]);
        await audit(req, { action: 'STAFF_LOGIN_FAILED', metadata: { staffId: staff.id }, actor: { type: 'staff', id: staff.id, role: staff.role, name: staff.fullName } });
        return generic();
      }
      await dbRun('UPDATE staff_users SET failedAttempts = 0, lockedUntil = NULL, lastLoginAt = ?, updatedAt = ? WHERE id = ?', [now, now, staff.id]);
      const token = jwt.sign({ sub: staff.id, type: 'staff', role: staff.role, name: staff.fullName || staff.email }, JWT_SECRET, { expiresIn: '12h' });
      await audit(req, { action: 'STAFF_LOGIN', actor: { type: 'staff', id: staff.id, role: staff.role, name: staff.fullName } });
      res.json({ success: true, token, staff: { id: staff.id, email: staff.email, fullName: staff.fullName, role: staff.role } });
    });
  }

  // -------------------------------------------------------------------------
  // PROTECTED routes
  // -------------------------------------------------------------------------
  function registerApplicant(app) {
    app.get('/api/flow/terms/current', async (_req, res) => {
      res.json({ success: true, terms: await getAllCurrentTerms() });
    });

    // The caller's application (created as "Lead / Registered" on first call for a signed-in account).
    app.get('/api/flow/application', requireApplicant, async (req, res) => {
      const a = await ensureFlowApp(req.user, { leadSource: req.user.authProvider === 'google' ? 'google' : 'manual', language: req.user.preferredLanguage, phoneVerified: !!req.user.phoneVerifiedAt && req.user.authProvider !== 'google', registration: null, req });
      res.json({ success: true, application: await applicantView(a, req.user) });
    });

    // Records the location request + regulatory disclaimer for accounts that signed in (not registered) here.
    app.post('/api/flow/application/registration-consent', requireApplicant, async (req, res) => {
      const { disclaimerAccepted, locationGranted } = req.body || {};
      if (disclaimerAccepted !== true) return res.status(400).json({ success: false, code: 'DISCLAIMER_REQUIRED', error: 'The regulatory disclaimer must be accepted.' });
      const a = await ensureFlowApp(req.user, { leadSource: 'manual', language: req.user.preferredLanguage, registration: null, req });
      if (!(a.step1Data && a.step1Data.registration && a.step1Data.registration.disclaimerAcceptedAt)) {
        a.step1Data = { ...(a.step1Data || {}), registration: { disclaimerAcceptedAt: new Date().toISOString(), disclaimerVersion: REGISTRATION_VERSION, locationRequested: true, locationGranted: !!locationGranted } };
        a.updatedAt = new Date().toISOString();
        await updateFlowApp(a);
        await audit(req, { applicationId: a.id, action: 'REGISTRATION_CONSENT', metadata: { disclaimerVersion: REGISTRATION_VERSION, locationGranted: !!locationGranted } });
      }
      res.json({ success: true, application: await applicantView(await getFlowAppById(a.id), req.user) });
    });

    // Save a draft of the step the applicant may currently edit.
    app.put('/api/flow/application/steps/:n/draft', requireApplicant, async (req, res) => {
      const n = parseStep(req, res); if (!n) return;
      const a = await getFlowAppByUser(req.user.id);
      if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
      if (n > (a.unlockedStep || 1)) return res.status(403).json({ success: false, code: 'STEP_LOCKED', error: `Step ${n} is not available yet.` });
      if (!W.isStepEditable(a.flowStatus, n)) return res.status(409).json({ success: false, code: 'STEP_NOT_EDITABLE', error: `Step ${n} cannot be edited in its current status.` });

      const body = (req.body && req.body.data) || {};
      if (n === 1) a.step1Data = { ...(await V.cleanStep1(body, req.user.id)), registration: (a.step1Data || {}).registration };
      if (n === 2) a.step2Data = V.cleanStep2(body);
      if (n === 3) {
        const { terms, ...c } = await V.cleanStep3(body, req.user.id); // terms are accepted only at submit
        a.step3Data = c;
      }
      a.updatedAt = new Date().toISOString();
      mirrorLegacy(a);
      if (!(await updateFlowApp(a, a.flowStatus))) return res.status(409).json({ success: false, code: 'CONFLICT', error: 'The application changed. Please reload.' });
      res.json({ success: true, application: await applicantView(await getFlowAppById(a.id), req.user) });
    });

    // Submit a step. Server-side: sequence check, full validation, snapshot, terms (step 3), transition, notifications.
    app.post('/api/flow/application/steps/:n/submit', requireApplicant, async (req, res) => {
      const n = parseStep(req, res); if (!n) return;
      const a = await getFlowAppByUser(req.user.id);
      if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
      const prevStatus = a.flowStatus;

      if (n > (a.unlockedStep || 1)) {
        await audit(req, { applicationId: a.id, action: 'STEP_ACCESS_DENIED', metadata: { step: n, flowStatus: prevStatus } });
        return res.status(403).json({ success: false, code: 'STEP_LOCKED', error: `Step ${n} is not available until the previous step has been approved.` });
      }
      if (!W.isStepEditable(prevStatus, n)) return res.status(409).json({ success: false, code: 'STEP_NOT_EDITABLE', error: `Step ${n} cannot be submitted in its current status.` });
      if (n === 1 && !(a.step1Data && a.step1Data.registration && a.step1Data.registration.disclaimerAcceptedAt)) {
        return res.status(409).json({ success: false, code: 'DISCLAIMER_REQUIRED', error: 'Please accept the regulatory disclaimer first.' });
      }

      const raw = req.body && req.body.data;
      let data;
      let errors;
      let currentTerms = null;
      if (n === 1) {
        data = await V.cleanStep1(raw || a.step1Data, req.user.id);
        errors = V.validateStep1(data);
      } else if (n === 2) {
        data = V.cleanStep2(raw || a.step2Data);
        errors = V.validateStep2(data);
      } else {
        data = await V.cleanStep3(raw || a.step3Data, req.user.id);
        errors = V.validateStep3(data);
        if (!a.step2Data || !a.step2Data.loan) return res.status(409).json({ success: false, code: 'STEP_NOT_EDITABLE', error: 'Step 2 data is missing.' });
        currentTerms = await getAllCurrentTerms();
        if (!errors.termsGeneral && !errors.termsServiceFee) {
          if (data.terms.generalVersion !== currentTerms.general.version || data.terms.serviceFeeVersion !== currentTerms.service_fee.version) {
            return res.status(409).json({ success: false, code: 'TERMS_VERSION_CHANGED', error: 'The terms have been updated. Please review and accept the current versions.', terms: currentTerms });
          }
        }
      }
      if (Object.keys(errors).length > 0) return res.status(422).json({ success: false, code: 'VALIDATION', error: 'Please complete all required fields.', fieldErrors: errors });

      const now = new Date().toISOString();
      const next = { ...a, updatedAt: now };
      const registration = (a.step1Data || {}).registration;
      if (n === 1) {
        next.step1Data = { ...data, registration };
        next.step1SubmittedAt = now;
      } else if (n === 2) {
        next.step2Data = data;
        next.step2SubmittedAt = now;
        next.loanBreakdown = buildLoanBreakdown(data.loan.requestedAmountNis, data.loan.repaymentPeriodMonths);
      } else {
        const loan = a.step2Data.loan;
        next.loanBreakdown = buildLoanBreakdown(loan.requestedAmountNis, loan.repaymentPeriodMonths);
        next.step3Data = { ...data, terms: {
          general: { version: currentTerms.general.version, sha256: currentTerms.general.sha256, acceptedAt: now },
          serviceFee: { version: currentTerms.service_fee.version, sha256: currentTerms.service_fee.sha256, acceptedAt: now },
        } };
        next.step3SubmittedAt = now;
        next.flowCompletedAt = now;
        next.isSubmitted = true;
        next.submittedAt = now;
        next.status = 'Received';
        next.consents = [
          { id: newId('consent'), applicationId: a.id, consentType: 'terms_and_conditions', consentVersion: currentTerms.general.version, consentGiven: true, consentTextHash: currentTerms.general.sha256, ipAddress: req.ip, givenAt: now },
          { id: newId('consent'), applicationId: a.id, consentType: 'service_fee_terms', consentVersion: currentTerms.service_fee.version, consentGiven: true, consentTextHash: currentTerms.service_fee.sha256, ipAddress: req.ip, givenAt: now },
        ];
      }
      next.flowStatus = W.SUBMIT_RESULT[n];
      next.unlockedStep = W.unlockedStepFor(next.flowStatus);
      next.currentStep = next.unlockedStep;
      next.staffMessage = null;
      mirrorLegacy(next);

      // 1. snapshot (deterministic id: a concurrent duplicate submit collides here)
      const revision = ((await dbGet('SELECT COUNT(*) AS c FROM application_step_submissions WHERE applicationId = ? AND step = ?', [a.id, n])).c || 0) + 1;
      const snapshotId = `${a.id}:s${n}:r${revision}`;
      try {
        await dbRun('INSERT INTO application_step_submissions (id, applicationId, step, revision, data, submittedBy, submittedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [snapshotId, a.id, n, revision, JSON.stringify(n === 1 ? { ...data } : n === 2 ? { ...data, loanBreakdown: next.loanBreakdown } : { ...data, terms: next.step3Data.terms, loanBreakdown: next.loanBreakdown }), req.user.id, now]);
      } catch {
        return res.status(409).json({ success: false, code: 'CONFLICT', error: 'This step is already being submitted.' });
      }
      const acceptanceIds = [];
      if (n === 3) {
        for (const [type, t] of [['general', currentTerms.general], ['service_fee', currentTerms.service_fee]]) {
          const id = `${a.id}:terms:${type}:r${revision}`;
          acceptanceIds.push(id);
          await dbRun(
            'INSERT INTO terms_acceptances (id, applicationId, userId, termsType, version, textSha256, language, acceptedAt, ipAddress, userAgent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [id, a.id, req.user.id, type, t.version, t.sha256, a.language || req.user.preferredLanguage || 'en', now, req.ip || null, String(req.headers['user-agent'] || '').slice(0, 250)]
          );
        }
      }
      // 2. claim the transition
      if (!(await updateFlowApp(next, prevStatus))) {
        await dbRun('DELETE FROM application_step_submissions WHERE id = ?', [snapshotId]);
        for (const id of acceptanceIds) await dbRun('DELETE FROM terms_acceptances WHERE id = ?', [id]);
        return res.status(409).json({ success: false, code: 'CONFLICT', error: 'The application changed. Please reload.' });
      }

      await audit(req, { applicationId: a.id, action: `STEP${n}_SUBMITTED`, fromStatus: prevStatus, toStatus: next.flowStatus, metadata: { revision } });
      if (n === 3) {
        await audit(req, { applicationId: a.id, action: 'TERMS_ACCEPTED', metadata: { general: next.step3Data.terms.general, serviceFee: next.step3Data.terms.serviceFee } });
        await audit(req, { applicationId: a.id, action: 'APPLICANT_JOURNEY_COMPLETED', fromStatus: prevStatus, toStatus: next.flowStatus });
      }
      const saved = await getFlowAppById(a.id);
      notifier.notifyFlowEvent({ app: saved, event: `STEP${n}_SUBMITTED` }).catch((err) => console.error('[FLOW NOTIFY]', err.message));
      res.json({ success: true, application: await applicantView(saved, req.user) });
    });

    // Final stage "Additional Document Required": the applicant sends the requested documents.
    app.post('/api/flow/application/final-documents', requireApplicant, async (req, res) => {
      const a = await getFlowAppByUser(req.user.id);
      if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
      if (a.flowStatus !== W.FLOW_STATUS.PENDING_FINAL_PROCESSING || a.status !== 'Additional Document Required') {
        return res.status(409).json({ success: false, code: 'NOT_REQUESTED', error: 'No additional documents have been requested.' });
      }
      const refs = [];
      for (const r of (req.body && req.body.documents) || []) {
        const ref = await V.cleanDocRef(r, req.user.id);
        if (ref) refs.push(ref);
      }
      if (refs.length === 0) return res.status(422).json({ success: false, code: 'VALIDATION', fieldErrors: { documents: 'required' }, error: 'Please upload at least one document.' });
      const now = new Date().toISOString();
      const next = { ...a, updatedAt: now };
      next.step3Data = { ...(a.step3Data || {}), extraDocuments: [...((a.step3Data && a.step3Data.extraDocuments) || []), ...refs] };
      next.status = 'Under Review';
      next.missingDocumentNotes = null;
      next.statusHistory = [{ id: newId('sh'), applicationId: a.id, fromStatus: a.status, toStatus: 'Under Review', changedByType: 'borrower', changedByName: (a.borrowerDetails && a.borrowerDetails.fullName) || 'Borrower', reason: 'Borrower uploaded the requested document.', createdAt: now }, ...(a.statusHistory || [])];
      mirrorLegacy(next);
      await dbRun('UPDATE applications SET missingDocumentNotes = NULL WHERE id = ?', [a.id]);
      if (!(await updateFlowApp(next, a.flowStatus))) return res.status(409).json({ success: false, code: 'CONFLICT', error: 'The application changed. Please reload.' });
      await audit(req, { applicationId: a.id, action: 'ADDITIONAL_DOCUMENTS_SUBMITTED', fromStatus: a.status, toStatus: 'Under Review', metadata: { count: refs.length } });
      const saved = await getFlowAppById(a.id);
      broadcastAppEvent(a.id, 'status', { applicationId: a.id, flowStatus: saved.flowStatus, status: saved.status, updatedAt: saved.updatedAt });
      res.json({ success: true, application: await applicantView(saved, req.user) });
    });
  }

  // ---- Back Office ---------------------------------------------------------
  function registerStaff(app) {
    const staffView = requireStaff(...W.VIEW_ROLES);

    function summaryRow(a, user) {
      const s1 = a.step1Data || {};
      const p = s1.personal || {};
      const pending = W.groupOf(a.flowStatus) === 'pending';
      const waitingSince = a.flowStatus === 'PENDING_STEP1_APPROVAL' ? a.step1SubmittedAt : a.flowStatus === 'PENDING_STEP2_APPROVAL' ? a.step2SubmittedAt : null;
      const salary = Number(p.monthlySalaryNis) > 0
        ? Number(p.monthlySalaryNis)
        : Number(a.employmentDetails && a.employmentDetails.monthlySalaryNis) > 0
          ? Number(a.employmentDetails.monthlySalaryNis)
          : null;
      return {
        id: a.id,
        requestNumber: a.requestNumber,
        flowStatus: a.flowStatus,
        group: W.groupOf(a.flowStatus),
        status: a.status,
        unlockedStep: a.unlockedStep,
        applicantName: p.fullName || (a.borrowerDetails && a.borrowerDetails.fullName) || (user && user.fullName) || '',
        phoneNumber: p.phoneNumber || (a.borrowerDetails && a.borrowerDetails.mobilePhoneNumber) || '',
        email: (user && user.email) || '',
        passportNumber: p.passportNumber || (a.borrowerDetails && a.borrowerDetails.passportNumber) || '',
        countryOfOrigin: p.countryOfOrigin || '',
        visaStartDate: p.visaStartDate || (a.residencyDetails && a.residencyDetails.visaStartDate) || null,
        visaExpiryDate: p.visaExpiryDate || (a.residencyDetails && a.residencyDetails.visaExpiryDate) || null,
        monthlySalaryNis: salary,
        salaryCurrency: p.salaryCurrency || 'ILS',
        requestedAmountNis: (a.loanRequest && a.loanRequest.requestedAmountNis) || null,
        repaymentPeriodMonths: (a.loanRequest && a.loanRequest.repaymentPeriodMonths) || null,
        leadSource: a.leadSource || null,
        pending,
        waitingSince,
        step1SubmittedAt: a.step1SubmittedAt || null,
        step2SubmittedAt: a.step2SubmittedAt || null,
        step3SubmittedAt: a.step3SubmittedAt || null,
        flowCompletedAt: a.flowCompletedAt || null,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      };
    }

    app.get('/api/flow/applications', staffView, async (req, res) => {
      const rows = (await dbAll('SELECT * FROM applications WHERE flowVersion = 2 ORDER BY updatedAt DESC')).map(parseApp);
      const users = await dbAll('SELECT id, email, fullName FROM users');
      const userById = new Map(users.map((u) => [u.id, u]));
      const all = rows.map((a) => summaryRow(a, userById.get(a.userId)));
      const counts = { total: all.length, byGroup: {}, byStatus: {} };
      W.GROUPS.forEach((g) => { counts.byGroup[g] = 0; });
      W.ALL_FLOW_STATUSES.forEach((s) => { counts.byStatus[s] = 0; });
      all.forEach((r) => { counts.byGroup[r.group] += 1; counts.byStatus[r.flowStatus] = (counts.byStatus[r.flowStatus] || 0) + 1; });

      const { group, status, q } = req.query;
      const query = String(q || '').toLowerCase().trim();
      let list = all;
      if (group && W.GROUPS.includes(String(group))) list = list.filter((r) => r.group === group);
      if (status && W.ALL_FLOW_STATUSES.includes(String(status))) list = list.filter((r) => r.flowStatus === status);
      if (query) list = list.filter((r) => [r.requestNumber, r.applicantName, r.phoneNumber, r.email, r.passportNumber, r.countryOfOrigin].some((f) => String(f || '').toLowerCase().includes(query)));
      // Pending reviews: oldest first, so nothing waits unnoticed.
      list = [...list].sort((x, y) => {
        if (x.pending && y.pending) return String(x.waitingSince || '').localeCompare(String(y.waitingSince || ''));
        if (x.pending !== y.pending) return x.pending ? -1 : 1;
        return String(y.updatedAt).localeCompare(String(x.updatedAt));
      });
      res.json({ success: true, applications: list, counts });
    });

    app.get('/api/flow/summary', staffView, async (_req, res) => {
      const rows = (await dbAll('SELECT * FROM applications WHERE flowVersion = 2')).map(parseApp);
      const funnel = {
        registered: rows.length,
        step1Submitted: rows.filter((a) => a.step1SubmittedAt).length,
        step1Approved: rows.filter((a) => a.step2SubmittedAt || ['STEP1_APPROVED', 'PENDING_STEP2_APPROVAL', 'STEP2_CHANGES_REQUESTED', 'STEP2_APPROVED', 'PENDING_FINAL_PROCESSING', 'LOAN_APPROVED'].includes(a.flowStatus)).length,
        step2Submitted: rows.filter((a) => a.step2SubmittedAt).length,
        step2Approved: rows.filter((a) => a.step3SubmittedAt || a.flowStatus === 'STEP2_APPROVED').length,
        step3Submitted: rows.filter((a) => a.step3SubmittedAt).length,
        loanApproved: rows.filter((a) => a.flowStatus === 'LOAN_APPROVED').length,
        rejected: rows.filter((a) => a.flowStatus === 'LOAN_REJECTED').length,
      };
      const byStatus = {};
      rows.forEach((a) => { byStatus[a.flowStatus] = (byStatus[a.flowStatus] || 0) + 1; });
      res.json({ success: true, summary: { funnel, byStatus, generatedAt: new Date().toISOString() } });
    });

    // The one centralized record: every step, documents, breakdown, terms acceptance, reviews and audit trail.
    app.get('/api/flow/applications/:id', staffView, async (req, res) => {
      const a = await getFlowAppById(req.params.id);
      if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
      const user = await dbGet('SELECT id, email, phoneNumber, fullName, authProvider, phoneVerifiedAt, createdAt FROM users WHERE id = ?', [a.userId]);
      const reveal = req.query.revealBank === '1';
      if (reveal) await audit(req, { applicationId: a.id, action: 'BANK_DETAILS_REVEALED' });
      const { rows: reviews } = await latestReviews(a.id);
      const submissions = (await dbAll('SELECT id, step, revision, data, submittedBy, submittedAt FROM application_step_submissions WHERE applicationId = ? ORDER BY submittedAt ASC', [a.id]))
        .map((s) => ({ ...s, data: safeJson(s.data, null) }));
      const view = { ...a };
      const latestStep1Sub = [...submissions].reverse().find((s) => s.step === 1 && s.data);
      if (latestStep1Sub && latestStep1Sub.data) {
        const subPersonal = latestStep1Sub.data.personal || {};
        const curPersonal = (view.step1Data && view.step1Data.personal) || {};
        view.step1Data = {
          ...(view.step1Data || {}),
          personal: { ...subPersonal, ...curPersonal },
        };
      }
      mirrorLegacy(view);
      delete view.riskScore; delete view.riskLevel; delete view.riskFlags;
      if (view.step3Data && view.step3Data.bank && !reveal) view.step3Data = { ...view.step3Data, bank: maskBank(view.step3Data.bank) };
      if (view.bankAccount && !reveal) view.bankAccount = maskBank(view.bankAccount);
      const acceptances = await dbAll('SELECT * FROM terms_acceptances WHERE applicationId = ? ORDER BY acceptedAt ASC', [a.id]);
      const auditRows = (await dbAll('SELECT * FROM audit_log WHERE applicationId = ? ORDER BY createdAt ASC', [a.id])).map((r) => ({ ...r, metadata: safeJson(r.metadata, null) }));
      const deliveries = await notifier.listDeliveries(a.id);
      const ownPermissions = {
        approve: W.canDecide(req.auth.role, 'approve'),
        reject: W.canDecide(req.auth.role, 'reject'),
        requestChanges: W.canDecide(req.auth.role, 'request_changes'),
        message: W.MESSAGE_ROLES.includes(req.auth.role),
        finalTransitions: Object.entries(W.FINAL_TRANSITIONS)
          .filter(([from]) => from === a.status)
          .flatMap(([from, rule]) => (rule.roles.includes(req.auth.role) ? rule.to : [])),
      };
      res.json({
        success: true,
        application: view,
        view: { group: W.groupOf(a.flowStatus), stepStates: W.stepStates(a.flowStatus, a.rejectedAtStep), reviewableStep: a.flowStatus === W.REVIEWABLE[1] ? 1 : a.flowStatus === W.REVIEWABLE[2] ? 2 : null },
        user: user ? { ...user, phoneVerified: !!user.phoneVerifiedAt } : null,
        reviews, submissions, acceptances, audit: auditRows, deliveries, permissions: ownPermissions,
        bankRevealed: reveal,
      });
    });

    // Approve / reject / request changes on step 1 or 2. Only the pending step, only authorized roles.
    app.post('/api/flow/applications/:id/steps/:n/decision', staffView, async (req, res) => {
      const n = parseStep(req, res); if (!n) return;
      if (n === 3) return res.status(400).json({ success: false, error: 'Step 3 is not approved at this stage; it goes to final processing.' });
      const { decision } = req.body || {};
      const note = String((req.body && req.body.note) || '').trim().slice(0, 1000);
      if (!W.DECISIONS.includes(decision)) return res.status(400).json({ success: false, error: 'decision must be approve, reject or request_changes' });
      if (!W.canDecide(req.auth.role, decision)) return res.status(403).json({ success: false, error: `Role "${req.auth.role}" may not ${decision.replace('_', ' ')} a step.` });
      const a = await getFlowAppById(req.params.id);
      if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
      if (a.flowStatus !== W.REVIEWABLE[n]) return res.status(409).json({ success: false, code: 'NOT_PENDING', error: `Step ${n} is not awaiting approval (current status: ${a.flowStatus}).` });
      if ((decision === 'reject' || decision === 'request_changes') && note.length < 3) {
        return res.status(422).json({ success: false, code: 'VALIDATION', fieldErrors: { note: 'required' }, error: decision === 'reject' ? 'A rejection reason is required.' : 'Please describe the changes the applicant needs to make.' });
      }

      const now = new Date().toISOString();
      const next = { ...a, updatedAt: now };
      next.flowStatus = W.DECISION_RESULT[n][decision];
      next.unlockedStep = W.unlockedStepFor(next.flowStatus);
      next.currentStep = next.unlockedStep;
      if (decision === 'reject') {
        next.rejectedAtStep = String(n);
        next.rejectionReason = note;
        next.status = 'Rejected';
        next.staffMessage = null;
      } else if (decision === 'request_changes') {
        next.staffMessage = { text: note, at: now, byRole: req.auth.role, step: n };
      } else {
        next.staffMessage = null;
      }
      if (!(await updateFlowApp(next, a.flowStatus))) return res.status(409).json({ success: false, code: 'CONFLICT', error: 'The application was changed by someone else. Please reload.' });
      const revision = (await dbGet('SELECT COUNT(*) AS c FROM application_step_submissions WHERE applicationId = ? AND step = ?', [a.id, n])).c || 0;
      await dbRun(
        'INSERT INTO application_step_reviews (id, applicationId, step, decision, note, revision, reviewerId, reviewerName, reviewerRole, decidedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [newId('rev'), a.id, n, decision, note || null, revision, req.auth.sub, req.auth.name || req.auth.role, req.auth.role, now]
      );
      const action = decision === 'approve' ? `STEP${n}_APPROVED` : decision === 'reject' ? `STEP${n}_REJECTED` : `STEP${n}_CHANGES_REQUESTED`;
      await audit(req, { applicationId: a.id, action, fromStatus: a.flowStatus, toStatus: next.flowStatus, metadata: { note: note || null, revision } });
      const saved = await getFlowAppById(a.id);
      notifier.notifyFlowEvent({ app: saved, event: action, note, reason: note }).catch((err) => console.error('[FLOW NOTIFY]', err.message));
      res.json({ success: true, flowStatus: saved.flowStatus, group: W.groupOf(saved.flowStatus) });
    });

    // Final stage: the existing approval / loan-granting procedure (canonical statuses).
    app.post('/api/flow/applications/:id/final-decision', staffView, async (req, res) => {
      const { status } = req.body || {};
      const reason = String((req.body && req.body.reason) || '').trim().slice(0, 1000);
      const missingNote = String((req.body && req.body.missingNote) || '').trim().slice(0, 1000);
      const a = await getFlowAppById(req.params.id);
      if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
      if (![W.FLOW_STATUS.PENDING_FINAL_PROCESSING, W.FLOW_STATUS.LOAN_APPROVED].includes(a.flowStatus)) {
        return res.status(409).json({ success: false, code: 'NOT_IN_FINAL_STAGE', error: 'The applicant has not completed all three steps yet.' });
      }
      const problem = W.checkFinalTransition(req.auth.role, a.status, status);
      if (problem) return res.status(problem.startsWith('Role') ? 403 : 409).json({ success: false, error: problem });
      if (status === 'Rejected' && reason.length < 3) return res.status(422).json({ success: false, code: 'VALIDATION', fieldErrors: { reason: 'required' }, error: 'A rejection reason is required.' });
      if (status === 'Additional Document Required' && missingNote.length < 3) return res.status(422).json({ success: false, code: 'VALIDATION', fieldErrors: { missingNote: 'required' }, error: 'Please describe the document that is needed.' });

      const now = new Date().toISOString();
      const next = { ...a, updatedAt: now, status };
      next.flowStatus = W.flowStatusForCanonical(status);
      if (status === 'Rejected') { next.rejectedAtStep = 'final'; next.rejectionReason = reason; }
      next.statusHistory = [{
        id: newId('sh'), applicationId: a.id, fromStatus: a.status, toStatus: status, changedByType: req.auth.role,
        changedById: req.auth.sub, changedByName: req.auth.name || req.auth.role,
        reason: reason || (status === 'Additional Document Required' ? missingNote : undefined), createdAt: now,
      }, ...(a.statusHistory || [])];
      mirrorLegacy(next);
      if (!(await updateFlowApp(next, a.flowStatus))) return res.status(409).json({ success: false, code: 'CONFLICT', error: 'The application was changed by someone else. Please reload.' });
      await dbRun('UPDATE applications SET missingDocumentNotes = ? WHERE id = ?', [status === 'Additional Document Required' ? missingNote : null, a.id]);
      await audit(req, { applicationId: a.id, action: 'FINAL_STATUS_CHANGED', fromStatus: a.status, toStatus: status, metadata: { flowStatus: next.flowStatus, reason: reason || null, missingNote: missingNote || null } });

      const saved = await getFlowAppById(a.id);
      if (status === 'Approved') notifier.notifyFlowEvent({ app: saved, event: 'LOAN_APPROVED' }).catch((err) => console.error('[FLOW NOTIFY]', err.message));
      else if (status === 'Rejected') notifier.notifyFlowEvent({ app: saved, event: 'LOAN_REJECTED', reason }).catch((err) => console.error('[FLOW NOTIFY]', err.message));
      else notifyStatusChange(saved, a.status).catch((err) => console.error('[NOTIFY]', err.message));
      res.json({ success: true, flowStatus: saved.flowStatus, status: saved.status, group: W.groupOf(saved.flowStatus) });
    });

    // Free-text message to the applicant (corrections, extra information). In-app + SMS + email.
    app.post('/api/flow/applications/:id/message', requireStaff(...W.MESSAGE_ROLES), async (req, res) => {
      const message = String((req.body && req.body.message) || '').trim().slice(0, 1000);
      if (message.length < 3) return res.status(422).json({ success: false, code: 'VALIDATION', fieldErrors: { message: 'required' }, error: 'Please write a message.' });
      const a = await getFlowAppById(req.params.id);
      if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
      const now = new Date().toISOString();
      a.staffMessage = { text: message, at: now, byRole: req.auth.role, step: a.unlockedStep };
      a.updatedAt = now;
      await updateFlowApp(a);
      await audit(req, { applicationId: a.id, action: 'STAFF_MESSAGE_SENT', metadata: { message } });
      const saved = await getFlowAppById(a.id);
      const result = await notifier.notifyFlowEvent({ app: saved, event: 'STAFF_MESSAGE', note: message });
      res.json({ success: true, delivery: result });
    });

    app.post('/api/flow/applications/:id/deliveries/:deliveryId/retry', requireStaff(...W.MESSAGE_ROLES), async (req, res) => {
      const d = await dbGet('SELECT applicationId FROM notification_deliveries WHERE id = ?', [req.params.deliveryId]);
      if (!d || d.applicationId !== req.params.id) return res.status(404).json({ success: false, error: 'Delivery not found' });
      const r = await notifier.retryDelivery(req.params.deliveryId);
      if (r.ok) await audit(req, { applicationId: req.params.id, action: 'NOTIFICATION_RETRIED', metadata: { deliveryId: req.params.deliveryId } });
      res.status(r.status).json({ success: !!r.ok, error: r.error, delivery: r.delivery });
    });

    app.get('/api/flow/applications/:id/audit', staffView, async (req, res) => {
      const a = await getFlowAppById(req.params.id);
      if (!a) return res.status(404).json({ success: false, error: 'Application not found' });
      const rows = (await dbAll('SELECT * FROM audit_log WHERE applicationId = ? ORDER BY createdAt ASC', [a.id])).map((r) => ({ ...r, metadata: safeJson(r.metadata, null) }));
      res.json({ success: true, audit: rows });
    });
  }

  return { registerApplicantPublic, registerStaffPublic, registerApplicant, registerStaff, notifier, mirrorLegacy, maskBank };
};
