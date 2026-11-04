import { ApplicationConfig, DocumentTypeInfo, CanonicalStatus } from '../types';

export const SUPPORT_CONFIG = {
  phoneNumber: '+972-3-555-0199',
  displayPhone: '03-555-0199',
  email: 'support@quickloan.co.il',
};

export const DEFAULT_APP_CONFIG: ApplicationConfig = {
  minLoanAmountNis: 500,
  maxLoanAmountNis: 10000,
  amountIncrementNis: 500,
  allowedRepaymentPeriodsMonths: [3, 6, 9],
  eligibleRepaymentSources: [
    'Bank transfer',
    'Salary deduction',
    'Cash',
    'Digital wallet',
    'Credit card',
  ],
  defaultInterestRatePercent: 8.5, // 8.5% default APR
  processingFeePercent: 1.0,
  managementFeeNis: 80,
  otpExpirationSeconds: 300,
  maxFileSizeBytes: 10 * 1024 * 1024,
  minBorrowerAge: 21,
  minVisaValidityMonths: 6,
};

export const ORIGIN_COUNTRIES = [
  'Thailand',
  'Philippines',
  'China',
  'India',
  'Nepal',
  'Vietnam',
  'Sri Lanka',
  'Moldova',
  'Ukraine',
  'Romania',
  'Other',
];

export const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Other'];

export const SALARY_PAYMENT_METHODS = ['Bank Transfer', 'Cash', 'Check', 'Other'];

export const LOAN_PURPOSE_OPTIONS = ['Cash Flow', 'Equipment', 'Investment', 'Other'];

export const REPAYMENT_SOURCE_OPTIONS = [
  'Bank Transfer',
  'Salary Deduction',
  'Cash',
  'Digital Wallet',
  'Credit Card',
];

export const GUARANTOR_RELATIONSHIPS = [
  'Co-worker',
  'Friend',
  'Relative',
  'Family Member',
  'Employer',
  'Community Member',
  'Other',
];

export const LOAN_PERIOD_OPTIONS = [
  { months: 3, label: '3 Mos' },
  { months: 6, label: '6 Mos' },
  { months: 9, label: '9 Mos' },
];

export const MAX_REPAYMENT_PERIOD_MONTHS = 9;

export interface ServiceFeeTier {
  minAmount: number;
  maxAmount: number;
  feeNis: number;
}

/**
 * Service fee table mapping loan amount ranges to a fixed fee.
 */
export const SERVICE_FEE_TIERS: ServiceFeeTier[] = [
  { minAmount: 500, maxAmount: 2000, feeNis: 120 },
  { minAmount: 2001, maxAmount: 4000, feeNis: 220 },
  { minAmount: 4001, maxAmount: 7000, feeNis: 350 },
  { minAmount: 7001, maxAmount: 10000, feeNis: 480 },
];

export function getServiceFeeForAmount(
  amount: number,
  tiers: ServiceFeeTier[] = SERVICE_FEE_TIERS
): number {
  if (amount <= 0) return 0;
  const match = tiers.find((t) => amount >= t.minAmount && amount <= t.maxAmount);
  if (match) return match.feeNis;
  if (amount < (tiers[0]?.minAmount ?? 500)) return tiers[0]?.feeNis ?? 120;
  return tiers[tiers.length - 1]?.feeNis ?? 480;
}

export const VISA_TYPES = [
  { code: 'b1_agri', id: 'b1_agri', label: 'B-1 Work Visa (Agriculture / חקלאות)' },
  { code: 'b1_care', id: 'b1_care', label: 'B-1 Work Visa (Caregiving / סיעוד)' },
  { code: 'b1_const', id: 'b1_const', label: 'B-1 Work Visa (Construction / בניין)' },
  { code: 'b1_rest', id: 'b1_rest', label: 'B-1 Work Visa (Ethnic Cook / מסעדנות)' },
  { code: 'b1_expert', id: 'b1_expert', label: 'B-1 Work Visa (Foreign Expert / מומחה זר)' },
  { code: 'b1_hotel', id: 'b1_hotel', label: 'B-1 Work Visa (Hotel Services / מלונאות)' },
  { code: 'other_permit', id: 'other_permit', label: 'Other Valid Work Permit / אשרת עבודה אחרת' },
];

