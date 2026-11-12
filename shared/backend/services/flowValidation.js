/**
 * Server-side cleaning and validation of each step's data. The UI validates too, but this is the
 * authority: nothing reaches a "submitted" state without passing here.
 *
 * `clean*` functions are lenient (used for drafts): they keep only known fields, trim and cap
 * strings, and drop file references the applicant does not own.
 * `validate*` functions return a map { field: errorCode } (empty = valid). Error codes are
 * translated by the frontend.
 */
const path = require('path');
const { dbGet } = require('./dbHelpers');
const { isValidLoanAmount, isValidRepaymentPeriod } = require('./loanCalculator');

const ALLOWED_DOC_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const MAX_SPONSORS = 3;
const STEP1_COUNTRIES = [
  'China',
  'Thailand',
  'India',
  'Nepal',
  'Philippines',
  'Nigeria',
  'Ghana',
  'Congo',
  'Malawi',
  'South Africa',
  'Zambia',
  'Kenya',
  'Tanzania',
  'Uganda',
];

// Step 1 visa type ids (services/visaTypes.js). Optional: older records have none.
const { STEP1_VISA_TYPES } = require('./visaTypes');

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const digitsOnly = (v) => String(v || '').replace(/\D/g, '');

/** A reference to a file uploaded through POST /api/upload by this same user. */
async function cleanDocRef(ref, userId) {
  if (!ref) return null;
  const raw = typeof ref === 'string' ? ref : (ref.filename || ref.fileUrl || '');
  const filename = path.basename(String(raw));
  if (!filename || filename === '.' || filename === '..') return null;
  const row = await dbGet('SELECT * FROM uploaded_files WHERE filename = ?', [filename]);
  if (!row || row.userId !== userId || !ALLOWED_DOC_MIME.includes(row.mimeType)) return null;
  return {
    filename,
    fileUrl: `/api/uploads/${filename}`,
    originalName: row.originalName,
    mimeType: row.mimeType,
    size: row.size,
    uploadedAt: row.createdAt,
  };
}

const isIsoDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// ---------------------------------------------------------------------------
// Step 1: registration & loan application
// ---------------------------------------------------------------------------
async function cleanStep1(raw, userId) {
  const d = raw || {};
  const personal = d.personal || {};
  const docs = d.documents || {};
  const emp = d.employment || {};
  const loan = d.loan || {};
  const amount = Number(loan.requestedAmountNis);
  const rawSalary = personal.monthlySalaryNis !== undefined && personal.monthlySalaryNis !== null && personal.monthlySalaryNis !== ''
    ? Number(personal.monthlySalaryNis)
    : Number(emp.monthlySalaryNis);
  const salaryNis = Number.isFinite(rawSalary) && rawSalary > 0 ? Math.round(rawSalary * 100) / 100 : 0;
  return {
    personal: {
      fullName: str(personal.fullName, 120),
      phoneNumber: str(personal.phoneNumber, 30),
      dateOfBirth: str(personal.dateOfBirth, 10),
      address: str(personal.address, 250),
      passportNumber: str(personal.passportNumber, 30),
      countryOfOrigin: str(personal.countryOfOrigin, 60),
      visaType: STEP1_VISA_TYPES.includes(personal.visaType) ? personal.visaType : '',
      visaStartDate: str(personal.visaStartDate, 10),
      visaExpiryDate: str(personal.visaExpiryDate, 10),
      monthlySalaryNis: salaryNis,
      salaryCurrency: 'ILS',
    },
    documents: {
      passport: await cleanDocRef(docs.passport, userId),
      visa: await cleanDocRef(docs.visa, userId),
      payslip: await cleanDocRef(docs.payslip, userId),
    },
    employment: {
      employerName: str(emp.employerName, 120),
      companyName: str(emp.companyName, 120),
      manpowerAgent: str(emp.manpowerAgent, 120),
      monthlySalaryNis: salaryNis,
      salaryCurrency: 'ILS',
    },
    loan: { requestedAmountNis: Number.isFinite(amount) ? amount : 0 },
  };
}

