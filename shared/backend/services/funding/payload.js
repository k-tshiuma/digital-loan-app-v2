/**
 * The data package sent to the funding partner (schema quickloan.loan-application.v1). It holds what the
 * partner needs for its own compliance checks: the applicant, passport and visa, employment and salary,
 * the loan terms, the real (unmasked) bank account, the sponsors, the terms acceptance, and every document
 * as a file (base64, with its SHA-256 and size so the partner can check it arrived intact).
 *
 * summarize() is what we keep in funding_handoffs: no personal data and no file contents.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 'quickloan.loan-application.v1';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

class PayloadError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * @param {object} a           the application (parsed, unmasked)
 * @param {object} user        its account row
 * @param {object} acceptance  the terms_acceptances row that covers the transfer
 * @param {string} uploadDir   where the uploaded files are
 * @param {object} handoff     { id, createdAt } of the funding_handoffs row: fixed, so a retry sends the same bytes
 */
function buildPayload(a, user, acceptance, uploadDir, handoff) {
  const s1 = a.step1Data || {};
  const s2 = a.step2Data || {};
  const s3 = a.step3Data || {};
  const p = s1.personal || {};
  const emp = s1.employment || {};
  const lb = a.loanBreakdown || {};
  const bank = s3.bank || {};
  const sponsors = Array.isArray(s2.sponsors) ? s2.sponsors : [];

  const documents = [];
  const addDoc = (ref, type, extra = {}) => {
    if (!ref || !ref.filename) return;
    const file = path.join(uploadDir, path.basename(ref.filename));
    if (!fs.existsSync(file)) throw new PayloadError('DOCUMENT_MISSING', `The file for ${type} (${ref.originalName || ref.filename}) is missing on the server.`);
    const buf = fs.readFileSync(file);
    documents.push({
      id: ref.filename,
      type,
      fileName: ref.originalName || ref.filename,
      mimeType: ref.mimeType || 'application/octet-stream',
      size: buf.length,
      sha256: sha256(buf),
      uploadedAt: ref.uploadedAt || null,
      ...extra,
      contentBase64: buf.toString('base64'),
    });
  };
  const d1 = s1.documents || {};
  addDoc(d1.passport, 'PASSPORT');
  addDoc(d1.visa, 'WORK_VISA');
  addDoc(d1.payslip, 'PAY_SLIP');
  sponsors.forEach((sp, i) => addDoc(sp.document, 'GUARANTOR_ID', { sponsorIndex: i }));
  addDoc(s3.bankDocument, 'BANK_ACCOUNT_DOCUMENT');
  (s3.extraDocuments || []).forEach((d) => addDoc(d, 'ADDITIONAL_DOCUMENT'));

  const approval = (a.statusHistory || []).find((h) => h.toStatus === 'Approved');
  return {
    schemaVersion: SCHEMA_VERSION,
    source: { system: 'QuickLoan', applicationId: a.id, requestNumber: a.requestNumber, handoffId: handoff.id, createdAt: handoff.createdAt },
    applicant: {
      fullName: p.fullName || (user && user.fullName) || '',
      dateOfBirth: p.dateOfBirth || null,
      phoneNumber: p.phoneNumber || (user && user.phoneNumber) || null,
      email: p.email || (user && user.email) || null,
      address: p.address || null,
      countryOfOrigin: p.countryOfOrigin || null,
      passportNumber: p.passportNumber || null,
      visa: { type: p.visaType || null, startDate: p.visaStartDate || null, expiryDate: p.visaExpiryDate || null },
      preferredLanguage: a.language || null,
    },
    employment: {
      employerName: emp.employerName || null,
      companyName: emp.companyName || null,
      manpowerAgent: emp.manpowerAgent || null,
      monthlySalaryNis: Number(emp.monthlySalaryNis || p.monthlySalaryNis) || null,
    },
    loan: {
      requestedAmountNis: lb.requestedAmountNis,
      repaymentPeriodMonths: lb.repaymentPeriodMonths,
      interestRatePercent: lb.interestRatePercent,
      totalInterestNis: lb.totalInterestNis,
      serviceFeeNis: lb.totalServiceFeeNis,
      monthlyLoanRepaymentNis: lb.monthlyLoanRepaymentNis,
      monthlyServiceFeeNis: lb.monthlyServiceFeeNis,
      monthlyPaymentTotalNis: lb.monthlyPaymentTotalNis,
      totalLoanRepaymentNis: lb.totalLoanRepaymentNis,
      overallTotalNis: lb.overallTotalNis,
      approvedAt: approval ? approval.createdAt : null,
      approvedBy: approval ? approval.changedByName || approval.changedByType : null,
    },
    bankAccount: {
      bankName: bank.bankName || null,
      bankCode: bank.bankCode || null,
      branchNumber: bank.branchNumber || null,
      accountNumber: bank.accountNumber || null,
      accountHolderName: bank.accountHolderName || null,
    },
    sponsors: sponsors.map((sp, i) => ({ index: i, fullName: sp.fullName || null, idOrPassportNumber: sp.idOrPassportNumber || null, documentId: sp.document ? sp.document.filename : null })),
    consent: {
      termsType: acceptance.termsType,
      termsVersion: acceptance.version,
      termsSha256: acceptance.textSha256,
      language: acceptance.language || null,
      acceptedAt: acceptance.acceptedAt,
      partnerSharing: true,
      signature: s3.signature ? { method: s3.signature.signatureMethod, value: s3.signature.signatureValue, signedAt: s3.signature.signedAt } : null,
    },
    documents,
  };
}

/** What we store about a sent package: amounts, document list and hashes, never personal data or files. */
function summarize(payload) {
  return {
    schemaVersion: payload.schemaVersion,
    requestNumber: payload.source.requestNumber,
    loan: { requestedAmountNis: payload.loan.requestedAmountNis, repaymentPeriodMonths: payload.loan.repaymentPeriodMonths },
    sponsors: payload.sponsors.length,
    consent: { termsVersion: payload.consent.termsVersion, acceptedAt: payload.consent.acceptedAt },
    documents: payload.documents.map((d) => ({ type: d.type, size: d.size, sha256: d.sha256 })),
  };
}

const payloadHash = (payload) => sha256(Buffer.from(JSON.stringify(payload)));

module.exports = { SCHEMA_VERSION, buildPayload, summarize, payloadHash, PayloadError };
