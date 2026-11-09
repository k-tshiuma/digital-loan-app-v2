const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
});

const RTL_LANGUAGES = ['he'];

/** Wrap an HTML fragment in a full document with the right language and direction. */
function wrapEmailHtml(html, lang = 'en') {
  const dir = RTL_LANGUAGES.includes(lang) ? 'rtl' : 'ltr';
  const align = dir === 'rtl' ? 'right' : 'left';
  return (
    `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"></head>` +
    `<body dir="${dir}" style="direction:${dir};text-align:${align};font-family:Arial,Helvetica,sans-serif">` +
    `${html}</body></html>`
  );
}

/**
 * Send an email. `options.lang` sets the language and direction of the HTML body (Hebrew is right-to-left).
 * If SMTP_USER is not configured, logs a mock message instead.
 */
async function sendEmail(to, subject, html, options = {}) {
  const lang = options.lang || 'en';
  const body = wrapEmailHtml(html, lang);
  if (!process.env.SMTP_USER) {
    console.log(`[EMAIL MOCK] To: ${to} | Lang: ${lang} | Subject: ${subject}`);
    return { success: true, mock: true, html: body };
  }
  try {
    await transporter.sendMail({ from: `"QuickLoan Israel" <${process.env.SMTP_USER}>`, to, subject, html: body });
    return { success: true };
  } catch (err) {
    console.error('[EMAIL ERROR]', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendEmail, wrapEmailHtml };
