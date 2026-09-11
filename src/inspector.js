const { safeFetch } = require('./fetcher');
const { parseHtml } = require('./parser');
const { analyzeSeo } = require('./seo-analyzer');
const { analyzeSecurityHeaders, parseAndMaskCookies } = require('./security-headers');
const { getDnsInfo } = require('./dns');
const { getTlsInfo } = require('./tls');
const { runDynamicInspection } = require('./browser-runner');

/**
 * Categorizes an HTTP status code into user-friendly status types.
 */
function getStatusCategory(statusCode) {
  if (!statusCode) return 'error';
  if (statusCode >= 200 && statusCode < 300) return 'success';
  if (statusCode >= 300 && statusCode < 400) return 'redirect';
  if (statusCode >= 400 && statusCode < 500) return 'client_error';
  if (statusCode >= 500 && statusCode < 600) return 'server_error';
  return 'unknown';
}

/**
 * Main inspection orchestrator.
 * Supports both Fast HTTP mode (cURL / HTTP fetch) and Dynamic Browser mode (Headless Chromium).
 *
 * @param {string} rawUrl Target URL
 * @param {object} options Optional settings { mode: 'fast' | 'dynamic' }
 */
async function inspectWebsite(rawUrl, options = {}) {
  const startTime = Date.now();
  const mode = options.mode || 'fast';

  // 1. Fetch website safely with SSRF protections, browser User-Agent, and redirect tracking
  const fetchPromise = safeFetch(rawUrl);

  // If dynamic mode requested, run headless browser alongside or after
  let dynamicPromise = Promise.resolve(null);
  if (mode === 'dynamic') {
    dynamicPromise = runDynamicInspection(rawUrl, { timeoutMs: 10000 });
  }

  const [fetchResult, dynamicResult] = await Promise.all([
    fetchPromise,
    dynamicPromise
  ]);

  if (!fetchResult.success) {
    return {
      success: false,
      url: rawUrl,
      finalUrl: fetchResult.finalUrl || rawUrl,
      error: fetchResult.error || 'Inspection failed: unable to fetch resource.',
      redirects: fetchResult.redirectChain || [],
      responseTime: Date.now() - startTime
    };
  }

  const {
    initialUrl,
    finalUrl,
    statusCode,
    statusText,
    httpVersion,
    headers,
    rawHeaders,
    requestHeaders,
    body,
    contentLength,
    contentType,
    contentTypeRaw,
    isHtml,
    responseTimeMs,
    hopResponseTimeMs,
    redirectChain
  } = fetchResult;

  const finalUrlObj = new URL(finalUrl);
  const isHttps = finalUrlObj.protocol === 'https:';

  // 2. Parallel secondary inspections: DNS, TLS
  const [dnsResult, tlsResult] = await Promise.all([
    getDnsInfo(finalUrlObj.hostname),
    isHttps ? getTlsInfo(finalUrlObj.hostname, finalUrlObj.port ? parseInt(finalUrlObj.port, 10) : 443) : Promise.resolve(null)
  ]);

  // Determine which HTML payload to parse:
  // In dynamic mode, use rendered DOM if available; otherwise use server HTML
  let htmlToParse = body;
  let isDynamicEffective = false;
  let dynamicMeta = null;

  if (mode === 'dynamic' && dynamicResult) {
    if (dynamicResult.success && dynamicResult.renderedHtml) {
      htmlToParse = dynamicResult.renderedHtml;
      isDynamicEffective = true;
      dynamicMeta = {
        enabled: true,
        screenshot: dynamicResult.screenshot,
        apiCalls: dynamicResult.apiCalls || [],
        consoleMessages: dynamicResult.consoleMessages || [],
        durationMs: dynamicResult.durationMs
      };
    } else {
      dynamicMeta = {
        enabled: false,
        error: dynamicResult.error || 'Dynamic browser execution failed. Falling back to server HTML.'
      };
    }
  }

  // 3. Parse HTML and perform SEO analysis
  let parsedHtml = null;
  let seoReport = null;

  if ((isHtml || isDynamicEffective) && htmlToParse) {
    parsedHtml = parseHtml(htmlToParse, finalUrl);
    if (parsedHtml) {
      seoReport = analyzeSeo(parsedHtml, finalUrl);
    }
  }

  // 4. Analyze Security Headers and Cookies
  const securityHeaders = analyzeSecurityHeaders(headers);
  const cookies = parseAndMaskCookies(headers);

  // Server identifier
  const serverHeader = headers['server'] || 'Not disclosed';

  return {
    success: true,
    mode: isDynamicEffective ? 'dynamic' : 'fast',
    url: initialUrl,
    finalUrl,
    status: {
      code: statusCode,
      text: statusText || 'OK',
      category: getStatusCategory(statusCode),
      httpVersion: httpVersion ? `HTTP/${httpVersion}` : 'HTTP/1.1'
    },
    responseTime: responseTimeMs,
    hopResponseTime: hopResponseTimeMs,
    protocol: isHttps ? 'HTTPS' : 'HTTP',
    contentType,
    contentTypeRaw,
    contentLength,
    server: serverHeader,
    redirects: redirectChain,
    headers,
    rawHeaders,
    requestHeaders,
    cookies,
    isHtml,
    nonHtmlNotice: (!isHtml && !isDynamicEffective) ? `The server returned '${contentType || 'unknown'}'. HTML structure inspection is only available for HTML resources.` : null,
    html: parsedHtml,
    seo: seoReport,
    security: {
      ...securityHeaders,
      cookies
    },
    dns: dnsResult,
    tls: tlsResult,
    rawHtml: (isHtml || isDynamicEffective) ? htmlToParse : null,
    dynamic: dynamicMeta
  };
}

module.exports = {
  inspectWebsite,
  getStatusCategory
};
