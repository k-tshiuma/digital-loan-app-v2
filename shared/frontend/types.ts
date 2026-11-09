export type Language = 'en' | 'he' | 'th' | 'zh' | 'tl' | 'ar' | 'fr' | 'es';

export type CanonicalStatus =
  | 'Received'
  | 'Under Review'
  | 'Additional Document Required'
  | 'Approved'
  | 'Rejected'
  | 'Forwarded to Funding Entity';

export type UserRole =
  | 'borrower'
  | 'customer_service'
  | 'credit_reviewer'
  | 'system_admin'
  | 'funding_entity';

export type MaritalStatus = 'Single' | 'Married' | 'Divorced' | 'Other';

export type SalaryPaymentMethod = 'Bank Transfer' | 'Bank transfer' | 'Cash' | 'Check' | 'Other';

export type LoanPurpose = 'Cash Flow' | 'Cash flow' | 'Equipment' | 'Investment' | 'Other';

export type RepaymentSource =
  | 'Bank Transfer'
  | 'Bank transfer'
  | 'Salary Deduction'
  | 'Salary deduction'
  | 'Cash'
  | 'Digital Wallet'
  | 'Digital wallet'
  | 'Credit Card'
  | 'Credit card';

export type GuarantorRelationship =
  | 'Employer'
  | 'Family member'
  | 'Friend'
  | 'Co-worker'
  | 'Relative'
  | 'Community member'
  | 'Other';

export type DocumentTypeCode =
  | 'PASSPORT'
  | 'PAY_SLIP'
  | 'WORKERS_CARD'
  | 'WORK_VISA'
  | 'EMPLOYMENT_CONFIRMATION'
  | 'BANK_STATEMENT'
  | 'BANK_ACCOUNT_DOCUMENT'
  | 'GUARANTOR_ID'
  | 'CREDIT_CARD';

export interface DocumentTypeInfo {
  code: DocumentTypeCode;
  id: string;
  name: string;
  isRequired: boolean;
  allowsMultiple: boolean;
  titleKey: string;
  descKey: string;
}

export interface UploadedFile {
  id: string;
  applicationId: string;
  documentTypeCode: DocumentTypeCode;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  storageKey: string;
  /** Server path returned by POST /api/upload (e.g. /api/uploads/123_abc.jpg). Preferred over dataUrl. */
  fileUrl?: string;
  /** Legacy/offline fallback: inline base64 copy, only used when the upload server is unreachable. */
  dataUrl?: string;
  uploadSource: 'camera' | 'gallery' | 'file';
  qualityStatus: 'pending' | 'passed' | 'failed' | 'warning' | 'not_checked';
  qualityIssues?: string[];
  ocrStatus: 'pending' | 'completed' | 'failed' | 'not_requested';
  ocrExtractedData?: {
    passportNumber?: string;
    fullName?: string;
    nationality?: string;
    visaCategory?: string;
    visaExpiryDate?: string;
    maskedPan?: string;
    cardholder?: string;
    confidence?: number;
  };
  userConfirmed: boolean;
  maskedCardNumber?: string;
  uploadedAt: string;
  /** Returning-user document reuse and validity status */
  isReused?: boolean;
  reusedFromAppId?: string;
  validityStatus?: 'valid' | 'expired' | 'missing' | 'rejected' | 'needs_update';
  validityReason?: string;
  expiryDate?: string;
}

export interface BorrowerDetails {
  fullName: string;
  passportNumber: string;
  countryOfOrigin: string;
  otherCountryOfOriginDetails?: string;
  dateOfBirth: string; // YYYY-MM-DD
  mobilePhoneNumber: string;
  addressCity: string;
  addressStreet: string;
  addressFull: string;
  maritalStatus: MaritalStatus;
  otherMaritalStatusDetails?: string;
}

export interface ResidencyDetails {
  visaType: string;
  visaStartDate?: string; // YYYY-MM-DD
  visaExpiryDate: string; // YYYY-MM-DD
  dateOfEntry: string; // YYYY-MM-DD
  yearsOfResidency: number; // Derived automatically
}

export interface EmploymentDetails {
  employerName: string; // Label hint: the company owner's full name
  companyName?: string; // Replaces old "Employer's Company" field
  manpowerAgent?: string; // Free text, OPTIONAL
  staffingAgencyName?: string;
  employmentStartDate?: string; // YYYY-MM-DD
  jobTenureMonths: number;
  monthlySalaryNis: number;
  salaryCurrency?: string;
  salaryPaymentMethod: SalaryPaymentMethod;
  otherSalaryPaymentMethodDetails?: string;
}

