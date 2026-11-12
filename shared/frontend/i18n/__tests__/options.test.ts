// Labels for stored values (dropdowns, statuses, roles, risk flags, quality, documents) in English and Hebrew.
import { describe, it, expect } from 'vitest';
import { TRANSLATIONS } from '../../i18n/translations';
import {
  RISK_FLAG_CODES,
  docTypeLabel,
  optionLabel,
  qualityLabel,
  riskFlagLabel,
  riskLevelLabel,
  roleLabel,
  statusLabel,
  step1VisaTypeLabel,
} from '../../i18n/options';
import {
  COUNTRY_PHONE_CODES,
  DOCUMENT_TYPE_CONFIG,
  GUARANTOR_RELATIONSHIPS,
  LOAN_PURPOSE_OPTIONS,
  MARITAL_STATUSES,
  ORIGIN_COUNTRIES,
  REPAYMENT_SOURCE_OPTIONS,
  SALARY_PAYMENT_METHODS,
  STEP1_VISA_TYPES,
  VISA_TYPES,
} from '../../config/appConfig';

const HEBREW = /[֐-׿]/;

const has = (key: string) => !!TRANSLATIONS.en[key] && !!TRANSLATIONS.he[key];

describe('Dropdown values have English and Hebrew labels', () => {
  const groups: Array<[Parameters<typeof optionLabel>[1], string[]]> = [
    ['country', [...ORIGIN_COUNTRIES, ...COUNTRY_PHONE_CODES.map((c) => c.country)]],
    ['marital', MARITAL_STATUSES],
    ['salaryMethod', SALARY_PAYMENT_METHODS],
    ['loanPurpose', LOAN_PURPOSE_OPTIONS],
    ['repaymentSource', REPAYMENT_SOURCE_OPTIONS],
    ['relationship', GUARANTOR_RELATIONSHIPS],
    ['visa', VISA_TYPES.map((v) => v.code)],
  ];

  for (const [group, values] of groups) {
    it(`${group}: every value is translated`, () => {
      const untranslated = values.filter((v) => !HEBREW.test(optionLabel('he', group, v)));
      expect(untranslated).toEqual([]);
    });
  }

  it('matches values regardless of case ("Bank transfer" vs "Bank Transfer")', () => {
    expect(optionLabel('he', 'repaymentSource', 'Bank transfer')).toBe(optionLabel('he', 'repaymentSource', 'Bank Transfer'));
  });

  it('shows unknown values unchanged', () => {
    expect(optionLabel('he', 'country', 'Atlantis')).toBe('Atlantis');
  });

  it('statuses, roles, risk levels, quality states and document types are translated', () => {
    const checks = [
      ...['Received', 'Under Review', 'Additional Document Required', 'Approved', 'Rejected', 'Forwarded to Funding Entity'].map(
        (s) => statusLabel('he', s)
      ),
      ...['borrower', 'customer_service', 'credit_reviewer', 'system_admin', 'funding_entity'].map((r) => roleLabel('he', r)),
      ...['Low', 'Medium', 'High'].map((l) => riskLevelLabel('he', l)),
      ...['pending', 'passed', 'failed', 'warning', 'not_checked'].map((q) => qualityLabel('he', q)),
      ...DOCUMENT_TYPE_CONFIG.map((d) => docTypeLabel('he', d.code)),
    ];
    expect(checks.filter((c) => !HEBREW.test(c))).toEqual([]);
  });
});

describe('Step 1 visa types', () => {
  it('has eight unique ids, each with an English and Hebrew description', () => {
    expect(STEP1_VISA_TYPES).toHaveLength(8);
    expect(new Set(STEP1_VISA_TYPES.map((v) => v.id)).size).toBe(8);
    expect(STEP1_VISA_TYPES.filter((v) => !has(`opt.visaType.${v.id}`))).toEqual([]);
  });

  it('labels show the code (kept left-to-right) and the description', () => {
    expect(step1VisaTypeLabel('en', 'work')).toBe('⁦B/1⁩ – Work Visa');
    expect(step1VisaTypeLabel('en', 'foreign_expert')).toBe('⁦B/1⁩ – Foreign Expert');
    expect(step1VisaTypeLabel('he', 'conditional_release')).toBe('⁦2(a)(5)⁩ – שחרור על תנאי');
  });

  it('gives empty for no value and shows an unknown value as-is', () => {
    expect(step1VisaTypeLabel('en', '')).toBe('');
    expect(step1VisaTypeLabel('en', undefined)).toBe('');
    expect(step1VisaTypeLabel('en', 'something_else')).toBe('something_else');
  });
});

describe('Risk flags (T3.6)', () => {
  it('every code has an English and Hebrew label', () => {
    expect(RISK_FLAG_CODES.filter((c) => !has(`bo.risk.${c}`))).toEqual([]);
  });

  it('translates a stored flag and keeps its number', () => {
    expect(riskFlagLabel('he', 'TENURE_FAIL: Job tenure under 3 months')).toBe('ותק בעבודה של פחות מ-3 חודשים');
    expect(riskFlagLabel('en', 'SALARY_RATIO_WARN: Salary-to-loan ratio is marginal')).toBe('Salary-to-loan ratio is marginal');
  });

  it('shows an unknown flag unchanged', () => {
    expect(riskFlagLabel('he', 'NEW_FLAG: Something new')).toBe('NEW_FLAG: Something new');
  });
});
