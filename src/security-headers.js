/**
 * Analyzes HTTP response headers for standard web security defenses.
 */
function analyzeSecurityHeaders(headers = {}) {
  const normalizedHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders[key.toLowerCase()] = value;
  }

  const checks = [
    {
      key: 'strict-transport-security',
      name: 'Strict-Transport-Security (HSTS)',
      required: true,
      description: 'Enforces secure HTTPS connections and prevents SSL stripping.',
      validate: val => {
        if (!val) return { status: 'fail', note: 'HSTS is missing. Traffic could be vulnerable to downgrade attacks.' };
        const maxAgeMatch = val.match(/max-age=(\d+)/i);
        if (!maxAgeMatch) return { status: 'warning', note: 'HSTS is present but lacks a valid max-age directive.' };
        const maxAge = parseInt(maxAgeMatch[1], 10);
        if (maxAge < 15552000) {
          return { status: 'warning', note: `HSTS max-age is low (${maxAge}s). Minimum 180 days (15552000s) recommended.` };
        }
        return { status: 'pass', note: 'Configured properly with adequate max-age.' };
      }
    },
    {
      key: 'content-security-policy',
      name: 'Content-Security-Policy (CSP)',
      required: true,
      description: 'Restricts resource loading (scripts, styles, frames) to mitigate XSS and injection.',
      validate: val => {
        if (!val) return { status: 'fail', note: 'No CSP header found. Page is more susceptible to Cross-Site Scripting (XSS).' };
        if (val.includes("'unsafe-inline'") || val.includes("'unsafe-eval'")) {
          return { status: 'warning', note: 'CSP includes unsafe keywords (e.g. unsafe-inline or unsafe-eval).' };
        }
        return { status: 'pass', note: 'Configured with restrictive policy directives.' };
      }
    },
    {
      key: 'x-content-type-options',
      name: 'X-Content-Type-Options',
      required: true,
      description: 'Prevents MIME-sniffing away from the declared content-type.',
      validate: val => {
        if (!val) return { status: 'fail', note: 'Missing. Browsers may attempt to MIME-sniff response payloads.' };
        if (val.toLowerCase().trim() === 'nosniff') {
          return { status: 'pass', note: "Set to 'nosniff'." };
        }
        return { status: 'warning', note: `Unusual value: '${val}'. Expected 'nosniff'.` };
      }
    },
    {
      key: 'x-frame-options',
      name: 'X-Frame-Options',
      required: true,
      description: 'Prevents framing/clickjacking attacks (DENY or SAMEORIGIN).',
      validate: (val, all) => {
        // If CSP frame-ancestors is present, it supersedes X-Frame-Options in modern browsers
        const csp = all['content-security-policy'];
        const hasFrameAncestors = csp && /frame-ancestors/i.test(csp);

        if (!val) {
          if (hasFrameAncestors) {
            return { status: 'pass', note: 'Covered by CSP frame-ancestors directive.' };
          }
          return { status: 'fail', note: 'Missing. Site may be vulnerable to clickjacking unless framed via CSP.' };
        }
        const upper = val.toUpperCase().trim();
        if (upper === 'DENY' || upper === 'SAMEORIGIN') {
          return { status: 'pass', note: `Protected against framing (${upper}).` };
        }
        return { status: 'warning', note: `Value '${val}' may be deprecated or unsupported.` };
      }
    },
    {
      key: 'referrer-policy',
      name: 'Referrer-Policy',
      required: false,
      description: 'Controls how much referrer information is included with requests.',
      validate: val => {
        if (!val) return { status: 'fail', note: 'Not specified. Browser defaults will be used.' };
        const securePolicies = [
          'no-referrer',
          'no-referrer-when-downgrade',
          'origin',
          'origin-when-cross-origin',
          'same-origin',
          'strict-origin',
          'strict-origin-when-cross-origin'
        ];
        if (securePolicies.includes(val.toLowerCase().trim())) {
          return { status: 'pass', note: `Policy: ${val}` };
        }
        return { status: 'warning', note: `Non-standard policy: ${val}` };
      }
    },
    {
      key: 'permissions-policy',
      name: 'Permissions-Policy',
      required: false,
      description: 'Restricts browser features and APIs (camera, microphone, geolocation).',
      validate: val => {
        if (!val) return { status: 'fail', note: 'Not configured. Browser hardware APIs remain accessible by default.' };
        return { status: 'pass', note: 'Browser features explicitly restricted.' };
      }
    }
  ];

  const results = checks.map(check => {
    const rawVal = normalizedHeaders[check.key] || null;
    const { status, note } = check.validate(rawVal, normalizedHeaders);
    return {
      header: check.name,
      key: check.key,
      present: !!rawVal,
      value: rawVal,
      status,
      note,
      description: check.description
    };
  });

  const passed = results.filter(r => r.status === 'pass').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  const missing = results.filter(r => r.status === 'fail').length;

  return {
    disclaimer: 'Informational check only. Not a substitute for a full security penetration test.',
    score: {
      passed,
      warnings,
      missing,
      total: results.length
    },
    results
  };
}

/**
 * Parses and masks public cookies from Set-Cookie headers.
 * NEVER returns raw cookie secrets or auth tokens.
 */
function parseAndMaskCookies(headers = {}) {
  let setCookieHeader = headers['set-cookie'];
  if (!setCookieHeader) return [];

  const rawCookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  const maskedCookies = [];

  for (const raw of rawCookies) {
    if (!raw || typeof raw !== 'string') continue;

    const parts = raw.split(';').map(p => p.trim());
    if (parts.length === 0) continue;

    const [firstPart, ...attributes] = parts;
    const eqIdx = firstPart.indexOf('=');

    let name = firstPart;
    let originalVal = '';
    if (eqIdx !== -1) {
      name = firstPart.substring(0, eqIdx).trim();
      originalVal = firstPart.substring(eqIdx + 1).trim();
    }

    // Mask value with dots/bullets
    const maskedValue = originalVal.length > 0 ? '••••••••' : '';

    let isSecure = false;
    let isHttpOnly = false;
    let sameSite = 'Not set';
    let path = '/';
    let domain = null;
    let maxAge = null;
    let expires = null;

    for (const attr of attributes) {
      const lowerAttr = attr.toLowerCase();
      if (lowerAttr === 'secure') {
        isSecure = true;
      } else if (lowerAttr === 'httponly') {
        isHttpOnly = true;
      } else if (lowerAttr.startsWith('samesite=')) {
        sameSite = attr.substring(9).trim();
      } else if (lowerAttr.startsWith('path=')) {
        path = attr.substring(5).trim();
      } else if (lowerAttr.startsWith('domain=')) {
        domain = attr.substring(7).trim();
      } else if (lowerAttr.startsWith('max-age=')) {
        maxAge = attr.substring(8).trim();
      } else if (lowerAttr.startsWith('expires=')) {
        expires = attr.substring(8).trim();
      }
    }

    maskedCookies.push({
      name,
      maskedValue,
      secure: isSecure,
      httpOnly: isHttpOnly,
      sameSite,
      path,
      domain,
      expires: expires || (maxAge ? `Max-Age: ${maxAge}s` : 'Session')
    });
  }

  return maskedCookies;
}

module.exports = {
  analyzeSecurityHeaders,
  parseAndMaskCookies
};