export interface LoanRequest {
  requestedAmountNis: number;
  loanPurpose: LoanPurpose;
  otherPurposeDetails?: string;
  repaymentPeriodMonths: number;
  repaymentSource: RepaymentSource;
  serviceFeeNis?: number;
  estimatedMonthlyPaymentNis: number;
  totalRepaymentNis: number;
}

export type LoanRequestDetails = LoanRequest;

export interface GuarantorDetails {
  hasGuarantor: boolean;
  fullName?: string;
  passportOrIdNumber?: string;
  mobilePhoneNumber?: string;
  relationship?: GuarantorRelationship | string;
  otherRelationshipDetails?: string;
  passportPhoto?: UploadedFile;
}

export interface GuarantorItem {
  id: string; // e.g. 'g_1', 'g_2', 'g_3'
  fullName: string;
  passportOrIdNumber: string;
  mobilePhoneNumber: string;
  relationship: GuarantorRelationship | string;
  otherRelationshipDetails?: string;
  idDocument?: UploadedFile;
}

export interface EligibilityFactorDetail {
  awarded: number;
  max: number;
  /** English description (kept for staff views and older saved breakdowns). */
  description: string;
  /** Translation key and values for `description`. */
  descriptionKey?: string;
  descriptionParams?: Record<string, string | number>;
}

export interface EligibilityScoreBreakdown {
  rawScore: number;
  maxRawScore: number;
  percentageOfMax: number;
  segmentsFilled: number;
  identityScore: number;
  salaryScore: number;
  employmentDurationScore: number;
  visaValidityScore: number;
  guarantorsScore: number;
  factors: {
    identity: EligibilityFactorDetail;
    salary: EligibilityFactorDetail;
    employmentDuration: EligibilityFactorDetail;
    visaValidity: EligibilityFactorDetail;
    guarantors: EligibilityFactorDetail;
  };
}

export interface ConsentRecord {
  id: string;
  applicationId: string;
  consentType: 'terms_and_conditions' | 'credit_check';
  consentVersion: string;
  consentGiven: boolean;
  consentTextHash?: string;
  ipAddress?: string;
  deviceMetadata?: string;
  givenAt: string;
}

export interface DigitalSignature {
  id: string;
  applicationId: string;
  signatureMethod: 'typed_name' | 'drawn_signature' | 'drawn_touch';
  signatureValue?: string;
  signatureDataUri?: string;
  signedAt: string;
  ipAddress?: string;
  deviceMetadata?: string;
}

export interface StatusHistoryItem {
  id: string;
  applicationId: string;
  fromStatus?: CanonicalStatus | null;
  toStatus: CanonicalStatus;
  changedByType: 'borrower' | 'customer_service' | 'credit_reviewer' | 'system_admin' | 'funding_entity' | 'system';
  changedById?: string;
  changedByName?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  applicationId?: string;
  channel: 'sms' | 'push' | 'in_app';
  notificationType?: string;
  language?: Language;
  title: string;
  message: string;
  deliveryStatus?: 'pending' | 'sent' | 'delivered' | 'failed';
  providerMessageId?: string;
  attemptedAt?: string;
  deliveredAt?: string;
  createdAt: string;
  read?: boolean;
  isRead?: boolean;
}

export interface AuditEvent {
  id: string;
  actorType: string;
  actorId?: string;
  actorName?: string;
  entityType: string;
  entityId: string;
  action: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  deviceMetadata?: string;
  createdAt: string;
}

export interface OTPCode {
  id: string;
  userId: string;
  codeHash: string;
  expiresAt: string;
  attempts: number;
  consumedAt?: string;
  createdAt: string;
}

export interface ApplicationConfig {
  minLoanAmountNis: number;
  maxLoanAmountNis: number;
  amountIncrementNis: number;
  allowedRepaymentPeriodsMonths: number[];
  eligibleRepaymentSources: RepaymentSource[];
  defaultInterestRatePercent: number;
  processingFeePercent: number;
  managementFeeNis: number;
  otpExpirationSeconds: number;
  maxFileSizeBytes: number;
  minBorrowerAge: number;
  minVisaValidityMonths: number;
}

export interface BankAccountDetails {
  bankName: string;
  bankCode?: string;
  branchNumber: string;
  accountNumber: string;
  accountHolderName: string;
}