export const COUNTRY_PHONE_CODES = [
  { code: '+972', country: 'Israel', flag: '🇮🇱' },
  { code: '+63', country: 'Philippines', flag: '🇵🇭' },
  { code: '+66', country: 'Thailand', flag: '🇹🇭' },
  { code: '+86', country: 'China', flag: '🇨🇳' },
  { code: '+91', country: 'India', flag: '🇮🇳' },
  { code: '+977', country: 'Nepal', flag: '🇳🇵' },
  { code: '+84', country: 'Vietnam', flag: '🇻🇳' },
  { code: '+94', country: 'Sri Lanka', flag: '🇱🇰' },
  { code: '+373', country: 'Moldova', flag: '🇲🇩' },
  { code: '+380', country: 'Ukraine', flag: '🇺🇦' },
  { code: '+1', country: 'USA/Canada', flag: '🇺🇸' },
];

export interface IsraeliBank {
  code: string;
  name: string;
  hebrewName: string;
}

export const ISRAELI_BANKS: IsraeliBank[] = [
  { code: '12', name: 'Bank Hapoalim', hebrewName: 'בנק הפועלים' },
  { code: '10', name: 'Bank Leumi', hebrewName: 'בנק לאומי' },
  { code: '11', name: 'Israel Discount Bank', hebrewName: 'בנק דיסקונט' },
  { code: '20', name: 'Mizrahi Tefahot Bank', hebrewName: 'בנק מזרחי טפחות' },
  { code: '31', name: 'First International Bank of Israel (FIBI)', hebrewName: 'הבנק הבינלאומי' },
  { code: '54', name: 'Bank of Jerusalem', hebrewName: 'בנק ירושלים' },
  { code: '09', name: 'Postal Bank (Doar Israel)', hebrewName: 'בנק הדואר' },
  { code: '28', name: 'One Zero Digital Bank', hebrewName: 'וואן זירו' },
  { code: 'other', name: 'Other Bank in Israel', hebrewName: 'בנק אחר בישראל' },
];

export const DOCUMENT_TYPE_CONFIG: DocumentTypeInfo[] = [
  {
    code: 'PASSPORT',
    id: 'doc_passport',
    name: 'Passport Photo Page',
    isRequired: true,
    allowsMultiple: false,
    titleKey: 'docPassportTitle',
    descKey: 'docPassportDesc',
  },
  {
    code: 'PAY_SLIP',
    id: 'doc_pay_slip',
    name: 'Salary Pay Slips',
    isRequired: true,
    allowsMultiple: true,
    titleKey: 'docPaySlipTitle',
    descKey: 'docPaySlipDesc',
  },
  {
    code: 'BANK_ACCOUNT_DOCUMENT',
    id: 'doc_bank_account',
    name: 'Bank Account Ownership Document',
    isRequired: true,
    allowsMultiple: false,
    titleKey: 'docBankAccountTitle',
    descKey: 'docBankAccountDesc',
  },
  {
    code: 'GUARANTOR_ID',
    id: 'doc_guarantor_id',
    name: 'Guarantor Passport or ID',
    isRequired: false, // Required only when applicant provides a guarantor
    allowsMultiple: false,
    titleKey: 'docGuarantorIdTitle',
    descKey: 'docGuarantorIdDesc',
  },
  {
    code: 'WORKERS_CARD',
    id: 'doc_workers_card',
    name: "Worker's Card",
    isRequired: false,
    allowsMultiple: false,
    titleKey: 'docWorkersCardTitle',
    descKey: 'docWorkersCardDesc',
  },
];

export const STATUS_BADGE_CONFIG: Record<
  CanonicalStatus,
  { label: string; badgeColor: string; iconName: string }
> = {
  Received: {
    label: 'Received',
    badgeColor: 'bg-blue-100 text-blue-900 border-blue-200',
    iconName: 'Clock',
  },
  'Under Review': {
    label: 'Under Review',
    badgeColor: 'bg-purple-100 text-purple-900 border-purple-200',
    iconName: 'FileSearch',
  },
  'Additional Document Required': {
    label: 'Additional Document Required',
    badgeColor: 'bg-amber-100 text-amber-900 border-amber-300 animate-pulse',
    iconName: 'AlertTriangle',
  },
  Approved: {
    label: 'Approved',
    badgeColor: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    iconName: 'CheckCircle2',
  },
  Rejected: {
    label: 'Rejected',
    badgeColor: 'bg-red-100 text-red-900 border-red-300',
    iconName: 'XCircle',
  },
  'Forwarded to Funding Entity': {
    label: 'Forwarded to Funding Entity',
    badgeColor: 'bg-indigo-100 text-indigo-900 border-indigo-300',
    iconName: 'Send',
  },
};

