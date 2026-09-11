const dns = require('node:dns/promises');
const net = require('node:net');

// Standard blocked hostnames and metadata endpoints
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'instance-data',
  '169.254.169.254'
]);

/**
 * Normalizes and validates a user-provided URL string.
 * Automatically adds https:// to bare domains.
 */
function normalizeUrl(input) {
  if (!input || typeof input !== 'string') {
    return { valid: false, error: 'URL is required and must be a string.' };
  }

  let trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, error: 'URL cannot be empty.' };
  }

  // Check if string already starts with a URI scheme (e.g. ftp://, file://, javascript:, http://, https://)
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(trimmed);

  if (trimmed.startsWith('//')) {
    trimmed = `https:${trimmed}`;
  } else if (!hasScheme) {
    trimmed = `https://${trimmed}`;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    return { valid: false, error: `Invalid URL format: ${err.message}` };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return {
      valid: false,
      error: `Unsupported protocol '${protocol}'. Only 'http:' and 'https:' are allowed.`
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { valid: false, error: 'URL must include a valid hostname.' };
  }

  // Validate port if explicitly specified
  const port = parsed.port ? parseInt(parsed.port, 10) : (protocol === 'https:' ? 443 : 80);
  const allowedPorts = (process.env.ALLOWED_PORTS || '80,443,8080,8443')
    .split(',')
    .map(p => parseInt(p.trim(), 10))
    .filter(Boolean);

  if (process.env.TEST_ALLOW_LOCALHOST !== 'true' && !allowedPorts.includes(port)) {
    return {
      valid: false,
      error: `Port ${port} is not permitted. Allowed ports: ${allowedPorts.join(', ')}.`
    };
  }

  return {
    valid: true,
    url: parsed.href,
    parsed,
    protocol,
    hostname,
    port
  };
}

/**
 * Converts an IPv4 string to a 32-bit unsigned integer.
 */
function ip4ToInt(ip) {
  return ip
    .split('.')
    .reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

/**
 * Checks if an IPv4 address falls within a given CIDR subnet.
 */
function isInSubnet4(ip, subnet, maskBits) {
  const ipInt = ip4ToInt(ip);
  const subnetInt = ip4ToInt(subnet);
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (subnetInt & mask);
}

/**
 * Checks if an IP (v4 or v6) is private, loopback, link-local, or cloud metadata.
 */
function isPrivateOrBlockedIP(ip) {
  if (!ip || typeof ip !== 'string') return true;

  const trimmed = ip.trim().toLowerCase();

  // Check IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (trimmed.startsWith('::ffff:')) {
    const v4Part = trimmed.slice(7);
    if (net.isIPv4(v4Part)) {
      return isPrivateOrBlockedIP(v4Part);
    }
  }

  // Check IPv4
  if (net.isIPv4(trimmed)) {
    // 127.0.0.0/8 Loopback
    if (isInSubnet4(trimmed, '127.0.0.0', 8)) return true;
    // 0.0.0.0/8 Current network
    if (isInSubnet4(trimmed, '0.0.0.0', 8)) return true;
    // 10.0.0.0/8 Private
    if (isInSubnet4(trimmed, '10.0.0.0', 8)) return true;
    // 172.16.0.0/12 Private
    if (isInSubnet4(trimmed, '172.16.0.0', 12)) return true;
    // 192.168.0.0/16 Private
    if (isInSubnet4(trimmed, '192.168.0.0', 16)) return true;
    // 169.254.0.0/16 Link-local / AWS & GCP metadata (169.254.169.254)
    if (isInSubnet4(trimmed, '169.254.0.0', 16)) return true;
    // 100.64.0.0/10 Carrier-grade NAT
    if (isInSubnet4(trimmed, '100.64.0.0', 10)) return true;
    // 192.0.0.0/24 IETF Protocol Assignments
    if (isInSubnet4(trimmed, '192.0.0.0', 24)) return true;
    // 192.0.2.0/24 Documentation (TEST-NET-1)
    if (isInSubnet4(trimmed, '192.0.2.0', 24)) return true;
    // 198.51.100.0/24 Documentation (TEST-NET-2)
    if (isInSubnet4(trimmed, '198.51.100.0', 24)) return true;
    // 203.0.113.0/24 Documentation (TEST-NET-3)
    if (isInSubnet4(trimmed, '203.0.113.0', 24)) return true;
    // 224.0.0.0/4 Multicast
    if (isInSubnet4(trimmed, '224.0.0.0', 4)) return true;
    // 240.0.0.0/4 Reserved
    if (isInSubnet4(trimmed, '240.0.0.0', 4)) return true;
    // 255.255.255.255 Broadcast
    if (trimmed === '255.255.255.255') return true;

    return false;
  }

  // Check IPv6
  if (net.isIPv6(trimmed)) {
    // Loopback
    if (trimmed === '::1' || trimmed === '0:0:0:0:0:0:0:1') return true;
    // Unspecified
    if (trimmed === '::' || trimmed === '0:0:0:0:0:0:0:0') return true;
    // Unique local (fc00::/7)
    if (/^f[cd][0-9a-f]{2}:/i.test(trimmed)) return true;
    // Link-local (fe80::/10)
    if (/^fe[89ab][0-9a-f]:/i.test(trimmed)) return true;
    // IPv4-mapped
    if (trimmed.includes('::ffff:')) return true;

    return false;
  }

  // If not a valid IPv4 or IPv6, treat as blocked/invalid
  return true;
}