export interface LoanApplication {
  id: string;
  userId: string;
  requestNumber: string;
  isSubmitted: boolean;
  submittedAt?: string;
  status: CanonicalStatus;
  language: Language;
  currentStep: number; // 1 to 11
  borrowerDetails?: BorrowerDetails;
  residencyDetails?: ResidencyDetails;
  employmentDetails?: EmploymentDetails;
  loanRequest?: LoanRequest;
  guarantor?: GuarantorDetails;
  guarantors?: GuarantorItem[];
  documents: UploadedFile[];
  bankAccount?: BankAccountDetails;
  bankAccountConfirmed?: boolean;
  isReturningUser?: boolean;
  detailsConfirmedAt?: string;
  consents: ConsentRecord[];
  digitalSignature?: DigitalSignature;
  statusHistory: StatusHistoryItem[];
  missingDocumentNotes?: string;
  /** Indicative loan eligibility score (0-50%). */
  eligibilityScore?: number;
  eligibilityBreakdown?: EligibilityScoreBreakdown;
  /** Advisory pre-screening result computed by the backend (staff only). */
  riskScore?: number;
  riskLevel?: RiskLevel;
  riskFlags?: string[];
  createdAt: string;
  updatedAt: string;
}

export type RiskLevel = 'Low' | 'Medium' | 'High';

export interface CreditRules {
  salaryMultiplier: number;
  salaryWarnRatio: number;
  salaryFailPenalty: number;
  salaryWarnPenalty: number;
  visaBufferMonths: number;
  visaPenalty: number;
  minTenureMonths: number;
  hardMinTenureMonths: number;
  tenureFailPenalty: number;
  tenureWarnPenalty: number;
  guarantorBonus: number;
  lowRiskMinScore: number;
  mediumRiskMinScore: number;
}

export interface AnalyticsSummary {
  totalApplications: number;
  openApplications: number;
  approvalRate: number | null;
  avgLoanAmountNis: number | null;
  totalRequestedNis: number;
  avgProcessingDays: number | null;
  byStatus: { status: string; count: number }[];
  byPurpose: { purpose: string; count: number }[];
  byRisk: { level: RiskLevel; count: number }[];
  dailySubmissions: { date: string; count: number }[];
  generatedAt: string;
}

