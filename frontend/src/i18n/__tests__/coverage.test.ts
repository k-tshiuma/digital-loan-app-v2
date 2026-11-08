import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { TRANSLATIONS } from '@quickloan/ui-core/i18n/translations';
import {
  RISK_FLAG_CODES,
  docTypeLabel,
  optionLabel,
  qualityLabel,
  riskFlagLabel,
  riskLevelLabel,
  roleLabel,
  statusLabel,
} from '@quickloan/ui-core/i18n/options';
import {
  COUNTRY_PHONE_CODES,
  DOCUMENT_TYPE_CONFIG,
  GUARANTOR_RELATIONSHIPS,
  LOAN_PURPOSE_OPTIONS,
  MARITAL_STATUSES,
  ORIGIN_COUNTRIES,
  REPAYMENT_SOURCE_OPTIONS,
  SALARY_PAYMENT_METHODS,
  VISA_TYPES,
} from '@quickloan/ui-core/config/appConfig';

const SRC = path.resolve(__dirname, '../..');
const SHARED = path.resolve(SRC, '../../shared/frontend');
const BACKEND = path.resolve(SRC, '../../backend');
const HEBREW = /[֐-׿]/;

const has = (key: string) => !!TRANSLATIONS.en[key] && !!TRANSLATIONS.he[key];

describe('Every t() key used in the code exists in English and Hebrew', () => {
  it('no component or App references a missing key', () => {
    // App.tsx, the app's components and the shared components (shared/frontend).
    const files = [
      path.join(SRC, 'App.tsx'),
      ...[SRC, SHARED].flatMap((dir) =>
        fs
          .readdirSync(path.join(dir, 'components'))
          .filter((f) => f.endsWith('.tsx'))
          .map((f) => path.join(dir, 'components', f))
      ),
    ];
    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      // t(language, 'key') / t(currentLanguage, "key") / t(this.props.language || 'en', 'key')
      for (const m of src.matchAll(/\bt\([^,()]+(?:\|\|\s*'en')?,\s*['"]([^'"]+)['"]/g)) {
        checked++;
        if (!has(m[1])) missing.push(`${path.basename(file)}: ${m[1]}`);
      }
    }
    expect(checked).toBeGreaterThan(500); // guards against the pattern silently matching nothing
    expect([...new Set(missing)]).toEqual([]);
  });
});

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

describe('Risk flags (T3.6)', () => {
  const engine = fs.readFileSync(path.join(BACKEND, 'creditEngine.js'), 'utf8');

  it('the frontend code list matches what the credit engine can emit', () => {
    const pushed = [...engine.matchAll(/flags\.push\(['`](\w+):/g)].map((m) => m[1]);
    const exported = /RISK_FLAG_CODES = \[([^\]]+)\]/.exec(engine)?.[1].match(/\w+/g) ?? [];
    expect([...new Set(pushed)].sort()).toEqual([...RISK_FLAG_CODES].sort());
    expect([...exported].sort()).toEqual([...RISK_FLAG_CODES].sort());
  });

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

describe('Eligibility factor descriptions', () => {
  for (const file of [
    path.join(SHARED, 'services/eligibilityScoring.ts'),
    path.join(BACKEND, 'services/eligibilityScoring.js'),
  ]) {
    it(`${path.basename(path.dirname(path.dirname(file)))}/${path.basename(file)} only uses keys that exist`, () => {
      const src = fs.readFileSync(file, 'utf8');
      const keys = [...src.matchAll(/'(elig\.[\w.]+)'/g)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThanOrEqual(18);
      expect(keys.filter((k) => !has(k))).toEqual([]);
    });
  }
});
