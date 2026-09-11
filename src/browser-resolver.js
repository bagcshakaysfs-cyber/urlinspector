const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');
const puppeteer = require('puppeteer');

let cachedExecutablePath = null;

/**
 * Checks whether a file path exists and is a regular file.
 *
 * @param {string} targetPath
 * @returns {boolean}
 */
function isExecutableFile(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return false;
  try {
    const stat = fs.statSync(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Search PATH using where (Windows) or which (POSIX).
 *
 * @returns {string|null}
 */
function findInSystemPath() {
  const isWindows = process.platform === 'win32';
  const commands = isWindows
    ? ['where.exe chrome.exe', 'where.exe msedge.exe', 'where.exe brave.exe']
    : ['which chromium', 'which chromium-browser', 'which google-chrome', 'which google-chrome-stable', 'which chrome'];

  for (const cmd of commands) {
    try {
      const output = execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8', timeout: 3000 });
      const lines = output.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      for (const line of lines) {
        if (isExecutableFile(line)) {
          return line;
        }
      }
    } catch {
      // Command failed or binary not found in PATH
    }
  }
  return null;
}

/**
 * Synchronously checks known candidate paths and system PATH for Chrome/Chromium/Edge.
 * Evaluates candidate paths dynamically at call-time.
 *
 * @returns {string|null}
 */
function findSystemBrowserExecutableSync() {
  if (cachedExecutablePath && isExecutableFile(cachedExecutablePath)) {
    return cachedExecutablePath;
  }

  // 1. Explicit environment variables
  const envCandidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH
  ].filter(Boolean);

  for (const candidate of envCandidates) {
    if (isExecutableFile(candidate)) {
      cachedExecutablePath = candidate;
      return candidate;
    }
  }

  // 2. Dynamic PATH binaries
  const pathMatch = findInSystemPath();
  if (pathMatch) {
    cachedExecutablePath = pathMatch;
    return pathMatch;
  }

  // 3. Known filesystem candidates across OSes
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

  const candidatePaths = [
    // Windows Chrome & Edge (both 64-bit and 32-bit and per-user installs)
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    localAppData ? path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : null,
    path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    localAppData ? path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') : null,

    // Linux & Alpine
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome-beta',
    '/usr/bin/google-chrome-unstable',
    '/usr/bin/chrome',
    '/snap/bin/chromium',
    '/var/lib/snapd/snap/bin/chromium',
    '/usr/lib/chromium/chromium',
    '/usr/lib/chromium-browser/chromium-browser',

    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
  ].filter(Boolean);

  for (const candidate of candidatePaths) {
    if (isExecutableFile(candidate)) {
      cachedExecutablePath = candidate;
      return candidate;
    }
  }

  return null;
}

/**
 * Asynchronously and comprehensively resolves a browser executable:
 * 1. Checks system browser candidates & system PATH
 * 2. Checks Puppeteer's internal executablePath()
 * 3. Checks Puppeteer's local cache directories (~/.cache/puppeteer, /app/.cache/puppeteer, ./cache/puppeteer)
 * 4. If missing, attempts automatic on-demand download via @puppeteer/browsers
 * 5. Returns verified absolute path or throws actionable error
 *
 * @param {object} [options]
 * @param {boolean} [options.autoInstall=true]
 * @returns {Promise<string>}
 */
async function resolveBrowserExecutable(options = {}) {
  if (cachedExecutablePath && isExecutableFile(cachedExecutablePath)) {
    return cachedExecutablePath;
  }

  // 1. Try system executable (covers ENV vars, PATH, standard system dirs)
  const sysPath = findSystemBrowserExecutableSync();
  if (sysPath) {
    cachedExecutablePath = sysPath;
    return sysPath;
  }

  // 2. Try Puppeteer's built-in resolution (async in Puppeteer 25+)
  try {
    if (typeof puppeteer.executablePath === 'function') {
      const pPath = await puppeteer.executablePath();
      if (isExecutableFile(pPath)) {
        cachedExecutablePath = pPath;
        return pPath;
      }
    }
  } catch {
    // Ignore puppeteer.executablePath error
  }

  // 3. Inspect known cache directories using @puppeteer/browsers
  let browsersPkg;
  try {
    browsersPkg = require('@puppeteer/browsers');
  } catch {}

  const cacheDirs = [
    process.env.PUPPETEER_CACHE_DIR,
    path.join(os.homedir(), '.cache', 'puppeteer'),
    '/app/.cache/puppeteer',
    path.join(process.cwd(), '.cache', 'puppeteer')
  ].filter(Boolean);

  if (browsersPkg && browsersPkg.getInstalledBrowsers) {
    for (const cacheDir of cacheDirs) {
      try {
        const list = await browsersPkg.getInstalledBrowsers({ cacheDir });
        for (const item of list) {
          if (item && item.executablePath && isExecutableFile(item.executablePath)) {
            cachedExecutablePath = item.executablePath;
            return item.executablePath;
          }
        }
      } catch {
        // Cache dir may not exist or not readable
      }
    }
  }

  // 4. Attempt automatic on-demand download if allowed (defaults to true)
  if (options.autoInstall !== false && browsersPkg && browsersPkg.install) {
    try {
      console.warn('[Browser Resolver] No Chromium executable detected. Auto-installing Chrome for testing...');
      const targetCache = process.env.PUPPETEER_CACHE_DIR || cacheDirs[0] || path.join(os.homedir(), '.cache', 'puppeteer');
      const platform = browsersPkg.detectBrowserPlatform ? browsersPkg.detectBrowserPlatform() : undefined;
      const buildId = puppeteer.PUPPETEER_REVISIONS?.chrome || '152.0.7977.75';

      const installed = await browsersPkg.install({
        browser: browsersPkg.Browser.CHROME,
        buildId,
        cacheDir: targetCache,
        platform
      });

      if (installed && installed.executablePath && isExecutableFile(installed.executablePath)) {
        cachedExecutablePath = installed.executablePath;
        console.log(`[Browser Resolver] Successfully installed Chrome at ${installed.executablePath}`);
        return installed.executablePath;
      }
    } catch (installErr) {
      console.error('[Browser Resolver] Auto-install attempt failed:', installErr.message);
    }
  }

  // 5. If everything fails, throw an informative, actionable error
  const errMsg = [
    'Failed to locate or initialize a Chrome / Chromium executable.',
    '',
    'Inspected locations:',
    ' - Environment variables: PUPPETEER_EXECUTABLE_PATH, CHROME_PATH',
    ' - System PATH (where/which chrome, chromium, msedge)',
    ' - Standard OS installation directories (Windows ProgramFiles/AppData, Linux /usr/bin, macOS Applications)',
    ` - Puppeteer caches: ${cacheDirs.join(', ')}`,
    '',
    'How to resolve:',
    ' 1. Install Chrome for Puppeteer: run `npx puppeteer browsers install chrome`',
    ' 2. Or install system Chromium (Alpine: `apk add chromium`, Debian/Ubuntu: `apt-get install -y chromium-browser`)',
    ' 3. Or set PUPPETEER_EXECUTABLE_PATH pointing directly to your browser binary.'
  ].join('\n');

  throw new Error(errMsg);
}

module.exports = {
  resolveBrowserExecutable,
  findSystemBrowserExecutable: findSystemBrowserExecutableSync,
  isExecutableFile
};
