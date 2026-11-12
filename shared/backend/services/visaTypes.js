/**
 * Step 1 visa types (3-step flow): stored id -> official visa code. Mirrors STEP1_VISA_TYPES in
 * shared/frontend/config/appConfig.ts; tests/contracts/backendMirrors.test.ts checks ids, order and codes.
 * Work Visa and Foreign Expert share the code B/1, so the id is what is stored. The labels are
 * opt.visaType.<id> (frontend dictionaries and pdfLabels.js). No dependencies: the PDF uses it too.
 */
const STEP1_VISA_CODES = {
  conditional_release: '2(a)(5)',
  student: 'A/2',
  clergy: 'A/3',
  temporary_residence: 'A/5',
  work: 'B/1',
  foreign_expert: 'B/1',
  tourist: 'B/2',
  volunteer: 'B/4',
};

const STEP1_VISA_TYPES = Object.keys(STEP1_VISA_CODES);

module.exports = { STEP1_VISA_CODES, STEP1_VISA_TYPES };
