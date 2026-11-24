/**
 * Test certificates for the partner-bank sandbox's mutual TLS. Two small CAs, as with a real bank:
 *   bank-ca     signs the bank's server certificate (CN localhost). QuickLoan trusts it (FUNDING_PARTNER_CA).
 *   client-ca   signs QuickLoan's client certificate (CN quickloan-sandbox-client). The bank trusts it.
 * Files go to sandbox/partner-bank/certs/ (gitignored) unless PARTNER_SANDBOX_CERT_DIR is set. Nothing is
 * created again if the files exist. Needs the openssl program: OPENSSL_BIN, then `openssl` on the PATH, then
 * the copy that comes with Git for Windows.
 *
 *   node sandbox/partner-bank/certs.js          create the files if missing, print where they are
 *   node sandbox/partner-bank/certs.js --force  create new ones
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CERT_DIR = path.resolve(process.env.PARTNER_SANDBOX_CERT_DIR || path.join(__dirname, 'certs'));
const CLIENT_CN = 'quickloan-sandbox-client';
const DAYS = '825';

const FILES = {
  bankCa: 'bank-ca.crt',
  serverKey: 'server.key',
  serverCert: 'server.crt',
  clientCa: 'client-ca.crt',
  clientKey: 'client.key',
  clientCert: 'client.crt',
};

function certPaths(dir = CERT_DIR) {
  return Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, path.join(dir, f)]));
}

function findOpenssl() {
  const candidates = [
    process.env.OPENSSL_BIN,
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'C:\\msys64\\ucrt64\\bin\\openssl.exe',
    'C:\\msys64\\usr\\bin\\openssl.exe',
  ].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ['version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  throw new Error('openssl was not found. Install it, or set OPENSSL_BIN to the openssl program.');
}

function ensureCerts({ dir = CERT_DIR, force = false } = {}) {
  const p = certPaths(dir);
  if (!force && Object.values(p).every((f) => fs.existsSync(f))) return p;

  const openssl = findOpenssl();
  fs.mkdirSync(dir, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-sandbox-certs-'));
  // MSYS builds of openssl would otherwise turn "/CN=..." into a Windows path.
  const env = { ...process.env, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' };
  const run = (...args) => {
    const r = spawnSync(openssl, args, { cwd: work, encoding: 'utf8', env });
    if (r.status !== 0) throw new Error(`openssl ${args[0]} failed: ${r.stderr || r.stdout}`);
  };
  const w = (name) => path.join(work, name);

  try {
    for (const ca of ['bank-ca', 'client-ca']) {
      const cn = ca === 'bank-ca' ? 'Partner Bank Sandbox CA' : 'QuickLoan Sandbox Client CA';
      run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', w(`${ca}.key`), '-out', w(`${ca}.crt`), '-days', DAYS, '-subj', `/CN=${cn}`);
    }
    fs.writeFileSync(w('server.ext'), 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n');
    fs.writeFileSync(w('client.ext'), 'extendedKeyUsage=clientAuth\nkeyUsage=digitalSignature,keyEncipherment\n');
    const leaf = (name, cn, ca) => {
      run('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', w(`${name}.key`), '-out', w(`${name}.csr`), '-subj', `/CN=${cn}`);
      run('x509', '-req', '-in', w(`${name}.csr`), '-CA', w(`${ca}.crt`), '-CAkey', w(`${ca}.key`), '-CAcreateserial',
        '-out', w(`${name}.crt`), '-days', DAYS, '-extfile', w(`${name}.ext`));
    };
    leaf('server', 'localhost', 'bank-ca');
    leaf('client', CLIENT_CN, 'client-ca');

    // The CA keys stay in the temporary folder and are deleted: nothing more is ever signed with them.
    for (const [key, file] of Object.entries(FILES)) {
      const src = { bankCa: 'bank-ca.crt', clientCa: 'client-ca.crt' }[key] || file;
      fs.copyFileSync(w(src), p[key]);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return p;
}

module.exports = { CERT_DIR, CLIENT_CN, certPaths, ensureCerts };

if (require.main === module) {
  const p = ensureCerts({ force: process.argv.includes('--force') });
  console.log('Sandbox certificates:');
  for (const [k, f] of Object.entries(p)) console.log(`  ${k.padEnd(10)} ${f}`);
}
