#!/usr/bin/env node
/**
 * Builds a sample database with 100 loan applications in every state of the 3-step workflow:
 * leads, drafts with missing documents, every pending and "changes requested" step, applications
 * in final processing, approved loans (some forwarded to the funding entity) and loans rejected at
 * Step 1, Step 2 and the final stage. See PLAN below for the exact mix.
 *
 * Everything goes through the real APIs (registration, uploads, step submissions, staff decisions),
 * so each record passes the server validation and has its request number, audit trail, terms
 * acceptances and notifications. The only direct database changes come afterwards: the timestamps
 * are moved back over the last six months (so the analytics graphs have shape) and a few SMS
 * deliveries are marked as failed (to try the delivery retry).
 *
 * It writes to its own database file, never to data/database.sqlite (the integration tests use that
 * one). Uploaded documents go to data/uploads/ (gitignored), like any other upload.
 *
 * Usage (repo root):
 *   node scripts/seed_sample_data.js            build data/sample.sqlite (refuses if it exists)
 *   node scripts/seed_sample_data.js --reset    delete the sample database and its uploads first
 * Options:
 *   --db=<path>     database file (default data/sample.sqlite)
 *   --docs=<dir>    sample documents (default sample-documents/). File names decide the type:
 *                   "passport", "visa", "payslip", "bank"; names with "guarantor"/"sponsor" are skipped
 *                   (Step 2 records a guarantor's name and ID number only, there is no upload for it).
 *   --seed=<n>      random seed (default 2026); the same seed gives the same 100 records
 *   --port=<n>      the borrower API listens on n, the admin API on n+1 (default 5091)
 *
 * Staff passwords come from ADMIN_/REVIEWER_/SERVICE_/FUNDING_INITIAL_PASSWORD, like npm run seed:staff.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const DB_PATH = path.resolve(ROOT, args.db || 'data/sample.sqlite');
const UPLOAD_DIR = path.resolve(ROOT, 'data/uploads');
const DOCS_DIR = path.resolve(ROOT, args.docs || 'sample-documents');
const SEED = parseInt(args.seed || '2026', 10);
const BORROWER_PORT = parseInt(args.port || '5091', 10);
const ADMIN_PORT = BORROWER_PORT + 1;
const BORROWER_API = `http://127.0.0.1:${BORROWER_PORT}/api`;
const ADMIN_API = `http://127.0.0.1:${ADMIN_PORT}/api`;

const STAFF = {
  system_admin: { email: 'admin@quickloan.co.il', password: process.env.ADMIN_INITIAL_PASSWORD || 'Admin123456!' },
  credit_reviewer: { email: 'reviewer@quickloan.co.il', password: process.env.REVIEWER_INITIAL_PASSWORD || 'Reviewer123456!' },
  customer_service: { email: 'service@quickloan.co.il', password: process.env.SERVICE_INITIAL_PASSWORD || 'Service123456!' },
  funding_entity: { email: 'funding@quickloan.co.il', password: process.env.FUNDING_INITIAL_PASSWORD || 'Funding123456!' },
};

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NOW = Date.now();
const OLD_FEE = 3000;
const NEW_FEE = 2500;
const FEE_CHANGED_AT = NOW - 30 * DAY; // applications created after this take the new fee

// ---------------------------------------------------------------------------
// Deterministic random helpers
// ---------------------------------------------------------------------------
let rngState = SEED >>> 0;
function rand() {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min, max) => min + rand() * (max - min);
const intBetween = (min, max) => Math.floor(between(min, max + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const digits = (n) => Array.from({ length: n }, () => intBetween(0, 9)).join('');
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Sample people and places (invented)
// ---------------------------------------------------------------------------
const PEOPLE = {
  China: { first: ['Wei', 'Li Na', 'Zhang Min', 'Chen Jie', 'Liu Yang', 'Huang Mei'], last: ['Wang', 'Zhao', 'Sun', 'Zhou', 'Wu', 'Xu'], passport: () => `E${digits(8)}` },
  Thailand: { first: ['Somchai', 'Niran', 'Anong', 'Kittipong', 'Malee', 'Prasert'], last: ['Saelim', 'Chaiyaphum', 'Wongsa', 'Boonmee', 'Srisuk', 'Kaewmanee'], passport: () => `AA${digits(7)}` },
  India: { first: ['Rahul', 'Priya', 'Arjun', 'Sunita', 'Vikram', 'Deepa'], last: ['Sharma', 'Patel', 'Singh', 'Kumar', 'Reddy', 'Nair'], passport: () => `${pick(['K', 'M', 'R', 'X'])}${digits(7)}` },
  Nepal: { first: ['Bikash', 'Sita', 'Ramesh', 'Anita', 'Suman', 'Gita'], last: ['Thapa', 'Gurung', 'Shrestha', 'Tamang', 'Rai', 'Magar'], passport: () => `PA${digits(7)}` },
  Philippines: { first: ['Maria', 'Jose', 'Angelica', 'Mark', 'Rowena', 'Jonathan'], last: ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza'], passport: () => `P${digits(7)}${pick(['A', 'B', 'C'])}` },
  Nigeria: { first: ['Chinedu', 'Ngozi', 'Emeka', 'Aisha', 'Tunde', 'Funmi'], last: ['Okafor', 'Adeyemi', 'Okonkwo', 'Bello', 'Eze', 'Balogun'], passport: () => `A${digits(8)}` },
  Ghana: { first: ['Kwame', 'Ama', 'Kofi', 'Akosua', 'Yaw', 'Efua'], last: ['Mensah', 'Owusu', 'Boateng', 'Asante', 'Appiah', 'Osei'], passport: () => `G${digits(7)}` },
  Congo: { first: ['Jean-Paul', 'Grace', 'Patrick', 'Esther', 'Christian', 'Nadine'], last: ['Kabongo', 'Mukendi', 'Tshibanda', 'Ilunga', 'Kalala', 'Mbuyi'], passport: () => `OB${digits(7)}` },
  Malawi: { first: ['Chikondi', 'Thoko', 'Blessings', 'Mphatso', 'Chisomo', 'Kondwani'], last: ['Banda', 'Phiri', 'Mwale', 'Chirwa', 'Nyirenda', 'Gondwe'], passport: () => `MA${digits(6)}` },
  'South Africa': { first: ['Thabo', 'Lerato', 'Sipho', 'Naledi', 'Bongani', 'Zanele'], last: ['Nkosi', 'Dlamini', 'Mokoena', 'Khumalo', 'Ndlovu', 'Zulu'], passport: () => `A${digits(8)}` },
  Zambia: { first: ['Mwila', 'Chanda', 'Bwalya', 'Mutale', 'Kabwe', 'Natasha'], last: ['Mulenga', 'Tembo', 'Zulu', 'Lungu', 'Sakala', 'Mwansa'], passport: () => `ZN${digits(6)}` },
  Kenya: { first: ['Wanjiru', 'Otieno', 'Achieng', 'Kamau', 'Njeri', 'Mwangi'], last: ['Kariuki', 'Odhiambo', 'Mutua', 'Wafula', 'Kiprop', 'Njoroge'], passport: () => `AK${digits(7)}` },
  Tanzania: { first: ['Baraka', 'Neema', 'Juma', 'Rehema', 'Hamisi', 'Zawadi'], last: ['Mushi', 'Mwakyusa', 'Massawe', 'Lyimo', 'Kimaro', 'Shirima'], passport: () => `TAE${digits(6)}` },
  Uganda: { first: ['Okello', 'Nakato', 'Mugisha', 'Namubiru', 'Ssempa', 'Akello'], last: ['Kato', 'Mukasa', 'Ochieng', 'Byaruhanga', 'Tumusiime', 'Nsubuga'], passport: () => `B${digits(7)}` },
};
// Weighted toward the countries most workers come from.
const COUNTRY_WEIGHTS = [['Thailand', 18], ['Philippines', 14], ['India', 12], ['China', 10], ['Nepal', 9], ['Nigeria', 5], ['Ghana', 5], ['Kenya', 5], ['Congo', 4], ['Malawi', 4], ['Uganda', 4], ['Tanzania', 4], ['Zambia', 3], ['South Africa', 3]];
const pickCountry = () => {
  let r = rand() * COUNTRY_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  for (const [c, w] of COUNTRY_WEIGHTS) { r -= w; if (r < 0) return c; }
  return 'Thailand';
};

const EMPLOYERS = [
  ['Yossi Mizrahi', 'Mizrahi Agriculture Ltd', 'AgroManpower TLV'],
  ['Dana Levi', 'Levi Greenhouses Ltd', 'Negev Workforce'],
  ['Avi Cohen', 'Cohen Construction & Sons', 'BuildForce Israel'],
  ['Rina Shapiro', 'Shapiro Home Care', 'CareLink Manpower'],
  ['Moshe Peretz', 'Peretz Hotels Eilat', 'Red Sea Staffing'],
  ['Noa Friedman', 'Galilee Fruit Packers', 'North Agro Agents'],
  ['Eitan Ben-David', 'Ben-David Restaurants', ''],
  ['Tamar Katz', 'Katz Nursing Services', 'CareLink Manpower'],
  ['Oren Biton', 'Biton Steel Works', 'BuildForce Israel'],
  ['Michal Avraham', 'Arava Date Farms', 'Negev Workforce'],
];
const ADDRESSES = ['Herzl St 14, Tel Aviv', 'HaNasi Blvd 7, Haifa', 'Jabotinsky St 33, Ramat Gan', 'HaAtzmaut St 5, Beersheba',
  'Rothschild Blvd 12, Tel Aviv', 'Moshav Ein Yahav 41', 'Kibbutz Yotvata 3', 'Weizmann St 20, Rehovot', 'Ben Gurion Ave 9, Bat Yam',
  'HaGalil St 18, Kiryat Shmona', 'Sderot Yerushalayim 61, Jaffa', 'HaPalmach St 2, Eilat', 'Moshav Ahituv 17', 'Allenby St 88, Tel Aviv'];
const BANKS = [['Bank Hapoalim', '12'], ['Bank Leumi', '10'], ['Israel Discount Bank', '11'], ['Mizrahi-Tefahot Bank', '20'],
  ['First International Bank', '31'], ['Mercantile Discount Bank', '17'], ['Postal Bank', '09']];
// Guarantors: three match the specimen documents in sample-documents/, the rest are invented.
const SPONSORS = [
  ['John Doe', 'AA1112223333'], ['Jane Doe', 'AA543210'], ['Zhengjian Yangben', 'EF1260892'],
  ['Yael Goldberg', '0' + '31245678'], ['Ronen Azulay', '0' + '25873149'], ['Shira Malka', '0' + '38816402'],
  ['Somsak Inthong', 'AA4471902'], ['Grace Wanjiku', 'AK2290417'], ['Daniel Ofori', 'G5530918'], ['Liza Ramos', 'P6627130B'],
];
const VISA_WEIGHTS = [['work', 70], ['foreign_expert', 10], ['volunteer', 5], ['student', 5], ['temporary_residence', 5], ['clergy', 3], ['conditional_release', 2]];
const pickVisa = () => {
  let r = rand() * 100;
  for (const [v, w] of VISA_WEIGHTS) { r -= w; if (r < 0) return v; }
  return 'work';
};

// ---------------------------------------------------------------------------
// The plan: 100 cases. Each is a list of actions with the hours that pass before each one.
// ---------------------------------------------------------------------------
const NOTE = {
  passportBlurry: 'The passport photo is blurry and the passport number cannot be read. Please upload a clear photo of the passport photo page.',
  visaExpired: 'Your visa has expired. Please upload your current, valid visa.',
  payslipOld: 'The payslip is older than 3 months. Please upload your most recent payslip.',
  nameMismatch: 'The name on the application does not match the passport. Please enter your name exactly as it appears in your passport.',
  visaCut: 'The visa page is cut off. Please upload the full page, including the expiry date.',
  payslipEmployer: "The payslip does not show your employer's name. Please upload a payslip that does.",
  amountHigh: 'The requested amount is too high for your salary. Please lower the amount or choose a longer repayment period.',
  sponsorId: "The guarantor's ID number does not match the document we hold. Please check the guarantor details.",
  sponsorSecond: 'Your guarantor does not live in Israel. Please add a second guarantor who does.',
  sponsorName: "The guarantor's name is incomplete. Please enter the full name as it appears on their passport or ID.",
  bankUnsigned: 'The bank account management permission is not signed. Please upload a signed copy.',
  payslipRecent: 'Please upload your most recent payslip (the one on file is more than 3 months old).',
};

const PLAN = [];
const add = (count, category, build) => { for (let i = 0; i < count; i++) PLAN.push({ category, ...build(i) }); };

const S1 = (extra = {}) => ({ type: 'submit1', gap: [0.3, 30], ...extra });
const APPROVE1 = { type: 'decide', step: 1, decision: 'approve', role: 'credit_reviewer', gap: [3, 52] };
const S2 = (extra = {}) => ({ type: 'submit2', gap: [2, 72], ...extra });
const APPROVE2 = { type: 'decide', step: 2, decision: 'approve', role: 'credit_reviewer', gap: [3, 52] };
const S3 = { type: 'submit3', gap: [2, 96] };
const FINAL = (status, extra = {}) => ({ type: 'final', status, role: 'credit_reviewer', gap: [4, 60], ...extra });
const CHANGES = (step, note, role = 'customer_service') => ({ type: 'decide', step, decision: 'request_changes', note, role, gap: [3, 52] });
const REJECT = (step, note) => ({ type: 'decide', step, decision: 'reject', note, role: 'credit_reviewer', gap: [3, 52] });
const THROUGH_STEP2 = [S1(), APPROVE1, S2(), APPROVE2];

// 1. Leads: registered, Step 1 not started.
add(4, 'Lead, Step 1 not started', (i) => ({
  age: [1, 20], auth: i < 2 ? 'manual' : 'google', googlePhone: i === 3, expect: 'LEAD_REGISTERED', actions: [],
}));
// 2. Step 1 drafts with documents missing.
const DRAFT_MISSING = [['passport'], ['passport'], ['passport'], ['visa'], ['visa'], ['payslip'], ['payslip'], ['payslip'], ['passport', 'visa', 'payslip'], ['passport', 'visa', 'payslip']];
add(10, 'Step 1 draft, documents missing', (i) => ({
  age: [1, 25], expect: 'LEAD_REGISTERED',
  actions: [{ type: 'draft1', missing: DRAFT_MISSING[i], noEmployer: i === 9, gap: [0.2, 20] }],
}));
// 3. Waiting for Step 1 approval.
const P1 = [{}, { visaSoon: true }, { salary: 4500 }, { nameCorrection: true }, {}, {}, { amount: 10000 }, { auth: 'google' }];
add(8, 'Waiting for Step 1 approval', (i) => ({
  age: [1, 6], profile: P1[i], auth: P1[i].auth, googlePhone: true, failSms: i === 0 || i === 5,
  expect: 'PENDING_STEP1_APPROVAL', actions: [S1()],
}));
// 4. Step 1 changes requested (two applicants have started fixing it: the bad document is removed).
const C1 = [['passportBlurry', 'passport'], ['visaExpired', 'visa'], ['payslipOld', 'payslip'], ['nameMismatch', null], ['visaCut', null], ['payslipEmployer', null]];
add(6, 'Step 1 changes requested', (i) => ({
  age: [3, 15], profile: i === 1 ? { visaExpired: true } : {}, failSms: i === 2, expect: 'STEP1_CHANGES_REQUESTED',
  actions: [S1(), CHANGES(1, NOTE[C1[i][0]], i % 2 ? 'credit_reviewer' : 'customer_service'),
    ...(C1[i][1] && i < 2 ? [{ type: 'draft1', missing: [C1[i][1]], gap: [2, 30] }] : [])],
}));
// 5. Step 1 approved, Step 2 not submitted (two partial drafts, one without a guarantor).
add(4, 'Step 1 approved, Step 2 not submitted', (i) => ({
  age: [3, 14], expect: 'STEP1_APPROVED',
  actions: [S1(), APPROVE1, ...(i >= 2 ? [{ type: 'draft2', sponsors: i === 2 ? 0 : 1, gap: [1, 30] }] : [])],
}));
// 6. Waiting for Step 2 approval: the loan amount and term limits.
const P2 = [[500, 3, 1], [10000, 9, 3], [3000, 6, 1], [6000, 9, 2], [8000, 6, 2], [1500, 3, 1]];
add(6, 'Waiting for Step 2 approval', (i) => ({
  age: [3, 12], profile: { amount: P2[i][0], months: P2[i][1], sponsors: P2[i][2] }, failSms: i === 3, expect: 'PENDING_STEP2_APPROVAL',
  actions: i === 5 ? [S1(), CHANGES(1, NOTE.payslipOld), S1({ fix: 'payslip' }), APPROVE1, S2()] : [S1(), APPROVE1, S2()],
}));
// 7. Step 2 changes requested (one applicant has removed the guarantor in a new draft).
const C2 = ['amountHigh', 'sponsorId', 'sponsorSecond', 'sponsorName'];
add(4, 'Step 2 changes requested', (i) => ({
  age: [5, 18], profile: i === 0 ? { amount: 10000, months: 3, salary: 5200 } : {}, expect: 'STEP2_CHANGES_REQUESTED',
  actions: [S1(), APPROVE1, S2(), CHANGES(2, NOTE[C2[i]], 'credit_reviewer'), ...(i === 1 ? [{ type: 'draft2', sponsors: 0, gap: [2, 30] }] : [])],
}));
// 8. Step 2 approved, Step 3 draft without the bank document.
add(5, 'Step 2 approved, Step 3 draft without bank document', (i) => ({
  age: [5, 20], expect: 'STEP2_APPROVED',
  actions: [...THROUGH_STEP2, { type: 'draft3', withBank: i < 3, gap: [1, 30] }],
}));
// 9. In final processing: Received, Under Review, Additional Document Required. The first three were
// created before the service fee changed, so they keep the old fee.
const PF = ['Received', 'Received', 'Under Review', 'Received', 'Under Review', 'Under Review', 'Additional Document Required', 'Additional Document Required'];
add(8, 'Final processing', (i) => ({
  age: i < 3 ? [32, 40] : [6, 25], expect: 'PENDING_FINAL_PROCESSING', finalStatus: PF[i],
  actions: [...THROUGH_STEP2, S3,
    ...(PF[i] === 'Under Review' ? [FINAL('Under Review')] : []),
    ...(PF[i] === 'Additional Document Required' ? [FINAL('Additional Document Required', { missingNote: i === 6 ? NOTE.bankUnsigned : NOTE.payslipRecent })] : []),
    ...(i === 5 ? [{ type: 'reveal', role: 'credit_reviewer', gap: [1, 20] }] : [])],
}));
// 10. Approved loans.
add(25, 'Approved', (i) => {
  const step1 = i < 5 ? [S1(), CHANGES(1, NOTE[['passportBlurry', 'payslipOld', 'visaCut', 'nameMismatch', 'payslipEmployer'][i]]),
    S1({ fix: ['passport', 'payslip', 'visa', null, 'payslip'][i], nameCorrection: i === 3 }), APPROVE1] : [S1(), APPROVE1];
  const step2 = i === 5 || i === 6 ? [S2(), CHANGES(2, NOTE[i === 5 ? 'amountHigh' : 'sponsorName'], 'credit_reviewer'), S2({ fix: i === 5 ? 'amount' : 'sponsor' }), APPROVE2] : [S2(), APPROVE2];
  let final;
  if (i % 12 === 7) final = [FINAL('Additional Document Required', { missingNote: NOTE.bankUnsigned }), { type: 'finalDocs', doc: 'bank', gap: [5, 72] }, FINAL('Approved')];
  else if (i % 12 === 11) final = [FINAL('Approved', { role: 'system_admin' })];
  else final = [FINAL('Under Review'), FINAL('Approved')];
  if (i % 3 === 0) final.push({ type: 'final', status: 'Forwarded to Funding Entity', role: 'funding_entity', gap: [12, 96] });
  const extra = [];
  if (i === 2 || i === 14) extra.push({ type: 'message', role: 'customer_service', text: 'Your loan has been approved. The funds will be transferred to your bank account within 3 business days.', gap: [1, 24] });
  if (i === 4 || i === 10 || i === 20) extra.push({ type: 'reveal', role: 'funding_entity', gap: [1, 48] });
  return { age: [14, 180], profile: i === 3 ? { nameCorrection: true } : {}, expect: 'LOAN_APPROVED', actions: [...step1, ...step2, S3, ...final, ...extra] };
});
// 11. Rejected: at Step 1, at Step 2 and at the final stage.
const R1 = [
  ['The passport appears to have been altered. The application cannot be accepted.', {}],
  ['The visa expired before the application date.', { visaExpired: true }],
  ['The applicant is under the minimum age of 18.', { age: 17 }],
  ['The monthly salary is below the minimum required for a loan.', { salary: 2200 }],
  ['A tourist visa does not allow work in Israel; we can only lend to applicants with a work permit.', { visaType: 'tourist' }],
  ['The passport number on the application does not match the passport document.', {}],
  ['Duplicate application: the applicant already has an open loan with us.', {}],
  ['The new payslip still does not show the employer\'s name.', {}],
];
add(8, 'Rejected at Step 1', (i) => ({
  age: [7, 180], profile: R1[i][1], expect: 'LOAN_REJECTED',
  actions: i === 7 ? [S1(), CHANGES(1, NOTE.payslipEmployer), S1({ fix: 'payslip' }), REJECT(1, R1[i][0])] : [S1(), REJECT(1, R1[i][0])],
}));
const R2 = [
  ['The monthly repayments would be more than 40% of the monthly salary.', { amount: 10000, months: 3, salary: 4800 }],
  ['The guarantor could not be verified.', {}],
  ['The visa expires before the end of the repayment period.', { visaSoon: true, months: 9 }],
  ['The guarantor already guarantees another active loan.', {}],
  ['High risk: several existing debts were reported.', {}],
  ['The applicant asked to cancel the application.', {}],
];
add(6, 'Rejected at Step 2', (i) => ({
  age: [7, 180], profile: R2[i][1], expect: 'LOAN_REJECTED', actions: [S1(), APPROVE1, S2(), REJECT(2, R2[i][0])],
}));
const RF = [
  ['The bank account is not in the applicant\'s name.', { holderMismatch: true }, ['Under Review']],
  ['The bank account management permission does not match the account details.', {}, ['Under Review']],
  ['The applicant did not send the requested document.', {}, ['Additional Document Required']],
  ['The employer confirmed that the applicant no longer works there.', {}, ['Under Review']],
  ['The signature does not match the passport.', {}, []],
  ['The funding entity declined to fund the loan.', {}, ['Under Review']],
];
add(6, 'Rejected at the final stage', (i) => ({
  age: [7, 180], profile: RF[i][1], expect: 'LOAN_REJECTED',
  actions: [...THROUGH_STEP2, S3,
    ...RF[i][2].map((s) => FINAL(s, s === 'Additional Document Required' ? { missingNote: NOTE.bankUnsigned } : {})),
    FINAL('Rejected', { reason: RF[i][0] })],
}));

// ---------------------------------------------------------------------------
// Profiles and timelines
// ---------------------------------------------------------------------------
function buildCase(c, index) {
  const p = c.profile || {};
  const createdAt = NOW - between(c.age[0], c.age[1]) * DAY;
  // Planned time of each action; squeezed to end before now when the gaps would run past it.
  const gaps = c.actions.map((a) => between(a.gap[0], a.gap[1]) * HOUR);
  const latest = NOW - between(0.5, 6) * HOUR;
  const total = gaps.reduce((s, g) => s + g, 0);
  const scale = total > 0 && createdAt + total > latest ? (latest - createdAt) / total : 1;
  let t = createdAt;
  const times = gaps.map((g) => (t += g * scale));

  const country = pickCountry();
  const people = PEOPLE[country];
  const fullName = `${pick(people.first)} ${pick(people.last)}`;
  const visaStart = createdAt - between(60, 900) * DAY;
  let visaExpiry = visaStart + between(700, 1800) * DAY;
  if (visaExpiry < createdAt + 300 * DAY) visaExpiry = createdAt + between(300, 900) * DAY;
  if (p.visaSoon) visaExpiry = createdAt + between(25, 60) * DAY;
  if (p.visaExpired) visaExpiry = createdAt - between(10, 120) * DAY;
  const ageYears = p.age || intBetween(21, 52);
  const dob = createdAt - (ageYears * 365.25 + between(20, 340)) * DAY;
  const [employerName, companyName, manpowerAgent] = pick(EMPLOYERS);
  const amount = p.amount || intBetween(2, 16) * 500;
  const months = p.months || pick([3, 6, 6, 9, 9]);
  const sponsorCount = p.sponsors || pick([1, 1, 1, 2, 2, 3]);
  const sponsors = [];
  while (sponsors.length < sponsorCount) {
    const s = pick(SPONSORS);
    if (!sponsors.some((x) => x.idOrPassportNumber === s[1])) sponsors.push({ fullName: s[0], idOrPassportNumber: s[1] });
  }
  const [bankName, bankCode] = pick(BANKS);
  const auth = c.auth || (rand() < 0.2 ? 'google' : 'manual');
  const n = String(index + 1).padStart(3, '0');
  return {
    ...c,
    index,
    createdAt,
    times,
    lang: rand() < 0.4 ? 'he' : 'en',
    auth,
    googlePhone: auth === 'google' ? c.googlePhone !== false : false,
    phone: `0549${n}${digits(3)}`,
    email: `${fullName.toLowerCase().replace(/[^a-z]+/g, '.')}.${n}@example.com`,
    // A name correction: the account was opened with the names swapped; the passport order is the legal name.
    accountName: p.nameCorrection ? fullName.split(' ').slice(-1)[0] + ' ' + fullName.split(' ')[0] : fullName,
    fullName,
    fee: createdAt < FEE_CHANGED_AT ? OLD_FEE : NEW_FEE,
    personal: {
      fullName,
      dateOfBirth: isoDate(dob),
      address: pick(ADDRESSES),
      passportNumber: people.passport(),
      countryOfOrigin: country,
      visaType: p.visaType || pickVisa(),
      visaStartDate: isoDate(visaStart),
      visaExpiryDate: isoDate(visaExpiry),
      monthlySalaryNis: p.salary || intBetween(100, 240) * 50,
    },
    employment: { employerName, companyName, manpowerAgent },
    loan: { requestedAmountNis: amount, repaymentPeriodMonths: months },
    sponsors,
    bank: {
      bankName, bankCode,
      branchNumber: String(intBetween(100, 999)),
      accountNumber: digits(intBetween(6, 9)),
      accountHolderName: p.holderMismatch ? `${pick(PEOPLE[country].first)} ${pick(PEOPLE[country].last)}` : fullName,
    },
  };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.heic': 'image/heic' };
function loadDocuments() {
  if (!fs.existsSync(DOCS_DIR)) throw new Error(`Sample documents folder not found: ${DOCS_DIR} (use --docs=<dir>)`);
  const docs = { passport: [], visa: [], payslip: [], bank: [] };
  for (const name of fs.readdirSync(DOCS_DIR)) {
    const ext = path.extname(name).toLowerCase();
    const lower = name.toLowerCase();
    if (!MIME[ext] || /guarantor|sponsor/.test(lower)) continue;
    const kind = /passport/.test(lower) ? 'passport' : /visa/.test(lower) ? 'visa' : /pay ?slip|salary/.test(lower) ? 'payslip' : /bank/.test(lower) ? 'bank' : null;
    if (kind) docs[kind].push({ name, mime: MIME[ext], data: fs.readFileSync(path.join(DOCS_DIR, name)) });
  }
  const missing = Object.keys(docs).filter((k) => docs[k].length === 0);
  if (missing.length) throw new Error(`No sample document found for: ${missing.join(', ')} (in ${DOCS_DIR})`);
  return docs;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
async function call(base, method, urlPath, body, token) {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${urlPath} -> ${res.status} ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}
const borrower = (method, p, body, token) => call(BORROWER_API, method, p, body, token);
const admin = (method, p, body, token) => call(ADMIN_API, method, p, body, token);

async function upload(doc, token) {
  const form = new FormData();
  form.append('file', new Blob([doc.data], { type: doc.mime }), doc.name);
  const res = await fetch(`${BORROWER_API}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Upload of ${doc.name} -> ${res.status} ${JSON.stringify(data)}`);
  return data.file;
}

function healthy(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/api/health', timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const children = [];
function childEnv(extra) {
  return {
    ...process.env,
    NODE_ENV: '',
    DEMO_MODE: 'true',
    DB_PATH,
    UPLOAD_DIR,
    LISTEN_HOST: '127.0.0.1',
    FLOW_REGISTER_RATE_LIMIT: '100000',
    STAFF_LOGIN_RATE_LIMIT: '1000',
    // Never send real SMS or email to the invented numbers and addresses (empty values beat the .env file).
    TWILIO_SID: '', TWILIO_TOKEN: '', SMTP_USER: '', SMTP_PASS: '',
    ADMIN_INITIAL_PASSWORD: STAFF.system_admin.password,
    REVIEWER_INITIAL_PASSWORD: STAFF.credit_reviewer.password,
    SERVICE_INITIAL_PASSWORD: STAFF.customer_service.password,
    FUNDING_INITIAL_PASSWORD: STAFF.funding_entity.password,
    ...extra,
  };
}
async function startApi(name, file, port, env) {
  if (await healthy(port)) throw new Error(`Port ${port} is already in use (use --port=<n>)`);
  const child = spawn(process.execPath, [file], { cwd: ROOT, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (c) => { output += c; });
  child.stderr.on('data', (c) => { output += c; });
  children.push(child);
  for (let i = 0; i < 60; i++) {
    if (await healthy(port)) return child;
    if (child.exitCode !== null) break;
    await sleep(500);
  }
  throw new Error(`The ${name} API did not start:\n${output.slice(-2000)}`);
}
function runNode(file, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { cwd: ROOT, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (c) => { output += c; });
    child.stderr.on('data', (c) => { output += c; });
    child.on('exit', (code) => (code === 0 ? resolve(output) : reject(new Error(`${file} failed:\n${output}`))));
  });
}
async function stopApis() {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    child.kill();
    await new Promise((r) => { child.once('exit', r); setTimeout(r, 3000); });
  }
}

// ---------------------------------------------------------------------------
// Direct database access (reset, timestamps, failed deliveries)
// ---------------------------------------------------------------------------
const sqlite3 = require(require.resolve('sqlite3', { paths: [path.join(ROOT, 'shared/backend')] }));
function openDb() {
  const db = new sqlite3.Database(DB_PATH);
  const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));
  const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function done(e) { return e ? rej(e) : res(this); }));
  const close = () => new Promise((res) => db.close(() => res()));
  return { all, run, close };
}

async function resetSampleDb() {
  if (!fs.existsSync(DB_PATH)) return;
  const db = openDb();
  let files = [];
  try { files = await db.all('SELECT filename FROM uploaded_files'); } catch { /* no table yet */ }
  await db.close();
  for (const { filename } of files) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(filename))); } catch { /* already gone */ }
  }
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) { try { fs.unlinkSync(f); } catch { /* none */ } }
  console.log(`Reset: removed ${path.relative(ROOT, DB_PATH)} and ${files.length} uploaded files.`);
}

