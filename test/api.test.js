const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { safeFetch } = require('../src/fetcher');
const { inspectWebsite } = require('../src/inspector');

let mockServer;
let mockPort;
let mockBaseUrl;

describe('Safe HTTP Fetcher & Inspector Integration', () => {
  before(() => {
    return new Promise(resolve => {
      mockServer = http.createServer((req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);

        if (url.pathname === '/200') {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Server': 'MockServer/1.0',
            'Set-Cookie': 'session=supersecrettoken; Path=/; Secure; HttpOnly',
            'Strict-Transport-Security': 'max-age=31536000'
          });
          res.end('<!DOCTYPE html><html><head><title>Mock 200</title></head><body><h1>Hello World</h1><a href="/200">Self</a></body></html>');
        } else if (url.pathname === '/redirect-1') {
          res.writeHead(302, { 'Location': '/200' });
          res.end();
        } else if (url.pathname === '/redirect-loop') {
          res.writeHead(301, { 'Location': '/redirect-loop' });
          res.end();
        } else if (url.pathname === '/404') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Resource Not Found');
        } else if (url.pathname === '/500') {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
        } else if (url.pathname === '/large') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          // Send 2 MB in chunks
          const chunk = Buffer.alloc(100 * 1024, 'a');
          for (let i = 0; i < 20; i++) {
            res.write(chunk);
          }
          res.end();
        } else if (url.pathname === '/slow') {
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Slow response');
          }, 1000);
        } else {
          res.writeHead(400);
          res.end('Unknown route');
        }
      });

      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = mockServer.address().port;
        mockBaseUrl = `http://127.0.0.1:${mockPort}`;
        resolve();
      });
    });
  });

  after(() => {
    return new Promise(resolve => {
      delete process.env.TEST_ALLOW_LOCALHOST;
      mockServer.close(resolve);
    });
  });

  test('SSRF Protection blocks requests to 127.0.0.1 when TEST_ALLOW_LOCALHOST is not active', async () => {
    delete process.env.TEST_ALLOW_LOCALHOST;
    const result = await safeFetch(`${mockBaseUrl}/200`);
    assert.equal(result.success, false);
    assert.match(result.error, /restricted|blocked|not permitted/i);
  });

  test('Inspects 200 OK HTML resource with status and parsed metadata', async () => {
    process.env.TEST_ALLOW_LOCALHOST = 'true';
    const result = await inspectWebsite(`${mockBaseUrl}/200`);

    assert.equal(result.success, true);
    assert.equal(result.status.code, 200);
    assert.equal(result.status.category, 'success');
    assert.equal(result.isHtml, true);
    assert.equal(result.html.head.title, 'Mock 200');
    assert.equal(result.html.headings.h1[0], 'Hello World');
    assert.equal(result.server, 'MockServer/1.0');

    // Verify cookies are masked
    assert.ok(result.cookies.length > 0);
    assert.equal(result.cookies[0].name, 'session');
    assert.equal(result.cookies[0].maskedValue, '••••••••');
    assert.notEqual(result.cookies[0].maskedValue, 'supersecrettoken');
    assert.equal(result.cookies[0].httpOnly, true);
    assert.equal(result.cookies[0].secure, true);
  });

  test('Traces redirect chain (302 -> 200)', async () => {
    process.env.TEST_ALLOW_LOCALHOST = 'true';
    const result = await inspectWebsite(`${mockBaseUrl}/redirect-1`);

    assert.equal(result.success, true);
    assert.equal(result.status.code, 200);
    assert.equal(result.redirects.length, 1);
    assert.equal(result.redirects[0].statusCode, 302);
    assert.equal(result.redirects[0].location, '/200');
    assert.equal(result.finalUrl, `${mockBaseUrl}/200`);
  });

  test('Detects and prevents redirect loop', async () => {
    process.env.TEST_ALLOW_LOCALHOST = 'true';
    const result = await safeFetch(`${mockBaseUrl}/redirect-loop`);

    assert.equal(result.success, false);
    assert.match(result.error, /Redirect loop detected/i);
  });

  test('Handles HTTP 404 response cleanly', async () => {
    process.env.TEST_ALLOW_LOCALHOST = 'true';
    const result = await inspectWebsite(`${mockBaseUrl}/404`);

    assert.equal(result.success, true);
    assert.equal(result.status.code, 404);
    assert.equal(result.status.category, 'client_error');
    assert.equal(result.isHtml, false);
  });

  test('Handles HTTP 500 response cleanly', async () => {
    process.env.TEST_ALLOW_LOCALHOST = 'true';
    const result = await inspectWebsite(`${mockBaseUrl}/500`);

    assert.equal(result.success, true);
    assert.equal(result.status.code, 500);
    assert.equal(result.status.category, 'server_error');
  });

  test('Enforces max response size limit', async () => {
    process.env.TEST_ALLOW_LOCALHOST = 'true';
    // Test with low 500 KB limit
    const result = await safeFetch(`${mockBaseUrl}/large`, { maxSize: 500 * 1024 });

    assert.equal(result.success, false);
    assert.match(result.error, /exceeded maximum size limit/i);
  });

  test('Enforces request timeout limit', async () => {
    process.env.TEST_ALLOW_LOCALHOST = 'true';
    const result = await safeFetch(`${mockBaseUrl}/slow`, { timeoutMs: 150 });

    assert.equal(result.success, false);
    assert.match(result.error, /timed out/i);
  });
});
