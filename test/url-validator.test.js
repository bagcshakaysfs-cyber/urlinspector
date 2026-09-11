const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeUrl,
  isPrivateOrBlockedIP,
  validateHostnameAndResolve
} = require('../src/url-validator');

describe('URL Validator & SSRF Protection', () => {
  describe('normalizeUrl()', () => {
    test('normalizes bare domain to https://', () => {
      const res = normalizeUrl('example.com');
      assert.equal(res.valid, true);
      assert.equal(res.url, 'https://example.com/');
      assert.equal(res.protocol, 'https:');
      assert.equal(res.hostname, 'example.com');
    });

    test('preserves explicit http:// protocol', () => {
      const res = normalizeUrl('http://example.com/path?foo=bar');
      assert.equal(res.valid, true);
      assert.equal(res.url, 'http://example.com/path?foo=bar');
      assert.equal(res.protocol, 'http:');
    });

    test('handles protocol-relative URLs //example.com', () => {
      const res = normalizeUrl('//example.com/page');
      assert.equal(res.valid, true);
      assert.equal(res.url, 'https://example.com/page');
    });

    test('rejects unsupported protocols (ftp, file, javascript)', () => {
      const ftpRes = normalizeUrl('ftp://ftp.example.com');
      assert.equal(ftpRes.valid, false);
      assert.match(ftpRes.error, /Unsupported protocol/);

      const fileRes = normalizeUrl('file:///etc/passwd');
      assert.equal(fileRes.valid, false);
      assert.match(fileRes.error, /Unsupported protocol/);
    });

    test('rejects empty and non-string inputs', () => {
      assert.equal(normalizeUrl('').valid, false);
      assert.equal(normalizeUrl('   ').valid, false);
      assert.equal(normalizeUrl(null).valid, false);
      assert.equal(normalizeUrl(undefined).valid, false);
    });

    test('rejects disallowed non-standard ports', () => {
      const res = normalizeUrl('http://example.com:22');
      assert.equal(res.valid, false);
      assert.match(res.error, /Port 22 is not permitted/);
    });

    test('allows standard ports (80, 443, 8080, 8443)', () => {
      assert.equal(normalizeUrl('http://example.com:80').valid, true);
      assert.equal(normalizeUrl('https://example.com:443').valid, true);
      assert.equal(normalizeUrl('http://example.com:8080').valid, true);
      assert.equal(normalizeUrl('https://example.com:8443').valid, true);
    });
  });

  describe('isPrivateOrBlockedIP()', () => {
    test('blocks IPv4 loopback (127.0.0.0/8)', () => {
      assert.equal(isPrivateOrBlockedIP('127.0.0.1'), true);
      assert.equal(isPrivateOrBlockedIP('127.1.2.3'), true);
    });

    test('blocks IPv4 private Class A (10.0.0.0/8)', () => {
      assert.equal(isPrivateOrBlockedIP('10.0.0.1'), true);
      assert.equal(isPrivateOrBlockedIP('10.254.0.1'), true);
    });

    test('blocks IPv4 private Class B (172.16.0.0/12)', () => {
      assert.equal(isPrivateOrBlockedIP('172.16.0.1'), true);
      assert.equal(isPrivateOrBlockedIP('172.31.255.255'), true);
      assert.equal(isPrivateOrBlockedIP('172.32.0.1'), false); // Public IP
    });

    test('blocks IPv4 private Class C (192.168.0.0/16)', () => {
      assert.equal(isPrivateOrBlockedIP('192.168.1.1'), true);
      assert.equal(isPrivateOrBlockedIP('192.168.100.50'), true);
    });

    test('blocks link-local & cloud metadata (169.254.0.0/16)', () => {
      assert.equal(isPrivateOrBlockedIP('169.254.169.254'), true);
      assert.equal(isPrivateOrBlockedIP('169.254.1.1'), true);
    });

    test('blocks 0.0.0.0 and broadcast 255.255.255.255', () => {
      assert.equal(isPrivateOrBlockedIP('0.0.0.0'), true);
      assert.equal(isPrivateOrBlockedIP('255.255.255.255'), true);
    });

    test('blocks IPv6 loopback (::1)', () => {
      assert.equal(isPrivateOrBlockedIP('::1'), true);
      assert.equal(isPrivateOrBlockedIP('0:0:0:0:0:0:0:1'), true);
    });

    test('blocks IPv4-mapped IPv6 pointing to private addresses', () => {
      assert.equal(isPrivateOrBlockedIP('::ffff:127.0.0.1'), true);
      assert.equal(isPrivateOrBlockedIP('::ffff:192.168.1.1'), true);
      assert.equal(isPrivateOrBlockedIP('::ffff:169.254.169.254'), true);
      assert.equal(isPrivateOrBlockedIP('::ffff:8.8.8.8'), false); // Public IPv4 mapped
    });

    test('allows legitimate public IP addresses', () => {
      assert.equal(isPrivateOrBlockedIP('93.184.216.34'), false); // example.com
      assert.equal(isPrivateOrBlockedIP('8.8.8.8'), false); // Google DNS
      assert.equal(isPrivateOrBlockedIP('1.1.1.1'), false); // Cloudflare DNS
      assert.equal(isPrivateOrBlockedIP('2606:4700:4700::1111'), false); // Cloudflare IPv6
    });
  });

  describe('validateHostnameAndResolve()', () => {
    test('blocks localhost and internal domains immediately', async () => {
      const res = await validateHostnameAndResolve('localhost');
      assert.equal(res.valid, false);
      assert.match(res.error, /blocked for security reasons/i);

      const metaRes = await validateHostnameAndResolve('metadata.google.internal');
      assert.equal(metaRes.valid, false);
    });

    test('blocks literal private IP hostnames', async () => {
      const res = await validateHostnameAndResolve('127.0.0.1');
      assert.equal(res.valid, false);
      assert.match(res.error, /restricted/i);
    });

    test('allows public domains (example.com)', async () => {
      const res = await validateHostnameAndResolve('example.com');
      assert.equal(res.valid, true);
      assert.ok(res.resolvedIPs.length > 0);
    });
  });
});
