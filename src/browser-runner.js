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
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      process.env.USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 WebInspector/1.0'
    );

    // Track network API calls (fetch & XHR)
    page.on('request', request => {
      const resourceType = request.resourceType();
      if (resourceType === 'xhr' || resourceType === 'fetch') {
        const reqUrl = request.url();
        // Avoid bloating with endless analytics pings
        if (apiCalls.length < 50) {
          apiCalls.push({
            url: reqUrl,
            method: request.method(),
            resourceType
          });
        }
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
      }
    });

    // Track console messages and errors
    page.on('console', msg => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        if (consoleMessages.length < 25) {
          consoleMessages.push({
            type,
            text: msg.text().substring(0, 200)
          });
        }
      }
    });

    page.on('pageerror', err => {
      if (consoleMessages.length < 25) {
        consoleMessages.push({
          type: 'runtime_error',
          text: err.message.substring(0, 200)
        });
      }
    });

    // Navigate and wait for DOM and background tasks to settle
    let navResponse;
    try {
      navResponse = await page.goto(targetUrl, {
        waitUntil: ['domcontentloaded', 'networkidle2'],
        timeout: timeoutMs
      });
    } catch {
      // If networkidle2 timed out, try to get whatever DOM rendered before timeout
    }

    const statusCode = navResponse ? navResponse.status() : 200;
    const finalUrl = page.url();

    // Extract rendered DOM
    const renderedHtml = await page.content();

    // Capture screenshot
    let screenshotBase64 = null;
    try {
      screenshotBase64 = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        encoding: 'base64'
      });
    } catch {
      // Screenshot failed, continue without screenshot
    }

    const durationMs = Date.now() - startTime;

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