/**
 * Validates a hostname and performs DNS pre-resolution to check for SSRF and DNS rebinding risks.
 */
async function validateHostnameAndResolve(hostname) {
  const lowerHost = hostname.toLowerCase().trim();

  // Allow localhost/127.0.0.1 strictly in test suites when explicitly enabled
  if (process.env.TEST_ALLOW_LOCALHOST === 'true' && (lowerHost === 'localhost' || lowerHost === '127.0.0.1')) {
    return {
      valid: true,
      resolvedIPs: [{ address: '127.0.0.1', family: 4 }]
    };
  }

  if (BLOCKED_HOSTNAMES.has(lowerHost) || lowerHost.endsWith('.localhost') || lowerHost.endsWith('.local')) {
    return {
      valid: false,
      error: `Access to '${hostname}' is blocked for security reasons (SSRF Protection).`
    };
  }

  // If the hostname itself is an IP literal
  if (net.isIP(lowerHost)) {
    if (isPrivateOrBlockedIP(lowerHost)) {
      return {
        valid: false,
        error: `Access to IP address '${hostname}' is restricted (SSRF Protection: private/internal IP).`
      };
    }
    return {
      valid: true,
      resolvedIPs: [{ address: lowerHost, family: net.isIPv4(lowerHost) ? 4 : 6 }]
    };
  }

  // Perform DNS resolution to check resolved IP addresses
  try {
    const addresses = await dns.lookup(lowerHost, { all: true });
    if (!addresses || addresses.length === 0) {
      return {
        valid: false,
        error: `Could not resolve hostname '${hostname}'. DNS lookup returned no records.`
      };
    }

    for (const record of addresses) {
      if (isPrivateOrBlockedIP(record.address)) {
        return {
          valid: false,
          error: `Access to '${hostname}' is blocked because it resolves to restricted IP ${record.address} (SSRF Protection).`
        };
      }
    }

    return {
      valid: true,
      resolvedIPs: addresses
    };
  } catch (err) {
    return {
      valid: false,
      error: `DNS resolution failed for '${hostname}': ${err.code || err.message}`
    };
  }
}

module.exports = {
  normalizeUrl,
  isPrivateOrBlockedIP,
  validateHostnameAndResolve,
  BLOCKED_HOSTNAMES
};
