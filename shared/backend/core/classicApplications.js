// Classic-wizard applications (one record, PUT /api/applications/:id): the parts of reading, saving and
// exporting them that both APIs share. The borrower API (borrower-app/backend/routes/applicationDetail.js)
// and the admin API (admin-app/backend/routes/applicationDetail.js) add their own access rules around these.
const path = require('path');
const fs = require('fs');
const { dbGet, dbRun, safeJson } = require('../services/dbHelpers');
const { UPLOAD_DIR } = require('./config');
const { parseApp, getAppById, writeApp, nextRequestNumber, applyRiskScore } = require('./applications');
const { broadcastAppEvent } = require('./sse');
const { notifyStatusChange } = require('./notifications');

const RISK_FIELDS = ['riskScore', 'riskLevel', 'riskFlags'];

/** Removes the staff-only risk fields (borrowers never see them). Returns the same object. */
function withoutRisk(a) {
  for (const f of RISK_FIELDS) delete a[f];
  return a;
}

/** 3-step applications (flowVersion 2) are changed only through /api/flow. Sends the 409 and returns true for them. */
function refuseFlowApplication(prev, res) {
  if (!prev || prev.flowVersion !== 2) return false;
  res.status(409).json({
    success: false,
    code: 'FLOW_V2_LOCKED',
    error: 'This application uses the 3-step approval workflow and must be updated via /api/flow endpoints.',
  });
  return true;
}

/**
 * The record to save from a client's PUT body: the server keeps the id, timestamps and request number,
 * and drops the scores it computes itself.
 */
async function draftFromRequest(id, incoming, prev, now) {
  const next = { ...incoming, id, updatedAt: now, createdAt: (prev && prev.createdAt) || incoming.createdAt || now };
  // Request numbers are assigned by the server and never change; a client could otherwise take another
  // application's number.
  next.requestNumber = (prev && prev.requestNumber) || (await nextRequestNumber());
  // Risk data and eligibility scores are computed server-side only to prevent tampering.
  withoutRisk(next);
  delete next.eligibilityScore;
  delete next.eligibilityBreakdown;
  return next;
}

/**
 * Saves the record: risk pre-screening for submitted applications, the user's stored profile, and the
 * status notification or live update. Returns the saved application as stored.
 */
async function saveClassicApplication(next, prev, now) {
  if (next.isSubmitted && !next.submittedAt) next.submittedAt = now;

  // Phase 8: advisory pre-screening on every save of a submitted application
  if (next.isSubmitted) await applyRiskScore(next);

  await writeApp(next);

  // Update user profile in users table so personal details and documents are permanently associated with this account
  if (next.userId && next.userId !== 'demo_user') {
    try {
      const userToUpdate = await dbGet('SELECT * FROM users WHERE id = ?', [next.userId]);
      if (userToUpdate) {
        const existingProf = safeJson(userToUpdate.profileData, {});
        const profilePayload = {
          borrowerDetails: next.borrowerDetails || existingProf.borrowerDetails,
          residencyDetails: next.residencyDetails || existingProf.residencyDetails,
          employmentDetails: next.employmentDetails || existingProf.employmentDetails,
          bankAccount: next.bankAccount || existingProf.bankAccount,
          bankAccountConfirmed: next.bankAccountConfirmed ?? existingProf.bankAccountConfirmed,
          guarantors: next.guarantors || existingProf.guarantors,
          guarantor: next.guarantor || existingProf.guarantor,
          documents: next.documents || existingProf.documents,
        };
        const updatedName = (next.borrowerDetails && next.borrowerDetails.fullName) || userToUpdate.fullName;
        await dbRun(
          'UPDATE users SET fullName = ?, profileData = ?, updatedAt = ? WHERE id = ?',
          [updatedName, JSON.stringify(profilePayload), now, next.userId]
        );
      }
    } catch (e) {
      console.warn('[USER PROFILE UPDATE]', e.message);
    }
  }

  const saved = await getAppById(next.id);

  // Phase 4 + 5: status-change hook (also fires on first submission)
  const newlySubmitted = saved.isSubmitted && !(prev && prev.isSubmitted);
  const statusChanged = saved.isSubmitted && prev && prev.isSubmitted && prev.status !== saved.status;
  if (newlySubmitted || statusChanged) {
    notifyStatusChange(saved, newlySubmitted ? null : prev.status).catch((err) => console.error('[NOTIFY]', err.message));
  } else if (saved.isSubmitted) {
    broadcastAppEvent(next.id, 'updated', { applicationId: next.id, status: saved.status, updatedAt: saved.updatedAt });
  }
  return saved;
}

/**
 * The application for a PDF request. If it isn't stored yet and the client sent it in the body (offline
 * draft), it is stored first. Returns null when there is nothing to export.
 */
async function applicationForPdf(req) {
  let a = await getAppById(req.params.id);
  if (!a && req.body && (req.body.id || req.body.borrowerDetails)) {
    const candidate = req.body.application || req.body;
    a = parseApp(candidate);
    if (a && (a.id || a.requestNumber)) {
      if (!a.id) a.id = req.params.id;
      try {
        await writeApp(a);
      } catch (e) {
        console.warn('Could not auto-persist application from PDF request:', e.message);
      }
    }
  }
  return a || null;
}

/** Path and stored metadata of an uploaded file, or null when the file doesn't exist. Blocks path traversal. */
async function uploadedFile(name) {
  const filename = path.basename(name);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  const meta = await dbGet('SELECT * FROM uploaded_files WHERE filename = ?', [filename]);
  return { filePath, meta };
}

function sendUploadedFile(res, filePath) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath);
}

module.exports = {
  withoutRisk,
  refuseFlowApplication,
  draftFromRequest,
  saveClassicApplication,
  applicationForPdf,
  uploadedFile,
  sendUploadedFile,
};
