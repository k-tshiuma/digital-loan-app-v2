/**
 * The 3-step loan application workflow: statuses, allowed transitions, who may do what.
 * This module has no I/O. The routes (routes/flow.js) use it to decide every state change, so a
 * transition that is not in these tables can never happen.
 */

const FLOW_STATUS = {
  LEAD_REGISTERED: 'LEAD_REGISTERED',
  PENDING_STEP1_APPROVAL: 'PENDING_STEP1_APPROVAL',
  STEP1_CHANGES_REQUESTED: 'STEP1_CHANGES_REQUESTED',
  STEP1_APPROVED: 'STEP1_APPROVED',
  PENDING_STEP2_APPROVAL: 'PENDING_STEP2_APPROVAL',
  STEP2_CHANGES_REQUESTED: 'STEP2_CHANGES_REQUESTED',
  STEP2_APPROVED: 'STEP2_APPROVED',
  PENDING_FINAL_PROCESSING: 'PENDING_FINAL_PROCESSING',
  LOAN_APPROVED: 'LOAN_APPROVED',
  LOAN_REJECTED: 'LOAN_REJECTED',
};

const ALL_FLOW_STATUSES = Object.values(FLOW_STATUS);

/** English labels (the frontend and the messages module translate these by code). */
const FLOW_STATUS_LABEL = {
  LEAD_REGISTERED: 'Lead / Registered',
  PENDING_STEP1_APPROVAL: 'Pending Step 1 Approval',
  STEP1_CHANGES_REQUESTED: 'Step 1 – Changes Requested',
  STEP1_APPROVED: 'Step 1 Approved – Step 2 Pending',
  PENDING_STEP2_APPROVAL: 'Pending Step 2 Approval',
  STEP2_CHANGES_REQUESTED: 'Step 2 – Changes Requested',
  STEP2_APPROVED: 'Step 2 Approved – Step 3 Pending',
  PENDING_FINAL_PROCESSING: 'Final Application Submitted – Pending Final Processing',
  LOAN_APPROVED: 'Loan Approved',
  LOAN_REJECTED: 'Loan Rejected',
};

/** Groups the Back Office filters by. */
const GROUPS = ['in_progress', 'pending', 'approved_stage', 'completed', 'approved_final', 'rejected'];

const STATUS_GROUP = {
  LEAD_REGISTERED: 'in_progress',
  STEP1_CHANGES_REQUESTED: 'in_progress',
  STEP2_CHANGES_REQUESTED: 'in_progress',
  PENDING_STEP1_APPROVAL: 'pending',
  PENDING_STEP2_APPROVAL: 'pending',
  STEP1_APPROVED: 'approved_stage',
  STEP2_APPROVED: 'approved_stage',
  PENDING_FINAL_PROCESSING: 'completed',
  LOAN_APPROVED: 'approved_final',
  LOAN_REJECTED: 'rejected',
};

const groupOf = (flowStatus) => STATUS_GROUP[flowStatus] || 'in_progress';

/** Statuses from which the applicant may save a draft of / submit step n. */
const SUBMITTABLE = {
  1: [FLOW_STATUS.LEAD_REGISTERED, FLOW_STATUS.STEP1_CHANGES_REQUESTED],
  2: [FLOW_STATUS.STEP1_APPROVED, FLOW_STATUS.STEP2_CHANGES_REQUESTED],
  3: [FLOW_STATUS.STEP2_APPROVED],
};

/** Status after the applicant submits step n. */
const SUBMIT_RESULT = {
  1: FLOW_STATUS.PENDING_STEP1_APPROVAL,
  2: FLOW_STATUS.PENDING_STEP2_APPROVAL,
  3: FLOW_STATUS.PENDING_FINAL_PROCESSING,
};

/** The only status in which a Back Office decision on step n is accepted. */
const REVIEWABLE = {
  1: FLOW_STATUS.PENDING_STEP1_APPROVAL,
  2: FLOW_STATUS.PENDING_STEP2_APPROVAL,
};

const DECISIONS = ['approve', 'reject', 'request_changes'];

/** Result of a decision on step n. A rejected application is final: it never advances. */
const DECISION_RESULT = {
  1: { approve: FLOW_STATUS.STEP1_APPROVED, request_changes: FLOW_STATUS.STEP1_CHANGES_REQUESTED, reject: FLOW_STATUS.LOAN_REJECTED },
  2: { approve: FLOW_STATUS.STEP2_APPROVED, request_changes: FLOW_STATUS.STEP2_CHANGES_REQUESTED, reject: FLOW_STATUS.LOAN_REJECTED },
};

/** Which staff roles may take which decision. Change this table to change who can approve. */
const DECISION_ROLES = {
  approve: ['credit_reviewer', 'system_admin'],
  reject: ['credit_reviewer', 'system_admin'],
  request_changes: ['customer_service', 'credit_reviewer', 'system_admin'],
};

/** Roles that may message an applicant to ask for corrections or more information. */
const MESSAGE_ROLES = ['customer_service', 'credit_reviewer', 'system_admin'];

/** Roles that may read the full applicant record. */
const VIEW_ROLES = ['customer_service', 'credit_reviewer', 'system_admin', 'funding_entity'];

/**
 * Final stage (existing procedure): canonical status transitions staff may make once step 3 is
 * submitted. Canonical status maps back onto the flow status.
 */