export interface User {
  id: string;
  phoneNumber: string;
  fullName?: string;
  email?: string;
  password?: string;
  /** Returned by the API instead of the password hash. */
  hasPassword?: boolean;
  authProvider?: 'phone' | 'google' | 'password';
  phoneVerifiedAt?: string;
  preferredLanguage: Language;
  roles: UserRole[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FundingIntegrationRecord {
  id: string;
  applicationId: string;
  providerCode: string;
  operation: 'submit_application' | 'send_document' | 'status_update';
  externalReference?: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  attemptCount: number;
  requestMetadata?: Record<string, unknown>;
  responseMetadata?: Record<string, unknown>;
  errorMessage?: string;
  lastAttemptAt?: string;
  completedAt?: string;
  createdAt: string;
}

// ----------------------------------------------------
// 3-Step Approval Workflow Types
// ----------------------------------------------------

export type FlowStatus =
  | 'LEAD_REGISTERED'
  | 'PENDING_STEP1_APPROVAL'
  | 'STEP1_CHANGES_REQUESTED'
  | 'STEP1_APPROVED'
  | 'PENDING_STEP2_APPROVAL'
  | 'STEP2_CHANGES_REQUESTED'
  | 'STEP2_APPROVED'
  | 'PENDING_FINAL_PROCESSING'
  | 'LOAN_APPROVED'
  | 'LOAN_REJECTED';

export type FlowStatusGroup =
  | 'in_progress'
  | 'pending'
  | 'approved_stage'
  | 'completed'
  | 'approved_final'
  | 'rejected';

export type StepVisualState =
  | 'locked'
  | 'available'
  | 'draft'
  | 'changes_requested'
  | 'pending'
  | 'approved'
  | 'submitted'
  | 'rejected';

export interface SimplifiedSponsor {
  id: string;
  fullName: string;
  idOrPassportNumber: string;
}

export interface UploadedDocRef {
  filename: string;
  fileUrl: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedAt?: string;
}

/** Consent given before an account is created (or before Step 1 for an account that signed in elsewhere). */
export interface RegistrationConsent {
  disclaimerAccepted: boolean;
  locationGranted: boolean;
  location?: { latitude: number; longitude: number; accuracy?: number } | null;
}

export interface Step1FormData {
  personal: {
    fullName: string;
    /** Set by the applicant to confirm a name different from the account name is their legal (passport) name. */
    legalNameConfirmed?: boolean;
    /** Phone and email are always taken from the account by the server. */
    phoneNumber: string;
    email?: string;
    dateOfBirth: string;
    address: string;
    passportNumber?: string;
    countryOfOrigin?: string;
    visaStartDate?: string;
    visaExpiryDate?: string;
    monthlySalaryNis?: number;
    salaryCurrency?: string;
    nameCorrection?: { previousName: string; correctedName: string; confirmedAt: string } | null;
  };
  documents: {
    passport: UploadedDocRef | null;
    visa: UploadedDocRef | null;
    payslip: UploadedDocRef | null;
  };
  employment: {
    employerName: string;
    companyName: string;
    manpowerAgent?: string;
    monthlySalaryNis?: number;
    salaryCurrency?: string;
  };
  loan: {
    requestedAmountNis: number;
  };
  registration?: {
    disclaimerAcceptedAt?: string;
    disclaimerVersion?: string;
    locationRequested?: boolean;
    locationGranted?: boolean;
    location?: { latitude: number; longitude: number; accuracyM: number | null } | null;
  };
}

export interface Step2FormData {
  loan: {
    requestedAmountNis: number;
    repaymentPeriodMonths: number;
  };
  sponsors: SimplifiedSponsor[];
}

export interface Step3FormData {
  bank: {
    bankName: string;
    bankCode?: string;
    branchNumber: string;
    accountNumber: string;
    accountHolderName: string;
  };
  bankDocument: UploadedDocRef | null;
  terms: {
    generalVersion: string;
    serviceFeeVersion: string;
    generalAccepted: boolean;
    serviceFeeAccepted: boolean;
  };
}

export interface LoanBreakdown {
  requestedAmountNis: number;
  repaymentPeriodMonths: number;
  interestRatePercent: number;
  totalInterestNis: number;
  totalServiceFeeNis: number;
  monthlyLoanRepaymentNis: number;
  monthlyServiceFeeNis: number;
  totalLoanRepaymentNis: number;
  monthlyPaymentTotalNis: number;
  overallTotalNis: number;
  calculatedAt?: string;
}

export interface StepStateSummary<T = any> {
  state: StepVisualState;
  submittedAt: string | null;
  data: T | null;
  review?: {
    decision: 'approve' | 'reject' | 'request_changes';
    note?: string;
    decidedAt: string;
    revision: number;
  } | null;
}

export interface FlowApplicationView {
  id: string;
  requestNumber: string;
  flowStatus: FlowStatus;
  group: FlowStatusGroup;
  unlockedStep: number;
  stepStates: Record<1 | 2 | 3, StepVisualState>;
  nextAction: { step: number } | null;
  isCompleted: boolean;
  completedAt: string | null;
  status: CanonicalStatus;
  rejection: { atStep: string | null; reason: string | null } | null;
  staffMessage: { text: string; at: string; byRole: string; step: number } | null;
  needsRegistrationConsent: boolean;
  steps: {
    1: StepStateSummary<Step1FormData>;
    2: StepStateSummary<Step2FormData>;
    3: StepStateSummary<Step3FormData>;
  };
  loanBreakdown: LoanBreakdown | null;
  language: Language;
  leadSource: 'google' | 'manual' | null;
  account: {
    email: string | null;
    phoneNumber: string | null;
    fullName: string | null;
    authProvider: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TermsVersionRecord {
  type: 'general' | 'service_fee';
  version: string;
  textEn: string;
  textHe: string;
  sha256: string;
  effectiveFrom: string;
}

// ----------------------------------------------------
// Lead & Application Completion Types (Modular Intermediary Architecture)
// ----------------------------------------------------

export type LeadStatus = 'pending' | 'approved' | 'rejected';

export interface FileAttachment {
  name: string;
  size?: number;
  type?: string;
  dataUrl?: string;
}

export interface LeadData {
  id: string;
  email: string;
  password?: string;
  fullName: string;
  phoneNumber: string;
  dateOfBirth: string;
  address: string;
  passportDoc?: FileAttachment | UploadedFile | null;
  visaDoc?: FileAttachment | UploadedFile | null;
  payslipDoc?: FileAttachment | UploadedFile | null;
  employerName: string; // company owner's full name
  companyName: string; // company name
  manpowerAgent?: string; // free text, OPTIONAL
  requestedLoanAmountNis: number;
  repaymentPeriodMonths: number;
  serviceFeeNis: number;
  displayedMonthlyPaymentNis: number;
  status: LeadStatus;
  createdAt: string;
}

export type SponsorType = 'israeli' | 'foreign';

export interface Sponsor {
  id: string;
  type: SponsorType;
  name: string;
  idNumber?: string; // Israeli sponsor: ID number
  passportDoc?: FileAttachment | UploadedFile | null; // Foreign sponsor: passport (image/PDF)
  visaDoc?: FileAttachment | UploadedFile | null; // Foreign sponsor: visa (image/PDF)
}

export interface Step2CompletionData {
  requestedLoanAmountNis?: number;
  repaymentPeriodMonths?: number;
  monthlyPaymentNis?: number;
  serviceFeeNis?: number;
  agreedToTerms?: boolean;
  agreedToServiceFee?: boolean;
  bankAccount: BankAccountDetails;
  sponsors: Sponsor[];
  bankAccountAuthorizationDoc?: FileAttachment | UploadedFile | null;
  submittedAt?: string;
}
