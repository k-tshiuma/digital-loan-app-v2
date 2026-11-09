const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// DB_PATH lets the borrower and admin backends open the same file. Default: data/database.sqlite at the repo root.
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '..', '..', 'data', 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Connection settings, not schema. The busy timeout makes a second process wait for the write lock
// instead of failing with SQLITE_BUSY; it must be set before any statement runs, because switching to
// WAL needs that lock too. WAL lets reads run while a write is in progress.
db.configure('busyTimeout', 5000);

// WAL mode is stored in the database file, so once any process switches it, every connection uses it.
// When two processes start at the same moment, SQLite may refuse the switch with SQLITE_BUSY without
// waiting; retry briefly instead of crashing.
function enableWal(attempt = 1) {
  db.get('PRAGMA journal_mode = WAL', (err) => {
    if (!err) return;
    if (attempt < 5) setTimeout(() => enableWal(attempt + 1), 100 * attempt);
    else console.warn('Could not switch SQLite to WAL mode:', err.message);
  });
}

// Only one process may create the schema when two share the file (docs/app-separation-plan.md, C4):
// the borrower backend does; the admin backend runs with DB_INIT=false.
const OWNS_SCHEMA = process.env.DB_INIT !== 'false';

// Initialize tables
db.serialize(() => {
  enableWal();
  if (!OWNS_SCHEMA) return;

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phoneNumber TEXT UNIQUE,
      email TEXT UNIQUE,
      fullName TEXT,
      password TEXT,
      authProvider TEXT,
      phoneVerifiedAt TEXT,
      preferredLanguage TEXT,
      roles TEXT,
      isActive INTEGER,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      userId TEXT,
      requestNumber TEXT,
      isSubmitted INTEGER,
      submittedAt TEXT,
      status TEXT,
      language TEXT,
      currentStep INTEGER,
      borrowerDetails TEXT,
      residencyDetails TEXT,
      employmentDetails TEXT,
      loanRequest TEXT,
      guarantor TEXT,
      documents TEXT,
      consents TEXT,
      digitalSignature TEXT,
      statusHistory TEXT,
      riskScore INTEGER,
      riskLevel TEXT,
      riskFlags TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);

  // Phase 8: Add risk columns to existing applications table (ALTER TABLE with try/catch)
  // Also adds fields the frontend tracks but the original schema did not persist.
  const addedCols = [
    'ALTER TABLE applications ADD COLUMN riskScore INTEGER',
    'ALTER TABLE applications ADD COLUMN riskLevel TEXT',
    'ALTER TABLE applications ADD COLUMN riskFlags TEXT',
    'ALTER TABLE applications ADD COLUMN missingDocumentNotes TEXT',
    'ALTER TABLE applications ADD COLUMN bankAccountConfirmed INTEGER',
    'ALTER TABLE applications ADD COLUMN bankAccount TEXT',
    'ALTER TABLE applications ADD COLUMN guarantors TEXT',
    'ALTER TABLE applications ADD COLUMN eligibilityScore REAL',
    'ALTER TABLE applications ADD COLUMN eligibilityBreakdown TEXT',
    'ALTER TABLE users ADD COLUMN profileData TEXT',
    // 3-step approval workflow (flowVersion = 2). Legacy rows keep these columns NULL.
    'ALTER TABLE applications ADD COLUMN flowVersion INTEGER',
    'ALTER TABLE applications ADD COLUMN flowStatus TEXT',
    'ALTER TABLE applications ADD COLUMN unlockedStep INTEGER',
    'ALTER TABLE applications ADD COLUMN rejectedAtStep TEXT',
    'ALTER TABLE applications ADD COLUMN rejectionReason TEXT',
    'ALTER TABLE applications ADD COLUMN step1Data TEXT',
    'ALTER TABLE applications ADD COLUMN step2Data TEXT',
    'ALTER TABLE applications ADD COLUMN step3Data TEXT',
    'ALTER TABLE applications ADD COLUMN step1SubmittedAt TEXT',
    'ALTER TABLE applications ADD COLUMN step2SubmittedAt TEXT',
    'ALTER TABLE applications ADD COLUMN step3SubmittedAt TEXT',
    'ALTER TABLE applications ADD COLUMN flowCompletedAt TEXT',
    'ALTER TABLE applications ADD COLUMN loanBreakdown TEXT',
    'ALTER TABLE applications ADD COLUMN leadSource TEXT',
    'ALTER TABLE applications ADD COLUMN phoneVerified INTEGER',
    'ALTER TABLE applications ADD COLUMN staffMessage TEXT',
  ];
  addedCols.forEach(sql => {
    db.run(sql, (err) => {
      // Ignore "duplicate column" errors — column already exists
      if (err && !err.message.includes('duplicate column')) {
        console.error('[DB ALTER]', err.message);
      }
    });
  });

  // Phase 1: Password reset codes (stored hashed, single use, short expiry)
  db.run(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      userId TEXT,
      codeHash TEXT,
      expiresAt TEXT,
      attempts INTEGER DEFAULT 0,
      consumedAt TEXT,
      createdAt TEXT
    )
  `);

  // Phase 8: Key/value config store (credit rule thresholds, etc.)
  db.run(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updatedAt TEXT
    )
  `);

  // Secure document ownership tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS uploaded_files (
      filename TEXT PRIMARY KEY,
      userId TEXT,
      originalName TEXT,
      mimeType TEXT,
      size INTEGER,
      createdAt TEXT
    )
  `);

  // Phase 5: Notifications table
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      userId TEXT,
      applicationId TEXT,
      channel TEXT,
      notificationType TEXT,
      title TEXT,
      message TEXT,
      deliveryStatus TEXT DEFAULT 'pending',
      read INTEGER DEFAULT 0,
      language TEXT,
      createdAt TEXT
    )
  `);
  db.run('ALTER TABLE notifications ADD COLUMN language TEXT', (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('[DB ALTER]', err.message);
    }
  });

  // ---------------------------------------------------------------------------
  // 3-step approval workflow tables
  // ---------------------------------------------------------------------------

  // One row per Back Office decision on a step (approve / reject / request_changes).
  db.run(`
    CREATE TABLE IF NOT EXISTS application_step_reviews (
      id TEXT PRIMARY KEY,
      applicationId TEXT NOT NULL,
      step INTEGER NOT NULL,
      decision TEXT NOT NULL,
      note TEXT,
      revision INTEGER,
      reviewerId TEXT,
      reviewerName TEXT,
      reviewerRole TEXT,
      decidedAt TEXT NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_step_reviews_app ON application_step_reviews (applicationId, step)');

  // Immutable snapshot of every step submission (and resubmission after requested changes).
  db.run(`
    CREATE TABLE IF NOT EXISTS application_step_submissions (
      id TEXT PRIMARY KEY,
      applicationId TEXT NOT NULL,
      step INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      data TEXT,
      submittedBy TEXT,
      submittedAt TEXT NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_step_submissions_app ON application_step_submissions (applicationId, step)');

  // Append-only audit trail: registration, submissions, approvals, rejections, status changes, terms acceptance.
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      applicationId TEXT,
      actorType TEXT,
      actorId TEXT,
      actorRole TEXT,
      actorName TEXT,
      action TEXT NOT NULL,
      fromStatus TEXT,
      toStatus TEXT,
      metadata TEXT,
      ipAddress TEXT,
      userAgent TEXT,
      createdAt TEXT NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_audit_app ON audit_log (applicationId, createdAt)');

  // Versioned terms texts (general terms and service fee terms).
  db.run(`
    CREATE TABLE IF NOT EXISTS terms_versions (
      type TEXT NOT NULL,
      version TEXT NOT NULL,
      textEn TEXT,
      textHe TEXT,
      sha256 TEXT,
      effectiveFrom TEXT,
      PRIMARY KEY (type, version)
    )
  `);

  // Who accepted which version of which terms, and when.
  db.run(`
    CREATE TABLE IF NOT EXISTS terms_acceptances (
      id TEXT PRIMARY KEY,
      applicationId TEXT NOT NULL,
      userId TEXT,
      termsType TEXT NOT NULL,
      version TEXT NOT NULL,
      textSha256 TEXT,
      language TEXT,
      acceptedAt TEXT NOT NULL,
      ipAddress TEXT,
      userAgent TEXT
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_terms_acc_app ON terms_acceptances (applicationId)');

  // Real Back Office accounts (the demo role picker only works while DEMO_MODE is on).
  db.run(`
    CREATE TABLE IF NOT EXISTS staff_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      fullName TEXT,
      password TEXT,
      role TEXT NOT NULL,
      isActive INTEGER DEFAULT 1,
      failedAttempts INTEGER DEFAULT 0,
      lockedUntil TEXT,
      lastLoginAt TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);

  // Delivery log per notification channel (in_app / sms / email) so failed sends are visible and retryable.
  db.run(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY,
      notificationId TEXT,
      applicationId TEXT,
      userId TEXT,
      event TEXT,
      channel TEXT NOT NULL,
      recipient TEXT,
      subject TEXT,
      body TEXT,
      status TEXT,
      providerId TEXT,
      error TEXT,
      attempts INTEGER DEFAULT 0,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_deliveries_app ON notification_deliveries (applicationId)');

  // Request numbers: one counter row per year, taken in a single statement, so the two processes never
  // hand out the same number (core/applications.js nextRequestNumber).
  db.run(`
    CREATE TABLE IF NOT EXISTS request_counters (
      year INTEGER PRIMARY KEY,
      lastNumber INTEGER NOT NULL
    )
  `);
  // Safety net: no two applications share a request number. Only fails if an older database already has
  // duplicates; new numbers still come from the counter, so they stay unique.
  db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_request_number ON applications (requestNumber) WHERE requestNumber IS NOT NULL AND requestNumber <> ''",
    (err) => {
      if (err) console.warn('[DB] Duplicate request numbers in this database; the unique index was not created:', err.message);
    }
  );
});

module.exports = db;