/**
 * Calculates live monthly estimated loan repayment.
 */
export function calculateLoanRepayment(
  principalAmount: number,
  periodMonths: number,
  config: ApplicationConfig = DEFAULT_APP_CONFIG
): {
  baseMonthlyRepaymentNis: number;
  serviceFeeNis: number;
  monthlyServiceFeeNis: number;
  monthlyPaymentNis: number;
  totalRepaymentNis: number;
  totalInterestNis: number;
  managementFeeNis: number;
  interestRatePercent: number;
} {
  if (principalAmount <= 0 || periodMonths <= 0) {
    return {
      baseMonthlyRepaymentNis: 0,
      serviceFeeNis: 0,
      monthlyServiceFeeNis: 0,
      monthlyPaymentNis: 0,
      totalRepaymentNis: 0,
      totalInterestNis: 0,
      managementFeeNis: 0,
      interestRatePercent: config.defaultInterestRatePercent,
    };
  }

  const monthlyRate = config.defaultInterestRatePercent / 100 / 12;
  const factor = Math.pow(1 + monthlyRate, periodMonths);
  const baseMonthlyRepaymentNis = Math.round(
    (principalAmount * (monthlyRate * factor)) / (factor - 1)
  );

  const serviceFeeNis = getServiceFeeForAmount(principalAmount);
  const monthlyServiceFeeNis = Math.round(serviceFeeNis / periodMonths);
  const monthlyPaymentNis = baseMonthlyRepaymentNis + monthlyServiceFeeNis;
  const totalRepaymentNis = monthlyPaymentNis * periodMonths;
  const totalInterestNis = totalRepaymentNis - principalAmount - serviceFeeNis;

  return {
    baseMonthlyRepaymentNis,
    serviceFeeNis,
    monthlyServiceFeeNis,
    monthlyPaymentNis,
    totalRepaymentNis,
    totalInterestNis,
    managementFeeNis: serviceFeeNis,
    interestRatePercent: config.defaultInterestRatePercent,
  };
}

/**
 * Calculates exact age from Date of Birth string (YYYY-MM-DD)
 */
export function calculateAge(dobString: string): number {
  if (!dobString) return 0;
  const dob = new Date(dobString);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/**
 * Calculates years of residency from date of entry (YYYY-MM-DD)
 */
export function calculateYearsOfResidency(entryDateString: string): number {
  if (!entryDateString) return 0;
  const entry = new Date(entryDateString);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - entry.getTime());
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  const years = diffDays / 365.25;
  return Math.max(0, Math.round(years * 10) / 10);
}

/**
 * Checks if a visa expiry date has expired or expires within 6 months
 */
export function isVisaValidForLoan(
  visaExpiryDateString: string,
  minMonthsRemaining = 6
): {
  valid: boolean;
  reason?: string;
  /** Translation key for `reason`, with `reasonParams` placeholders. */
  reasonKey?: string;
  reasonParams?: Record<string, string | number>;
  monthsRemaining?: number;
} {
  if (!visaExpiryDateString) {
    return { valid: false, reason: 'Visa expiry date is required.', reasonKey: 'visa.err.required' };
  }

  const expiry = new Date(visaExpiryDateString);
  const now = new Date();

  if (isNaN(expiry.getTime())) {
    return { valid: false, reason: 'Invalid date format', reasonKey: 'visa.err.invalidDate' };
  }

  const diffDays = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  const monthsRemaining = Math.round((diffDays / 30.44) * 10) / 10;

  if (diffDays <= 0) {
    return { valid: false, reason: 'Visa has already expired.', reasonKey: 'visa.err.expired', monthsRemaining: 0 };
  }

  if (monthsRemaining < minMonthsRemaining) {
    return {
      valid: false,
      reason: `Visa must have at least ${minMonthsRemaining} months of validity remaining (currently ${monthsRemaining.toFixed(1)} months).`,
      reasonKey: 'visa.err.tooShort',
      reasonParams: { min: minMonthsRemaining, current: monthsRemaining.toFixed(1) },
      monthsRemaining,
    };
  }

  return { valid: true, monthsRemaining };
}

/**
 * Calculates tenure in months from an employment start date (YYYY-MM-DD)
 */
export function calculateJobTenureMonths(startDateString: string): number {
  if (!startDateString) return 0;
  const start = new Date(startDateString);
  const now = new Date();
  if (isNaN(start.getTime())) return 0;
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) {
    months--;
  }
  return Math.max(0, months);
}