function validateStep1(d) {
  const e = {};
  if (!d.personal.fullName) e.fullName = 'required';
  if (digitsOnly(d.personal.phoneNumber).length < 7) e.phoneNumber = 'invalid';
  if (!d.personal.dateOfBirth) e.dateOfBirth = 'required';
  else if (!isIsoDate(d.personal.dateOfBirth) || new Date(d.personal.dateOfBirth) > new Date()) e.dateOfBirth = 'invalid';
  if (!d.personal.address) e.address = 'required';
  if (!d.personal.passportNumber) e.passportNumber = 'required';
  if (!d.personal.countryOfOrigin) e.countryOfOrigin = 'required';
  else if (!STEP1_COUNTRIES.includes(d.personal.countryOfOrigin)) e.countryOfOrigin = 'invalid';
  if (!d.personal.visaStartDate) e.visaStartDate = 'required';
  else if (!isIsoDate(d.personal.visaStartDate)) e.visaStartDate = 'invalid';
  if (!d.personal.visaExpiryDate) e.visaExpiryDate = 'required';
  else if (!isIsoDate(d.personal.visaExpiryDate)) e.visaExpiryDate = 'invalid';
  else if (d.personal.visaStartDate && isIsoDate(d.personal.visaStartDate) && d.personal.visaExpiryDate < d.personal.visaStartDate) {
    e.visaExpiryDate = 'before_start';
  }
  if (!(d.personal.monthlySalaryNis > 0)) e.monthlySalaryNis = 'required';
  if (!d.documents.passport) e.passport = 'required';
  if (!d.documents.visa) e.visa = 'required';
  if (!d.documents.payslip) e.payslip = 'required';
  if (!d.employment.employerName) e.employerName = 'required';
  if (!d.employment.companyName) e.companyName = 'required';
  if (!isValidLoanAmount(d.loan.requestedAmountNis)) e.requestedAmountNis = 'invalid';
  return e;
}

// ---------------------------------------------------------------------------
// Step 2: sponsors + loan amount & repayment duration
// ---------------------------------------------------------------------------
function cleanStep2(raw) {
  const d = raw || {};
  const loan = d.loan || {};
  const sponsors = (Array.isArray(d.sponsors) ? d.sponsors : []).slice(0, MAX_SPONSORS + 2).map((s, i) => ({
    id: str(s && s.id, 40) || `sp_${i + 1}`,
    fullName: str(s && s.fullName, 120),
    idOrPassportNumber: str(s && s.idOrPassportNumber, 30),
  }));
  const amount = Number(loan.requestedAmountNis);
  const months = Number(loan.repaymentPeriodMonths);
  return {
    loan: {
      requestedAmountNis: Number.isFinite(amount) ? amount : 0,
      repaymentPeriodMonths: Number.isFinite(months) ? months : 0,
    },
    sponsors,
  };
}

function validateStep2(d) {
  const e = {};
  if (d.sponsors.length === 0) e.sponsors = 'required';
  else if (d.sponsors.length > MAX_SPONSORS) e.sponsors = 'too_many';
  d.sponsors.forEach((s, i) => {
    if (!s.fullName) e[`sponsors.${i}.fullName`] = 'required';
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{3,29}$/.test(s.idOrPassportNumber)) e[`sponsors.${i}.idOrPassportNumber`] = 'invalid';
  });
  if (!isValidLoanAmount(d.loan.requestedAmountNis)) e.requestedAmountNis = 'invalid';
  if (!isValidRepaymentPeriod(d.loan.repaymentPeriodMonths)) e.repaymentPeriodMonths = 'invalid';
  return e;
}

// ---------------------------------------------------------------------------
// Step 3: bank details, bank account management document, terms
// ---------------------------------------------------------------------------
async function cleanStep3(raw, userId) {
  const d = raw || {};
  const bank = d.bank || {};
  const terms = d.terms || {};
  return {
    bank: {
      bankName: str(bank.bankName, 80),
      bankCode: str(bank.bankCode, 10),
      branchNumber: str(bank.branchNumber, 20),
      accountNumber: str(bank.accountNumber, 30),
      accountHolderName: str(bank.accountHolderName, 120),
    },
    bankDocument: await cleanDocRef(d.bankDocument, userId),
    terms: {
      generalVersion: str(terms.generalVersion, 20),
      serviceFeeVersion: str(terms.serviceFeeVersion, 20),
      generalAccepted: terms.generalAccepted === true,
      serviceFeeAccepted: terms.serviceFeeAccepted === true,
    },
  };
}

function validateStep3(d) {
  const e = {};
  if (!d.bank.bankName) e.bankName = 'required';
  if (!/^[0-9-]{2,20}$/.test(d.bank.branchNumber)) e.branchNumber = 'invalid';
  if (!/^[0-9-]{4,30}$/.test(d.bank.accountNumber)) e.accountNumber = 'invalid';
  if (!d.bank.accountHolderName) e.accountHolderName = 'required';
  if (!d.bankDocument) e.bankDocument = 'required';
  if (!d.terms.generalAccepted) e.termsGeneral = 'required';
  if (!d.terms.serviceFeeAccepted) e.termsServiceFee = 'required';
  return e;
}

module.exports = {
  ALLOWED_DOC_MIME,
  MAX_SPONSORS,
  STEP1_COUNTRIES,
  STEP1_VISA_TYPES,
  cleanDocRef,
  cleanStep1, validateStep1,
  cleanStep2, validateStep2,
  cleanStep3, validateStep3,
};
