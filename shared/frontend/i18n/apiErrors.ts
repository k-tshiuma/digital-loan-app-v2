import { Language } from '../types';
import { t } from './translations';

// Exact English error texts sent by the backend (server.js) or the local fallback (storage.ts),
// mapped to translation keys. Add an entry here when a new user-facing error is introduced.
const KNOWN_ERRORS: Record<string, string> = {
  Forbidden: 'err.forbidden',
  'Authentication required': 'err.authRequired',
  'Invalid or expired session. Please sign in again.': 'err.sessionExpired',
  'Application not found': 'err.applicationNotFound',
  'User not found': 'err.userNotFound',
  'Account not found': 'err.userNotFound',
  'Password must be at least 8 characters.': 'err.passwordTooShort',
  'Too many attempts. Please request a new code.': 'err.tooManyAttempts',
  'This email is registered with a password. Please sign in with your phone number.': 'err.emailHasPassword',
  'This account has no password. Sign in with an SMS code instead.': 'err.noPassword',
  'Please verify this phone number before registering.': 'err.verifyPhoneFirst',
  'Please enter a valid mobile phone number.': 'err.invalidPhone',
  'Phone/email and password are required.': 'err.credentialsRequired',
  'Phone number or email is required': 'err.identifierRequired',
  'Phone number is required': 'err.phoneRequired',
  'OTP code has expired. Please request a new code.': 'err.otpExpired',
  'No active OTP request found for this number': 'err.noOtpRequest',
  'No account found with this phone number or email.': 'err.noAccount',
  'Invalid or expired reset code.': 'err.invalidResetCode',
  'Incorrect verification code. Please try again.': 'err.incorrectOtp',
  'Incorrect password. Please try again.': 'err.incorrectPassword',
  'Identifier, code and new password are required.': 'err.resetFieldsRequired',
  'Forbidden: You do not have permission to view this document.': 'err.documentForbidden',
  'File not found': 'err.fileNotFound',
  'File content does not match genuine PDF or image format. Disguised or corrupted files are rejected for security.':
    'err.fileRejected',
  'No file received (expected multipart field "file")': 'err.noFile',
  'Failed to generate PDF summary': 'err.pdfFailed',
  'Email is required': 'err.emailRequired',
  'Back-office access required': 'err.backOfficeRequired',
  'An account with this phone number already exists. Please sign in.': 'err.phoneExists',
  'An account with this email address already exists. Please sign in.': 'err.emailExists',
  'Medium-risk threshold cannot exceed the low-risk threshold.': 'err.mediumAboveLow',
  'Hard minimum tenure cannot exceed the warning tenure.': 'err.hardTenureAboveWarn',
  'Notification not found': 'err.notificationNotFound',
  'Could not connect to server. Please verify the backend is running.': 'err.network',
  'Failed to fetch': 'err.network',
};

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return '';
}

/**
 * Turn an error from the API (or the local fallback) into text in the user's language.
 * Known messages are translated. Unknown ones are shown as-is in English, and replaced by
 * `fallbackKey` in other languages so Hebrew users never see raw English.
 */
export function localizeError(err: unknown, lang: Language, fallbackKey = 'err.generic'): string {
  const message = messageOf(err).trim();
  const key = KNOWN_ERRORS[message];
  if (key) return t(lang, key);
  if (err instanceof TypeError && /fetch|network/i.test(message)) return t(lang, 'err.network');
  if (lang === 'en' && message) return message;
  return t(lang, fallbackKey);
}

export const KNOWN_ERROR_KEYS = Object.values(KNOWN_ERRORS);
