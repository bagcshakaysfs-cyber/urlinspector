const http = require('node:http');
const https = require('node:https');
const { normalizeUrl, validateHostnameAndResolve } = require('./url-validator');

const DEFAULT_USER_AGENT =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 10000;
const DEFAULT_MAX_SIZE = parseInt(process.env.MAX_RESPONSE_SIZE, 10) || 5 * 1024 * 1024; // 5 MB
const DEFAULT_MAX_REDIRECTS = parseInt(process.env.MAX_REDIRECTS, 10) || 5;

/**
 * Builds realistic browser navigation headers to prevent anti-bot blocking.
 */
function buildBrowserHeaders(targetUrl) {
  const urlObj = new URL(targetUrl);
  return {
    'Host': urlObj.host,
    'User-Agent': DEFAULT_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Connection': 'close'
  };
}

/**
 * Performs a single HTTP or HTTPS request with SSRF validation, size protection, and timing.
 */
function executeSingleRequest(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, maxSize = DEFAULT_MAX_SIZE, logger } = options;
    const urlObj = new URL(targetUrl);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestHeaders = buildBrowserHeaders(targetUrl);
    const startTime = Date.now();

    let timedOut = false;
    let sizeExceeded = false;
    let receivedBytes = 0;
    const chunks = [];

    const reqOptions = {
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: `${urlObj.pathname || '/'}${urlObj.search || ''}`,
      method: 'GET',
      headers: requestHeaders,
      rejectUnauthorized: true
    };

    logger?.http(`Sending HTTP GET to ${urlObj.protocol}//${urlObj.host}${reqOptions.path}`);

    const req = client.request(reqOptions, res => {
      const responseTimeMs = Date.now() - startTime;
      logger?.http(`Received HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage} (${responseTimeMs}ms)`);
      const contentLengthHeader = res.headers['content-length'];

      if (contentLengthHeader && parseInt(contentLengthHeader, 10) > maxSize) {
        req.destroy();
        return reject(new Error(`Response size (${contentLengthHeader} bytes) exceeds maximum allowed limit of ${maxSize} bytes.`));
      }

      // Decompress if gzip/deflate/brotli
      let stream = res;
      const encoding = (res.headers['content-encoding'] || '').toLowerCase();
      const zlib = require('node:zlib');

      if (encoding === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      } else if (encoding === 'br') {
        stream = res.pipe(zlib.createBrotliDecompress());
      }

      stream.on('data', chunk => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxSize) {
          sizeExceeded = true;
          req.destroy();
          stream.destroy();
          return reject(new Error(`Response exceeded maximum size limit of ${maxSize} bytes while streaming.`));
        }
        chunks.push(chunk);
      });

      stream.on('end', () => {
        if (sizeExceeded || timedOut) return;
        const bodyBuffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          httpVersion: res.httpVersion,
          headers: res.headers,
          rawHeaders: res.rawHeaders,
          requestHeaders,
          bodyBuffer,
          bodyText: bodyBuffer.toString('utf8'),
          responseTimeMs,
          contentLength: receivedBytes,
          url: targetUrl
        });
      });

      stream.on('error', err => {
        if (!sizeExceeded && !timedOut) {
          reject(new Error(`Failed to decode response stream: ${err.message}`));
        }
      });
    });

    // Timeout handling
    req.setTimeout(timeoutMs, () => {
      timedOut = true;
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms.`));
    });

    req.on('error', err => {
      if (timedOut) return;
      if (err.code === 'ENOTFOUND') {
        reject(new Error(`DNS resolution failed for ${urlObj.hostname}. Host does not exist.`));
      } else if (err.code === 'ECONNREFUSED') {
        reject(new Error(`Connection refused by host at ${urlObj.hostname}:${urlObj.port || (isHttps ? 443 : 80)}.`));
      } else if (err.code === 'ETIMEDOUT') {
        reject(new Error(`Connection timed out while connecting to ${urlObj.hostname}.`));
      } else if (err.code === 'CERT_HAS_EXPIRED' || err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || (err.message && err.message.includes('certificate'))) {
        reject(new Error(`TLS Certificate validation failed: ${err.message}`));
      } else {
        reject(new Error(`Network request error: ${err.message}`));
      }
    });

    req.end();
  });
}

/**
 * Safely fetches a URL following redirects with SSRF protection and byte limits.
 */
async function safeFetch(rawUrl, options = {}) {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;

  // 1. Initial URL normalization
  const normalized = normalizeUrl(rawUrl);
  if (!normalized.valid) {
    return {
      success: false,
      error: normalized.error
    };
  }

  let currentUrl = normalized.url;
  const redirectChain = [];
  const visitedUrls = new Set([currentUrl]);
  let totalStartTime = Date.now();
  let lastResponse = null;

  const { logger } = options;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    // 2. SSRF & DNS pre-resolution validation on every hop
    const currentParsed = new URL(currentUrl);
    logger?.dns(`Validating host ${currentParsed.hostname} against SSRF and private IP rules...`);
    const dnsValidation = await validateHostnameAndResolve(currentParsed.hostname);
    if (!dnsValidation.valid) {
      logger?.error(`SSRF/DNS security check blocked: ${dnsValidation.error}`);
      return {
        success: false,
        error: dnsValidation.error,
        initialUrl: normalized.url,
        finalUrl: currentUrl,
        redirectChain
      };
    }
    logger?.dns(`Host ${currentParsed.hostname} verified: resolved to ${dnsValidation.ip} (Public & Valid)`);

    try {
      lastResponse = await executeSingleRequest(currentUrl, { timeoutMs, maxSize, logger });
    } catch (err) {
      logger?.error(`Network fetch failed on hop ${hop}: ${err.message}`);
      return {
        success: false,
        error: err.message,
        initialUrl: normalized.url,
        finalUrl: currentUrl,
        redirectChain
      };
    }

    const statusCode = lastResponse.statusCode;
    const isRedirect = [301, 302, 303, 307, 308].includes(statusCode);

    if (isRedirect && lastResponse.headers.location) {
      logger?.http(`Received redirect ${statusCode} -> Location: ${lastResponse.headers.location}`);
      if (hop === maxRedirects) {
        return {
          success: false,
          error: `Maximum redirect limit of ${maxRedirects} exceeded.`,
          initialUrl: normalized.url,
          finalUrl: currentUrl,
          redirectChain
        };
      }

      // Resolve relative location URLs against currentUrl
      let nextUrl;
      try {
        nextUrl = new URL(lastResponse.headers.location, currentUrl).href;
      } catch (err) {
        return {
          success: false,
          error: `Invalid redirect Location header: ${lastResponse.headers.location}`,
          initialUrl: normalized.url,
          finalUrl: currentUrl,
          redirectChain
        };
      }

      // Detect redirect loops
      if (visitedUrls.has(nextUrl)) {
        redirectChain.push({
          hop: hop + 1,
          fromUrl: currentUrl,
          toUrl: nextUrl,
          statusCode,
          statusText: lastResponse.statusMessage,
          location: lastResponse.headers.location,
          responseTimeMs: lastResponse.responseTimeMs
        });
        return {
          success: false,
          error: `Redirect loop detected at ${nextUrl}.`,
          initialUrl: normalized.url,
          finalUrl: nextUrl,
          redirectChain
        };
      }

      visitedUrls.add(nextUrl);
      redirectChain.push({
        hop: hop + 1,
        fromUrl: currentUrl,
        toUrl: nextUrl,
        statusCode,
        statusText: lastResponse.statusMessage,
        location: lastResponse.headers.location,
        responseTimeMs: lastResponse.responseTimeMs
      });

      currentUrl = nextUrl;
      continue;
    }

    // Non-redirect response reached
    break;
  }

  const totalResponseTimeMs = Date.now() - totalStartTime;
  const contentTypeRaw = lastResponse.headers['content-type'] || '';
  const contentType = contentTypeRaw.split(';')[0].trim().toLowerCase();
  const isHtml = contentType === 'text/html' || contentType === 'application/xhtml+xml';

  return {
    success: true,
    initialUrl: normalized.url,
    finalUrl: currentUrl,
    statusCode: lastResponse.statusCode,
    statusText: lastResponse.statusMessage,
    httpVersion: lastResponse.httpVersion,
    headers: lastResponse.headers,
    rawHeaders: lastResponse.rawHeaders,
    requestHeaders: lastResponse.requestHeaders,
    body: lastResponse.bodyText,
    contentLength: lastResponse.contentLength,
    contentType,
    contentTypeRaw,
    isHtml,
    responseTimeMs: totalResponseTimeMs,
    hopResponseTimeMs: lastResponse.responseTimeMs,
    redirectChain
  };
}

module.exports = {
  safeFetch,
  DEFAULT_USER_AGENT,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_SIZE,
  DEFAULT_MAX_REDIRECTS
};