// Real time -> planned time. Every action records when it started (real) and when it should have
// happened (planned); a timestamp written during the action moves to the planned time plus the few
// seconds it took.
const timeline = [];
const mark = (planned) => timeline.push({ real: Date.now(), planned });
const TS_RE = /(\d{4}-\d{2}-\d{2})([T ])(\d{2}:\d{2}:\d{2})(\.\d{1,6})?(Z?)/g;
function shift(ms) {
  let lo = 0; let hi = timeline.length - 1; let found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (timeline[mid].real <= ms) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  if (found < 0) return null;
  return Math.round(timeline[found].planned + (ms - timeline[found].real));
}
function shiftText(text) {
  return text.replace(TS_RE, (whole, d, sep, t, frac, z) => {
    if (sep === 'T' && !z) return whole; // a local time without a zone: not one of ours
    const ms = Date.parse(`${d}T${t}${frac ? frac.slice(0, 4) : ''}Z`);
    if (Number.isNaN(ms) || ms < timeline[0].real) return whole;
    const moved = shift(ms);
    if (moved === null) return whole;
    const iso = new Date(moved).toISOString();
    return sep === 'T' ? (frac ? iso : iso.replace(/\.\d{3}/, '')) : iso.slice(0, 19).replace('T', ' ');
  });
}
async function backdate() {
  const db = openDb();
  const tables = (await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).map((r) => r.name);
  let changed = 0;
  await db.run('BEGIN');
  for (const table of tables) {
    const cols = (await db.all(`PRAGMA table_info("${table}")`)).filter((c) => !c.type || /TEXT|CHAR|CLOB/i.test(c.type)).map((c) => c.name);
    if (cols.length === 0) continue;
    const rows = await db.all(`SELECT rowid AS _rid, ${cols.map((c) => `"${c}"`).join(', ')} FROM "${table}"`);
    for (const row of rows) {
      const sets = {};
      for (const c of cols) {
        if (typeof row[c] !== 'string') continue;
        const moved = shiftText(row[c]);
        if (moved !== row[c]) sets[c] = moved;
      }
      const keys = Object.keys(sets);
      if (keys.length === 0) continue;
      await db.run(`UPDATE "${table}" SET ${keys.map((k) => `"${k}" = ?`).join(', ')} WHERE rowid = ?`, [...keys.map((k) => sets[k]), row._rid]);
      changed += 1;
    }
  }
  await db.run('COMMIT');
  await db.close();
  return changed;
}

