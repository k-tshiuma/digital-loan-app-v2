// Limits an API to a list of networks (the admin API: office or VPN addresses, ADMIN_ALLOWED_IPS).
// nginx does the same for the admin site; this check stays in force if the nginx lines are missing.
// Uses req.ip, so behind nginx TRUST_PROXY must be set, or every request comes from the proxy's address.
const net = require('net');

/**
 * Parses a comma- or space-separated list of addresses and networks ("203.0.113.0/24, 198.51.100.7,
 * 2001:db8::/32"). Returns null for an empty list (no limit). Throws on an entry it can't read, so a typo
 * stops the API at start-up instead of locking everyone out (or letting everyone in).
 */
function parseAllowlist(value) {
  const entries = String(value || '').split(/[\s,]+/).filter(Boolean);
  if (entries.length === 0) return null;
  const list = new net.BlockList();
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/');
    const family = net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null;
    const max = family === 'ipv4' ? 32 : 128;
    const bits = prefix === undefined ? max : Number(prefix);
    if (!family || extra !== undefined || !/^\d+$/.test(prefix ?? String(max)) || bits > max) {
      throw new Error(`Invalid address or network in the allow list: "${entry}"`);
    }
    list.addSubnet(address, bits, family);
  }
  return list;
}

/** The address as BlockList expects it: IPv4-mapped IPv6 (::ffff:10.0.0.1) becomes plain IPv4. */
function normalizeAddress(ip) {
  const s = String(ip || '');
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? mapped[1] : s;
}

const isLoopback = (ip) => ip === '::1' || /^127\./.test(ip);

/**
 * Express middleware that answers 403 to addresses outside the list. Requests from the machine itself
 * (loopback) always pass: the deploy health checks call the API directly. No list: every request passes.
 */
function ipAllowlist(value, { label = 'API' } = {}) {
  const list = parseAllowlist(value);
  if (!list) return null;
  return (req, res, next) => {
    const ip = normalizeAddress(req.ip);
    const family = net.isIPv4(ip) ? 'ipv4' : 'ipv6';
    if (isLoopback(ip) || (net.isIP(ip) && list.check(ip, family))) return next();
    console.warn(`[NETWORK] ${label} refused a request from ${ip || 'an unknown address'}: ${req.method} ${req.path}`);
    return res.status(403).json({ success: false, error: 'Access from this network is not allowed', code: 'NETWORK_NOT_ALLOWED' });
  };
}

module.exports = { ipAllowlist, parseAllowlist, normalizeAddress };
