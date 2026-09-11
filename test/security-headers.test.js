const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeSecurityHeaders, parseAndMaskCookies } = require('../src/security-headers');

describe('Security Headers & Cookie Masking', () => {
  describe('analyzeSecurityHeaders()', () => {
    test('passes well-configured security headers', () => {
      const headers = {
        'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
        'content-security-policy': "default-src 'self'; script-src 'self'",
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': 'camera=(), microphone=()'
      };

      const analysis = analyzeSecurityHeaders(headers);
      assert.equal(analysis.score.passed, 6);
      assert.equal(analysis.score.missing, 0);
    });

    test('flags missing security headers', () => {
      const headers = {
        'server': 'nginx'
      };

      const analysis = analyzeSecurityHeaders(headers);
      assert.ok(analysis.score.missing >= 4);
    });

    test('warns on low HSTS max-age', () => {
      const headers = {
        'strict-transport-security': 'max-age=3600'
      };

      const analysis = analyzeSecurityHeaders(headers);
      const hsts = analysis.results.find(r => r.key === 'strict-transport-security');
      assert.equal(hsts.status, 'warning');
      assert.match(hsts.note, /low/);
    });

    test('accepts CSP frame-ancestors as clickjacking protection', () => {
      const headers = {
        'content-security-policy': "frame-ancestors 'none'"
      };

      const analysis = analyzeSecurityHeaders(headers);
      const xfo = analysis.results.find(r => r.key === 'x-frame-options');
      assert.equal(xfo.status, 'pass');
      assert.match(xfo.note, /CSP frame-ancestors/);
    });
  });

  describe('parseAndMaskCookies()', () => {
    test('masks cookie values while preserving security flags', () => {
      const headers = {
        'set-cookie': [
          'session_token=secret_jwt_xyz_12345; Path=/; Secure; HttpOnly; SameSite=Strict',
          'user_pref=dark; Path=/app; SameSite=Lax'
        ]
      };

      const cookies = parseAndMaskCookies(headers);
      assert.equal(cookies.length, 2);

      // Verify session cookie
      assert.equal(cookies[0].name, 'session_token');
      assert.equal(cookies[0].maskedValue, '••••••••');
      assert.notEqual(cookies[0].maskedValue, 'secret_jwt_xyz_12345');
      assert.equal(cookies[0].secure, true);
      assert.equal(cookies[0].httpOnly, true);
      assert.equal(cookies[0].sameSite, 'Strict');
      assert.equal(cookies[0].path, '/');

      // Verify pref cookie
      assert.equal(cookies[1].name, 'user_pref');
      assert.equal(cookies[1].maskedValue, '••••••••');
      assert.equal(cookies[1].secure, false);
      assert.equal(cookies[1].httpOnly, false);
      assert.equal(cookies[1].sameSite, 'Lax');
      assert.equal(cookies[1].path, '/app');
    });

    test('handles single set-cookie string', () => {
      const headers = {
        'set-cookie': 'id=999; Secure'
      };
      const cookies = parseAndMaskCookies(headers);
      assert.equal(cookies.length, 1);
      assert.equal(cookies[0].name, 'id');
      assert.equal(cookies[0].maskedValue, '••••••••');
      assert.equal(cookies[0].secure, true);
    });

    test('returns empty array when no set-cookie header is present', () => {
      assert.deepEqual(parseAndMaskCookies({}), []);
    });
  });
});