const FINAL_STAGE_STATUSES = ['Received', 'Under Review', 'Additional Document Required'];
const FINAL_TRANSITIONS = {
  'Received': { to: ['Under Review', 'Additional Document Required', 'Approved', 'Rejected'], roles: ['credit_reviewer', 'system_admin'] },
  'Under Review': { to: ['Under Review', 'Additional Document Required', 'Approved', 'Rejected'], roles: ['credit_reviewer', 'system_admin'] },
  'Additional Document Required': { to: ['Under Review', 'Rejected'], roles: ['credit_reviewer', 'system_admin'] },
  'Approved': { to: ['Forwarded to Funding Entity'], roles: ['credit_reviewer', 'system_admin', 'funding_entity'] },
  'Forwarded to Funding Entity': { to: [], roles: [] },
  'Rejected': { to: [], roles: [] },
};

function flowStatusForCanonical(canonicalStatus) {
  if (canonicalStatus === 'Approved' || canonicalStatus === 'Forwarded to Funding Entity') return FLOW_STATUS.LOAN_APPROVED;
  if (canonicalStatus === 'Rejected') return FLOW_STATUS.LOAN_REJECTED;
  return FLOW_STATUS.PENDING_FINAL_PROCESSING;
}

/** Can this applicant save or submit step n right now? */
function isStepEditable(flowStatus, step) {
  return !!SUBMITTABLE[step] && SUBMITTABLE[step].includes(flowStatus);
}

/** The highest step the applicant may open for the status. */
function unlockedStepFor(flowStatus) {
  switch (flowStatus) {
    case FLOW_STATUS.LEAD_REGISTERED:
    case FLOW_STATUS.PENDING_STEP1_APPROVAL:
    case FLOW_STATUS.STEP1_CHANGES_REQUESTED:
      return 1;
    case FLOW_STATUS.STEP1_APPROVED:
    case FLOW_STATUS.PENDING_STEP2_APPROVAL:
    case FLOW_STATUS.STEP2_CHANGES_REQUESTED:
      return 2;
    default:
      return 3;
  }
}

/**
 * Per-step state for the applicant view and the Back Office:
 * locked | available | draft | changes_requested | pending | approved | submitted | rejected
 */
function stepStates(flowStatus, rejectedAtStep) {
  const F = FLOW_STATUS;
  switch (flowStatus) {
    case F.LEAD_REGISTERED: return { 1: 'available', 2: 'locked', 3: 'locked' };
    case F.PENDING_STEP1_APPROVAL: return { 1: 'pending', 2: 'locked', 3: 'locked' };
    case F.STEP1_CHANGES_REQUESTED: return { 1: 'changes_requested', 2: 'locked', 3: 'locked' };
    case F.STEP1_APPROVED: return { 1: 'approved', 2: 'available', 3: 'locked' };
    case F.PENDING_STEP2_APPROVAL: return { 1: 'approved', 2: 'pending', 3: 'locked' };
    case F.STEP2_CHANGES_REQUESTED: return { 1: 'approved', 2: 'changes_requested', 3: 'locked' };
    case F.STEP2_APPROVED: return { 1: 'approved', 2: 'approved', 3: 'available' };
    case F.PENDING_FINAL_PROCESSING: return { 1: 'approved', 2: 'approved', 3: 'submitted' };
    case F.LOAN_APPROVED: return { 1: 'approved', 2: 'approved', 3: 'approved' };
    case F.LOAN_REJECTED: {
      const at = String(rejectedAtStep || '');
      if (at === '1') return { 1: 'rejected', 2: 'locked', 3: 'locked' };
      if (at === '2') return { 1: 'approved', 2: 'rejected', 3: 'locked' };
      return { 1: 'approved', 2: 'approved', 3: 'rejected' };
    }
    default: return { 1: 'locked', 2: 'locked', 3: 'locked' };
  }
}

/** What the applicant is expected to do next (null when nothing). */
function nextActionFor(flowStatus) {
  switch (flowStatus) {
    case FLOW_STATUS.LEAD_REGISTERED:
    case FLOW_STATUS.STEP1_CHANGES_REQUESTED: return { step: 1 };
    case FLOW_STATUS.STEP1_APPROVED:
    case FLOW_STATUS.STEP2_CHANGES_REQUESTED: return { step: 2 };
    case FLOW_STATUS.STEP2_APPROVED: return { step: 3 };
    default: return null;
  }
}

function canDecide(role, decision) {
  return !!(DECISION_ROLES[decision] && DECISION_ROLES[decision].includes(role));
}

/** Checks a final-stage canonical status change. Returns null when allowed, else an error message. */
function checkFinalTransition(role, fromCanonical, toCanonical) {
  const rule = FINAL_TRANSITIONS[fromCanonical];
  if (!rule || !rule.to.includes(toCanonical)) return `Cannot move from "${fromCanonical}" to "${toCanonical}".`;
  if (!rule.roles.includes(role)) return `Role "${role}" may not make this change.`;
  return null;
}

module.exports = {
  FLOW_STATUS,
  ALL_FLOW_STATUSES,
  FLOW_STATUS_LABEL,
  GROUPS,
  STATUS_GROUP,
  groupOf,
  SUBMITTABLE,
  SUBMIT_RESULT,
  REVIEWABLE,
  DECISIONS,
  DECISION_RESULT,
  DECISION_ROLES,
  MESSAGE_ROLES,
  VIEW_ROLES,
  FINAL_STAGE_STATUSES,
  FINAL_TRANSITIONS,
  flowStatusForCanonical,
  isStepEditable,
  unlockedStepFor,
  stepStates,
  nextActionFor,
  canDecide,
  checkFinalTransition,
};
