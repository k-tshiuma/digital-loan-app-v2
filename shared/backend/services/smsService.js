// GSM 03.38 basic character set. Text using only these (or the extension table, which costs
// 2 characters each) is sent as GSM-7: 160 characters per SMS, 153 per part when split.
// Anything else (Hebrew, emoji, ...) is sent as UCS-2: 70 per SMS, 67 per part.
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€\f';

/** Encoding and number of SMS parts a message needs. */
function smsSegments(text) {
  const chars = [...String(text)];
  const isGsm = chars.every((c) => GSM_BASIC.includes(c) || GSM_EXTENDED.includes(c));
  if (isGsm) {
    const length = chars.reduce((n, c) => n + (GSM_EXTENDED.includes(c) ? 2 : 1), 0);
    return { encoding: 'GSM-7', length, segments: length <= 160 ? 1 : Math.ceil(length / 153) };
  }
  // UCS-2 counts UTF-16 code units, so an emoji takes two.
  const length = String(text).length;
  return { encoding: 'UCS-2', length, segments: length <= 70 ? 1 : Math.ceil(length / 67) };
}

/**
 * Send an SMS via Twilio.
 * Falls back to console mock when TWILIO_SID / TWILIO_TOKEN are not set.
 */
async function sendSms(to, message) {
  if (!process.env.TWILIO_SID || !process.env.TWILIO_TOKEN) {
    const info = smsSegments(message);
    console.log(`[SMS MOCK] To: ${to} | ${info.encoding}, ${info.length} chars, ${info.segments} segment(s) | Message: ${message}`);
    return { success: true, mock: true, ...info };
  }
  const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  try {
    const msg = await twilio.messages.create({ body: message, from: process.env.TWILIO_FROM, to });
    return { success: true, sid: msg.sid };
  } catch (err) {
    console.error('[SMS ERROR]', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendSms, smsSegments };
