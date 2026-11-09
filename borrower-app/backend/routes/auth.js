// Borrower sign-in and accounts: lookup, password login, OTP, registration, Google demo, password reset. Public (before `authenticate`).
const bcrypt = require('bcryptjs');
const { dbGet, dbRun, newId } = require('@quickloan/backend-core/services/dbHelpers');
const { DEMO_MODE, BCRYPT_ROUNDS } = require('@quickloan/backend-core/core/config');
const { normalizePhone, isBcryptHash, hashCode, generateCode, sanitizeUser, signUserToken, authenticate, otpStore, OTP_TTL_MS, MAX_CODE_ATTEMPTS, checkOtp } = require('@quickloan/backend-core/core/auth');
const { sendSms } = require('@quickloan/backend-core/services/smsService');
const { sendEmail } = require('@quickloan/backend-core/services/emailService');
const { resolveMessageLanguage, msg } = require('@quickloan/backend-core/services/messages');

function register(app) {
  // Does an account exist for this phone, and does it use a password?
  app.post('/api/users/lookup', async (req, res) => {
    const phone = normalizePhone(req.body.phoneNumber);
    if (!phone) return res.status(400).json({ success: false, error: 'Phone number is required' });
    const user = await dbGet('SELECT password FROM users WHERE phoneNumber = ?', [phone]);
    res.json({ success: true, exists: !!user, hasPassword: !!(user && user.password) });
  });

  app.post('/api/users/login', async (req, res) => {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'Phone/email and password are required.' });
    }
    const isEmail = String(identifier).includes('@');
    const user = isEmail
      ? await dbGet('SELECT * FROM users WHERE lower(email) = lower(?)', [String(identifier).trim()])
      : await dbGet('SELECT * FROM users WHERE phoneNumber = ?', [normalizePhone(identifier)]);

    if (!user) {
      return res.status(404).json({ success: false, error: 'No account found with this phone number or email.' });
    }
    if (!user.password) {
      return res.status(400).json({ success: false, error: 'This account has no password. Sign in with an SMS code instead.' });
    }

    let valid = false;
    if (isBcryptHash(user.password)) {
      valid = await bcrypt.compare(password, user.password);
    } else if (user.password === password) {
      // Legacy plaintext password: accept once and upgrade to a bcrypt hash.
      valid = true;
      await dbRun('UPDATE users SET password = ?, updatedAt = ? WHERE id = ?', [await bcrypt.hash(password, BCRYPT_ROUNDS), new Date().toISOString(), user.id]);
    }
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Incorrect password. Please try again.' });
    }

    res.json({ success: true, user: sanitizeUser(user), token: signUserToken(user) });
  });

  app.post('/api/users/request-otp', async (req, res) => {
    const phone = normalizePhone(req.body.phoneNumber);
    if (!phone || phone.replace(/\D/g, '').length < 7) {
      return res.status(400).json({ success: false, error: 'Please enter a valid mobile phone number.' });
    }
    // Demo helper: numbers ending in 4567 get 123456, other test numbers get a generated code
    const code = DEMO_MODE && phone.endsWith('4567') ? '123456' : generateCode();
    otpStore.set(phone, { code, codeHash: hashCode(code), expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
    // The code is sent in the language on screen; for a known number without one, the account's language.
    const existing = req.body.language ? null : await dbGet('SELECT preferredLanguage FROM users WHERE phoneNumber = ?', [phone]);
    const lang = resolveMessageLanguage(req.body.language, existing && existing.preferredLanguage);
    await sendSms(phone, msg(lang, 'sms.otp', { code }));
    res.json({ success: true, expiresInSeconds: OTP_TTL_MS / 1000, ...(DEMO_MODE ? { demoCode: code } : {}) });
  });

  app.post('/api/users/verify-otp', async (req, res) => {
    const phone = normalizePhone(req.body.phoneNumber);
    const code = String(req.body.code || '').trim();
    const preferredLanguage = req.body.preferredLanguage || 'en';
    
    const otpResult = checkOtp(phone, code);
    if (!otpResult.ok) {
      return res.status(otpResult.status).json({ success: false, error: otpResult.error });
    }

    const now = new Date().toISOString();
    let user = await dbGet('SELECT * FROM users WHERE phoneNumber = ?', [phone]);
    if (!user) {
      const id = newId('user');
      await dbRun(
        `INSERT INTO users (id, phoneNumber, authProvider, phoneVerifiedAt, preferredLanguage, roles, isActive, createdAt, updatedAt)
         VALUES (?, ?, 'phone', ?, ?, ?, 1, ?, ?)`,
        [id, phone, now, preferredLanguage, JSON.stringify(['borrower']), now, now]
      );
      user = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
    } else {
      await dbRun('UPDATE users SET phoneVerifiedAt = ?, updatedAt = ? WHERE id = ?', [now, now, user.id]);
    }

    res.json({ success: true, user: sanitizeUser(user), token: signUserToken(user) });
  });

  // Registration completes a phone-verified account: requires the token issued by /verify-otp.
  app.post('/api/users/register', authenticate, async (req, res) => {
    const { fullName, email, password, preferredLanguage } = req.body;
    const phone = normalizePhone(req.body.phoneNumber);

    if (req.auth.type !== 'borrower' || req.auth.phone !== phone) {
      return res.status(403).json({ success: false, error: 'Please verify this phone number before registering.' });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    }

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.auth.sub]);
    if (!user) return res.status(404).json({ success: false, error: 'Account not found' });
    if (user.password) {
      return res.status(400).json({ success: false, error: 'An account with this phone number already exists. Please sign in.' });
    }
    if (email) {
      const other = await dbGet('SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?', [email.trim(), user.id]);
      if (other) return res.status(400).json({ success: false, error: 'An account with this email address already exists. Please sign in.' });
    }

    const now = new Date().toISOString();
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await dbRun(
      `UPDATE users SET fullName = ?, email = ?, password = ?, authProvider = 'password', preferredLanguage = ?, updatedAt = ? WHERE id = ?`,
      [fullName || null, email ? email.trim() : null, hash, preferredLanguage || user.preferredLanguage || 'en', now, user.id]
    );
    const updated = await dbGet('SELECT * FROM users WHERE id = ?', [user.id]);
    res.json({ success: true, user: sanitizeUser(updated), token: signUserToken(updated) });
  });

  // Mock "Continue with Google" — demo only (there is no real OAuth handshake).
  app.post('/api/users/google-demo', async (req, res) => {
    if (!DEMO_MODE) return res.status(404).json({ success: false, error: 'Not available' });
    const { email, name, preferredLanguage } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

    const now = new Date().toISOString();
    let user = await dbGet('SELECT * FROM users WHERE lower(email) = lower(?)', [email]);
    if (user && user.authProvider !== 'google') {
      return res.status(400).json({ success: false, error: 'This email is registered with a password. Please sign in with your phone number.' });
    }
    if (!user) {
      const id = newId('user_google');
      await dbRun(
        `INSERT INTO users (id, phoneNumber, email, fullName, authProvider, phoneVerifiedAt, preferredLanguage, roles, isActive, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'google', ?, ?, ?, 1, ?, ?)`,
        [id, `google:${email.toLowerCase()}`, email, name || null, now, preferredLanguage || 'en', JSON.stringify(['borrower']), now, now]
      );
      user = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
    }
    res.json({ success: true, user: sanitizeUser(user), token: signUserToken(user) });
  });

  // Forgot password: send a 6-digit reset code via SMS (and email if available).
  app.post('/api/users/forgot-password', async (req, res) => {
    const identifier = String(req.body.identifier || '').trim();
    if (!identifier) return res.status(400).json({ success: false, error: 'Phone number or email is required' });

    const isEmail = identifier.includes('@');
    const user = isEmail
      ? await dbGet('SELECT * FROM users WHERE lower(email) = lower(?)', [identifier])
      : await dbGet('SELECT * FROM users WHERE phoneNumber = ?', [normalizePhone(identifier)]);

    // Always respond the same way so the endpoint cannot be used to discover accounts.
    const genericResponse = { success: true, message: 'If an account exists, a reset code has been sent.' };
    if (!user || !user.password) return res.json(genericResponse);

    const code = generateCode();
    const now = new Date();
    await dbRun('UPDATE password_resets SET consumedAt = ? WHERE userId = ? AND consumedAt IS NULL', [now.toISOString(), user.id]);
    await dbRun(
      'INSERT INTO password_resets (id, userId, codeHash, expiresAt, attempts, createdAt) VALUES (?, ?, ?, ?, 0, ?)',
      [newId('pwreset'), user.id, hashCode(code), new Date(now.getTime() + 15 * 60 * 1000).toISOString(), now.toISOString()]
    );

    const lang = resolveMessageLanguage(req.body.language, user.preferredLanguage);
    const text = msg(lang, 'sms.passwordReset', { code });
    if (user.phoneNumber && !user.phoneNumber.startsWith('google:')) await sendSms(user.phoneNumber, text);
    if (user.email) await sendEmail(user.email, msg(lang, 'email.passwordResetSubject'), `<p>${text}</p>`, { lang });

    res.json({ ...genericResponse, ...(DEMO_MODE ? { demoCode: code } : {}) });
  });

  app.post('/api/users/reset-password', async (req, res) => {
    const identifier = String(req.body.identifier || '').trim();
    const { code, newPassword } = req.body;
    if (!identifier || !code || !newPassword) {
      return res.status(400).json({ success: false, error: 'Identifier, code and new password are required.' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    }

    const isEmail = identifier.includes('@');
    const user = isEmail
      ? await dbGet('SELECT * FROM users WHERE lower(email) = lower(?)', [identifier])
      : await dbGet('SELECT * FROM users WHERE phoneNumber = ?', [normalizePhone(identifier)]);
    const invalid = () => res.status(400).json({ success: false, error: 'Invalid or expired reset code.' });
    if (!user) return invalid();

    const reset = await dbGet(
      'SELECT * FROM password_resets WHERE userId = ? AND consumedAt IS NULL ORDER BY createdAt DESC LIMIT 1',
      [user.id]
    );
    if (!reset || new Date(reset.expiresAt).getTime() < Date.now() || reset.attempts >= MAX_CODE_ATTEMPTS) return invalid();
    if (reset.codeHash !== hashCode(code)) {
      await dbRun('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', [reset.id]);
      return invalid();
    }

    const now = new Date().toISOString();
    await dbRun('UPDATE password_resets SET consumedAt = ? WHERE id = ?', [now, reset.id]);
    await dbRun('UPDATE users SET password = ?, updatedAt = ? WHERE id = ?', [await bcrypt.hash(newPassword, BCRYPT_ROUNDS), now, user.id]);
    const updated = await dbGet('SELECT * FROM users WHERE id = ?', [user.id]);
    res.json({ success: true, user: sanitizeUser(updated), token: signUserToken(updated) });
  });
}

module.exports = { register };