async function failSomeDeliveries(appIds) {
  const db = openDb();
  for (const id of appIds) {
    await db.run(
      `UPDATE notification_deliveries SET status = 'failed', providerId = NULL, attempts = 1,
         error = 'Sample data: the SMS provider did not respond'
       WHERE id = (SELECT id FROM notification_deliveries WHERE applicationId = ? AND channel = 'sms' ORDER BY createdAt DESC LIMIT 1)`,
      [id]
    );
  }
  await db.run('PRAGMA wal_checkpoint(TRUNCATE)');
  await db.close();
}

// ---------------------------------------------------------------------------
// Running a case
// ---------------------------------------------------------------------------
async function runCase(c, ctx) {
  const { docs, staff, terms } = ctx;
  const docPick = (kind) => docs[kind][c.index % docs[kind].length];
  const state = { token: null, appId: null, uploads: {}, step1Fixed: {} };
  const uploadKind = async (kind) => { state.uploads[kind] = await upload(docPick(kind), state.token); return state.uploads[kind]; };

  // Registration, at the planned creation time.
  mark(c.createdAt);
  const registration = { disclaimerAccepted: true, locationGranted: true };
  let res;
  if (c.auth === 'google') {
    res = await borrower('POST', '/flow/google', { demo: { email: c.email, name: c.accountName }, language: c.lang, registration });
    state.token = res.token;
    if (c.googlePhone) {
      const otp = await borrower('POST', '/users/request-otp', { phoneNumber: c.phone, language: c.lang });
      res = await borrower('POST', '/flow/account/contact', { phoneNumber: c.phone, code: otp.demoCode }, state.token);
      state.token = res.token || state.token;
    }
  } else {
    const otp = await borrower('POST', '/users/request-otp', { phoneNumber: c.phone, language: c.lang });
    res = await borrower('POST', '/flow/register', {
      fullName: c.accountName, email: c.email, password: 'SamplePassword123!', phoneNumber: c.phone,
      code: otp.demoCode, language: c.lang, registration,
    });
    state.token = res.token;
  }
  state.appId = res.application.id;
  const requestNumber = res.application.requestNumber;

  const step1Data = async (missing = []) => {
    for (const kind of ['passport', 'visa', 'payslip']) if (!missing.includes(kind) && !state.uploads[kind]) await uploadKind(kind);
    return {
      personal: { ...c.personal, legalNameConfirmed: c.accountName !== c.fullName },
      documents: Object.fromEntries(['passport', 'visa', 'payslip'].map((k) => [k, missing.includes(k) ? null : state.uploads[k]])),
      employment: { ...c.employment, monthlySalaryNis: c.personal.monthlySalaryNis },
      loan: { requestedAmountNis: c.loan.requestedAmountNis },
    };
  };
  let step2Fixed = false;
  const step2Data = (sponsorCount) => {
    const loan = { ...c.loan };
    let sponsors = c.sponsors.slice(0, sponsorCount === undefined ? c.sponsors.length : sponsorCount);
    if (step2Fixed === 'amount') { loan.requestedAmountNis = Math.max(500, loan.requestedAmountNis - 3000); loan.repaymentPeriodMonths = 9; }
    if (step2Fixed !== 'sponsor' && c.actions.some((a) => a.fix === 'sponsor')) sponsors = sponsors.map((s, i) => (i === 0 ? { ...s, fullName: s.fullName.split(' ')[0] } : s));
    return { loan, sponsors };
  };

  for (let i = 0; i < c.actions.length; i++) {
    const a = c.actions[i];
    mark(c.times[i]);
    switch (a.type) {
      case 'draft1': {
        const data = await step1Data(a.missing);
        if (a.noEmployer) data.employment = { employerName: '', companyName: '', manpowerAgent: '' };
        await borrower('PUT', '/flow/application/steps/1/draft', { data }, state.token);
        break;
      }
      case 'submit1': {
        if (a.fix) await uploadKind(a.fix); // a new, clear copy of the document staff asked for
        const data = await step1Data();
        // The name-mismatch case: the first submission used the account name, the fix uses the passport name.
        const mismatchFirst = c.actions.some((x) => x.nameCorrection) && !a.nameCorrection;
        if (mismatchFirst) { data.personal.fullName = c.accountName; data.personal.legalNameConfirmed = false; }
        await borrower('POST', '/flow/application/steps/1/submit', { data }, state.token);
        break;
      }
      case 'draft2':
        await borrower('PUT', '/flow/application/steps/2/draft', { data: step2Data(a.sponsors) }, state.token);
        break;
      case 'submit2':
        if (a.fix) step2Fixed = a.fix;
        await borrower('POST', '/flow/application/steps/2/submit', { data: step2Data() }, state.token);
        break;
      case 'draft3':
        await borrower('PUT', '/flow/application/steps/3/draft', { data: { bank: a.withBank ? c.bank : {}, bankDocument: null } }, state.token);
        break;
      case 'submit3': {
        const bankDocument = await uploadKind('bank');
        await borrower('POST', '/flow/application/steps/3/submit', {
          data: {
            bank: c.bank,
            bankDocument,
            terms: { generalVersion: terms.general.version, serviceFeeVersion: terms.service_fee.version, generalAccepted: true, serviceFeeAccepted: true },
            signature: { signatureMethod: 'typed_name', signatureValue: c.fullName },
          },
        }, state.token);
        break;
      }
      case 'decide':
        await admin('POST', `/flow/applications/${state.appId}/steps/${a.step}/decision`, { decision: a.decision, note: a.note || '' }, staff[a.role]);
        break;
      case 'final':
        await admin('POST', `/flow/applications/${state.appId}/final-decision`, { status: a.status, reason: a.reason || '', missingNote: a.missingNote || '' }, staff[a.role]);
        break;
      case 'finalDocs': {
        const doc = await uploadKind(a.doc);
        await borrower('POST', '/flow/application/final-documents', { documents: [doc] }, state.token);
        break;
      }
      case 'message':
        await admin('POST', `/flow/applications/${state.appId}/message`, { message: a.text }, staff[a.role]);
        break;
      case 'reveal':
        await admin('GET', `/flow/applications/${state.appId}?revealBank=1`, null, staff[a.role]);
        break;
      default:
        throw new Error(`Unknown action ${a.type}`);
    }
    // Notifications are sent after the response; let them land inside this action's time slot.
    await sleep(60);
  }

  const detail = await admin('GET', `/flow/applications/${state.appId}`, null, staff.credit_reviewer);
  const app = detail.application;
  if (app.flowStatus !== c.expect) throw new Error(`expected ${c.expect}, got ${app.flowStatus}`);
  if (c.finalStatus && app.status !== c.finalStatus) throw new Error(`expected final status ${c.finalStatus}, got ${app.status}`);
  return { appId: state.appId, requestNumber, flowStatus: app.flowStatus, status: app.status };
}

