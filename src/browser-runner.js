const puppeteer = require('puppeteer');
const fs = require('node:fs');
const { normalizeUrl, validateHostnameAndResolve } = require('./url-validator');

// Common executable paths for system Chrome / Chromium / Edge across OSes
const CANDIDATE_PATHS = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  // Windows
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  // Linux & Alpine
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome-stable',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

/**
 * Finds the first usable browser executable on the host system.
 */
function findSystemBrowserExecutable() {
  for (const candidate of CANDIDATE_PATHS) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore permission or stat errors
    }
  }
  return null;
}

/**
 * Executes a dynamic inspection using a headless browser.
 * Renders client-side JavaScript (React, Vue, Angular, Next.js), captures live DOM,
 * screenshot, console errors, and intercepted background API calls.
 *
 * @param {string} rawUrl Website URL to inspect
 * @param {object} options Optional settings
 */
async function runDynamicInspection(rawUrl, options = {}) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized.valid) {
    return { success: false, error: normalized.error };
  }

  const targetUrl = normalized.url;
  const parsedUrl = new URL(targetUrl);

  // SSRF guard
  const dnsCheck = await validateHostnameAndResolve(parsedUrl.hostname);
  if (!dnsCheck.valid) {
    return { success: false, error: dnsCheck.error };
  }

  const timeoutMs = options.timeoutMs || 10000;
  const startTime = Date.now();
  const logger = options.logger;

  const apiCalls = [];
  const consoleMessages = [];
  let browser = null;

  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--disable-extensions'
    ]
  };

  // If system executable exists, provide it as fallback
  const systemExecutable = findSystemBrowserExecutable();
  if (systemExecutable) {
    launchOptions.executablePath = systemExecutable;
  }

  try {
    logger?.browser(`Launching Headless Chromium (Executable: ${systemExecutable ? 'System Chrome' : 'Bundled Chromium'})...`);
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 800 });
    logger?.browser('Configured viewport: 1280x800 (DPR: 1.0, Stealth User-Agent)');
    await page.setUserAgent(
      process.env.USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 WebInspector/1.0'
    );

    // Track network requests (load all resources without aborting)
    page.on('request', request => {
      const resourceType = request.resourceType();
      const reqUrl = request.url();
      if (resourceType === 'xhr' || resourceType === 'fetch') {
        logger?.api(`Outgoing [${request.method()}] ${reqUrl.substring(0, 120)}`);
        if (apiCalls.length < 50) {
          apiCalls.push({
            url: reqUrl,
            method: request.method(),
            resourceType
          });
        }
      } else {
        logger?.network(`Loading [${resourceType.toUpperCase()}]: ${reqUrl.substring(0, 100)}`);
      }
    });

    page.on('response', response => {
      const req = response.request();
      const resourceType = req.resourceType();
      if (resourceType === 'xhr' || resourceType === 'fetch') {
        const match = apiCalls.find(a => a.url === req.url() && a.status === undefined);
        if (match) {
          match.status = response.status();
        }
        logger?.api(`Completed [${req.method()}] ${response.status()} <- ${req.url().substring(0, 120)}`);
      }
    });

    // Track console messages and errors
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text().substring(0, 200);
      if (type === 'error') {
        logger?.error(`Browser Console [${type}]: ${text}`);
      } else if (type === 'warning') {
        logger?.warn(`Browser Console [${type}]: ${text}`);
      }
      if (type === 'error' || type === 'warning') {
        if (consoleMessages.length < 25) {
          consoleMessages.push({ type, text });
        }
      }
    });

    page.on('pageerror', err => {
      logger?.error(`Runtime JavaScript Exception: ${err.message.substring(0, 200)}`);
      if (consoleMessages.length < 25) {
        consoleMessages.push({
          type: 'runtime_error',
          text: err.message.substring(0, 200)
        });
      }
    });

    logger?.browser(`Navigating to ${targetUrl} (waiting for network & client JS execution)...`);
    // Navigate and wait for DOM and background tasks to settle
    let navResponse;
    try {
      navResponse = await page.goto(targetUrl, {
        waitUntil: ['domcontentloaded', 'networkidle2'],
        timeout: timeoutMs
      });
    } catch {
      logger?.warn('Navigation timeout reached for networkidle2; continuing with hydrated DOM');
    }

    const statusCode = navResponse ? navResponse.status() : 200;
    const finalUrl = page.url();
    logger?.browser(`Page navigation completed: HTTP ${statusCode} -> Final URL: ${finalUrl}`);

    // Extract rendered DOM
    const renderedHtml = await page.content();
    logger?.dom(`Extracted client-side rendered DOM (${(renderedHtml.length / 1024).toFixed(1)} KB)`);

    // Capture screenshot
    let screenshotBase64 = null;
    try {
      screenshotBase64 = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        encoding: 'base64'
      });
      logger?.browser('Captured viewport preview screenshot (1280x800 JPEG)');
    } catch {
      logger?.warn('Viewport screenshot capture encountered an error; continuing without preview');
    }

    const durationMs = Date.now() - startTime;
    logger?.done(`Chromium execution finished in ${(durationMs / 1000).toFixed(2)}s`);

    return {
      success: true,
      mode: 'dynamic',
      initialUrl: targetUrl,
      finalUrl,
      statusCode,
      renderedHtml,
      screenshot: screenshotBase64 ? `data:image/jpeg;base64,${screenshotBase64}` : null,
      apiCalls,
      consoleMessages,
      durationMs
    };
  } catch (err) {
    return {
      success: false,
      error: `Dynamic browser inspection failed: ${err.message}`
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore browser close error
      }
    }
  }
}

module.exports = {
  runDynamicInspection,
  findSystemBrowserExecutable
};
