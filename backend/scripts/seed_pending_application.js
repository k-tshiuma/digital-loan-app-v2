/**
 * Create a test applicant whose Step 1 is submitted and waiting for Back Office approval
 * (flow status PENDING_STEP1_APPROVAL). Goes through the real API, so the backend must be running
 * in demo mode (fixed OTP).
 *
 * Usage: node backend/scripts/seed_pending_application.js
 * Env:   API_URL (default http://localhost:5000/api)
 */
const API = process.env.API_URL || 'http://localhost:5000/api';

async function call(method, path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

async function upload(filename, token) {
  const form = new FormData();
  // %PDF magic bytes pass the upload's file-type check.
  form.append('file', new Blob([Buffer.from('%PDF-1.4 demo document')], { type: 'application/pdf' }), filename);
  const res = await fetch(`${API}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Upload of ${filename} failed (${res.status}): ${JSON.stringify(data)}`);
  return data.file;
}

async function main() {
  const phoneNumber = '052' + Math.floor(1000000 + Math.random() * 9000000);
  const fullName = 'Niran Chaiyaphum';

  const otp = await call('POST', '/users/request-otp', { phoneNumber });
  const reg = await call('POST', '/flow/register', {
    fullName,
    email: `niran_${Date.now()}@example.com`,
    password: 'DemoPassword123!',
    phoneNumber,
    code: otp.demoCode || '123456',
    language: 'en',
    registration: { disclaimerAccepted: true, locationGranted: true },
  });
  const token = reg.token;

  const [passport, visa, payslip] = await Promise.all([
    upload('passport.pdf', token),
    upload('visa.pdf', token),
    upload('payslip.pdf', token),
  ]);

  const step1 = await call(
    'POST',
    '/flow/application/steps/1/submit',
    {
      data: {
        personal: {
          fullName,
          phoneNumber,
          dateOfBirth: '1991-03-22',
          address: 'Rothschild Blvd 12, Tel Aviv',
          passportNumber: 'TH8842109',
          countryOfOrigin: 'Thailand',
          visaStartDate: '2025-06-01',
          visaExpiryDate: '2028-05-31',
          monthlySalaryNis: 7500,
          salaryCurrency: 'ILS',
        },
        documents: { passport, visa, payslip },
        employment: { employerName: 'Dana Levi', companyName: 'Levi Greenhouses Ltd', manpowerAgent: 'AgroManpower TLV' },
        loan: { requestedAmountNis: 6000 },
      },
    },
    token
  );

  const app = step1.application;
  console.log(`Created ${app.requestNumber || app.id} for ${fullName} (${phoneNumber}) - status ${app.flowStatus}`);
}

main().catch((err) => {
  console.error(err.message);
  if (err.cause?.code === 'ECONNREFUSED') console.error(`Is the backend running at ${API}?`);
  process.exit(1);
});
