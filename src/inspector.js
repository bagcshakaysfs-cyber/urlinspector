const { safeFetch } = require('./fetcher');
const { parseHtml } = require('./parser');
const { analyzeSeo } = require('./seo-analyzer');
const { analyzeSecurityHeaders, parseAndMaskCookies } = require('./security-headers');
const { getDnsInfo } = require('./dns');
const { getTlsInfo } = require('./tls');

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
 */
async function inspectWebsite(rawUrl) {
  const startTime = Date.now();

  // 1. Fetch website safely with SSRF protections, browser User-Agent, and redirect tracking
  const fetchResult = await safeFetch(rawUrl);

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

  // 2. Parallel secondary inspections: DNS, TLS, HTML parsing
  const [dnsResult, tlsResult] = await Promise.all([
    getDnsInfo(finalUrlObj.hostname),
    isHttps ? getTlsInfo(finalUrlObj.hostname, finalUrlObj.port ? parseInt(finalUrlObj.port, 10) : 443) : Promise.resolve(null)
  ]);

  // 3. Parse HTML and perform SEO analysis if content is HTML
  let parsedHtml = null;
  let seoReport = null;

  if (isHtml && body) {
    parsedHtml = parseHtml(body, finalUrl);
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
    nonHtmlNotice: !isHtml ? `The server returned '${contentType || 'unknown'}'. HTML structure inspection is only available for HTML resources.` : null,
    html: parsedHtml,
    seo: seoReport,
    security: {
      ...securityHeaders,
      cookies
    },
    dns: dnsResult,
    tls: tlsResult,
    rawHtml: isHtml ? body : null
  };
}

module.exports = {
  inspectWebsite,
  getStatusCategory
};