// ---------------------------------------------------------------------------
async function main() {
  if (path.resolve(DB_PATH) === path.resolve(ROOT, 'data/database.sqlite')) {
    throw new Error('Refusing to write to data/database.sqlite: the integration tests and their records use it. Pick another --db.');
  }
  if (args.reset) await resetSampleDb();
  else if (fs.existsSync(DB_PATH)) throw new Error(`${path.relative(ROOT, DB_PATH)} already exists. Run with --reset to rebuild it.`);
  if (PLAN.length !== 100) throw new Error(`The plan has ${PLAN.length} cases, expected 100`);

  const docs = loadDocuments();
  console.log(`Documents: ${Object.entries(docs).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  const cases = PLAN.map(buildCase).sort((x, y) => x.createdAt - y.createdAt);

  console.log(`Starting the APIs on ports ${BORROWER_PORT}/${ADMIN_PORT} with ${path.relative(ROOT, DB_PATH)}...`);
  await startApi('borrower', path.join(ROOT, 'borrower-app/backend/server.js'), BORROWER_PORT, { BORROWER_PORT: String(BORROWER_PORT) });
  await runNode(path.join(ROOT, 'admin-app/backend/scripts/seed_staff.js'), { DB_INIT: 'false' });
  await startApi('admin', path.join(ROOT, 'admin-app/backend/server.js'), ADMIN_PORT, { ADMIN_PORT: String(ADMIN_PORT), DB_INIT: 'false' });

  const staff = {};
  for (const [role, s] of Object.entries(STAFF)) staff[role] = (await admin('POST', '/auth/staff-login', { email: s.email, password: s.password })).token;
  const terms = (await borrower('GET', '/flow/terms/current', null, null)).terms;
  await admin('PUT', '/config/service-fee', { serviceFeeNis: OLD_FEE }, staff.system_admin);

  const results = [];
  const failSms = [];
  let fee = OLD_FEE;
  for (const c of cases) {
    if (c.fee !== fee) {
      mark(FEE_CHANGED_AT);
      await admin('PUT', '/config/service-fee', { serviceFeeNis: c.fee }, staff.system_admin);
      fee = c.fee;
    }
    try {
      const r = await runCase(c, { docs, staff, terms });
      results.push({ ...r, c });
      if (c.failSms) failSms.push(r.appId);
      console.log(`[${String(results.length).padStart(3)}/100] ${String(r.requestNumber).padEnd(14)} ${r.flowStatus.padEnd(24)} ${String(r.status || '').padEnd(29)} ${c.category}`);
    } catch (err) {
      throw new Error(`Case "${c.category}" (#${c.index + 1}) failed: ${err.message}`);
    }
  }

  await stopApis();
  console.log('Moving the timestamps into the last six months...');
  const changed = await backdate();
  await failSomeDeliveries(failSms);

  const byStatus = {};
  for (const r of results) byStatus[r.flowStatus] = (byStatus[r.flowStatus] || 0) + 1;
  console.log(`\nDone: 100 applications in ${path.relative(ROOT, DB_PATH)} (${changed} rows backdated, ${failSms.length} SMS deliveries marked failed).`);
  for (const [s, n] of Object.entries(byStatus)) console.log(`  ${s.padEnd(26)} ${n}`);
  console.log('\nTo open it in the app, start both APIs with DB_PATH set (PowerShell):');
  console.log(`  $env:DB_PATH='${DB_PATH}'; npm run start:borrower`);
  console.log(`  $env:DB_PATH='${DB_PATH}'; npm run start:admin`);
  console.log('Applicants sign in with their email and the password SamplePassword123! (Google ones through the demo Google button).');
}

main().catch(async (err) => {
  console.error(`\n${err.message}`);
  await stopApis();
  process.exit(1);
});
