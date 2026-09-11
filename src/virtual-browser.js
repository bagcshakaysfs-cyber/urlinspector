const puppeteer = require('puppeteer');
const { URL } = require('node:url');
const { normalizeUrl, validateHostnameAndResolve } = require('./url-validator');
const { resolveBrowserExecutable, findSystemBrowserExecutable } = require('./browser-resolver');

let sharedBrowser = null;
let browserLaunchPromise = null;

/**
 * Gets or initializes the shared Headless Chromium browser instance.
 */
async function getSharedBrowser() {
  if (sharedBrowser && sharedBrowser.connected) {
    return sharedBrowser;
  }

  if (browserLaunchPromise) {
    return browserLaunchPromise;
  }

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

  browserLaunchPromise = (async () => {
    try {
      const executablePath = await resolveBrowserExecutable();
      if (executablePath) {
        launchOptions.executablePath = executablePath;
        console.log(`[Virtual Browser] Launching Chromium with executable: ${executablePath}`);
      }

      const b = await puppeteer.launch(launchOptions);
      sharedBrowser = b;
      browserLaunchPromise = null;

      b.on('disconnected', () => {
        sharedBrowser = null;
      });

      return b;
    } catch (err) {
      browserLaunchPromise = null;
      console.error('[Virtual Browser] Browser launch failed:', err.message);
      throw err;
    }
  })();

  return browserLaunchPromise;
}

/**
 * Formats byte size into human readable string.
 */
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Formats initiator object from CDP into a clean label like "inject.js:4".
 */
function formatInitiator(initiator) {
  if (!initiator) return 'Other';
  if (initiator.type === 'parser') return '(index)';
  if (initiator.type === 'script') {
    if (initiator.stack && initiator.stack.callFrames && initiator.stack.callFrames.length > 0) {
      const frame = initiator.stack.callFrames[0];
      let scriptName = 'script';
      try {
        if (frame.url) {
          const u = new URL(frame.url);
          scriptName = u.pathname.split('/').pop() || u.hostname;
        }
      } catch {
        scriptName = frame.url ? frame.url.split('/').pop() : 'script';
      }
      return `${scriptName}:${frame.lineNumber || 1}`;
    }
    return 'script';
  }
  return initiator.type ? initiator.type.charAt(0).toUpperCase() + initiator.type.slice(1) : 'Other';
}

/**
 * Manages an individual interactive Virtual Browser Sandbox session.
 */
class VirtualSession {
  constructor(ws, targetUrl) {
    this.ws = ws;
    this.targetUrl = targetUrl;
    this.context = null;
    this.page = null;
    this.cdp = null;
    this.isDestroyed = false;
    this.initialDocLoaded = false;
    this.staticUrlPrefixes = new Set();
    this.requests = new Map();
    this.inactivityTimer = null;
    this.resetInactivityTimeout();
  }

  resetInactivityTimeout() {
    clearTimeout(this.inactivityTimer);
    // Auto-close session after 5 minutes of total inactivity to prevent resource leaks
    this.inactivityTimer = setTimeout(() => {
      this.send({ type: 'error', message: 'Session closed due to inactivity (5-minute limit).' });
      this.destroy();
    }, 5 * 60 * 1000);
  }

  send(data) {
    if (this.ws && this.ws.readyState === 1 && !this.isDestroyed) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch {
        // Ignore socket send errors
      }
    }
  }

  /**
   * Initializes the session, browser page, CDP protocol hooks, and screencasting.
   */
  async init() {
    try {
      this.send({ type: 'status', message: 'Verifying security and SSRF rules...' });

      const normalized = normalizeUrl(this.targetUrl);
      if (!normalized.valid) {
        this.send({ type: 'error', message: `Invalid target URL: ${normalized.error}` });
        this.destroy();
        return;
      }

      this.targetUrl = normalized.url;
      const parsed = new URL(this.targetUrl);

      // SSRF validation
      const dnsCheck = await validateHostnameAndResolve(parsed.hostname);
      if (!dnsCheck.valid) {
        this.send({ type: 'error', message: `SSRF Security Block: ${dnsCheck.error}` });
        this.destroy();
        return;
      }

      this.send({ type: 'status', message: 'Launching isolated browser sandbox...' });
      const browser = await getSharedBrowser();
      this.context = await browser.createBrowserContext();
      this.page = await this.context.newPage();

      await this.page.setViewport({ width: 1280, height: 800 });
      await this.page.setUserAgent(
        process.env.USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 WebInspector/1.0'
      );

      // Attach Chrome DevTools Protocol (CDP) session
      this.cdp = await this.page.createCDPSession();

      // Enable CDP domains
      await this.cdp.send('Page.enable');
      await this.cdp.send('Network.enable', {
        maxTotalBufferSize: 10 * 1024 * 1024,
        maxResourceBufferSize: 5 * 1024 * 1024
      });

      // Hook Screencast frames
      this.cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
        if (this.isDestroyed) return;
        this.send({ type: 'frame', data, metadata });
        try {
          await this.cdp.send('Page.screencastFrameAck', { sessionId });
        } catch {
          // Ignore ack errors
        }
      });

      // Hook Network Events
      this.setupNetworkHooks();

      // Hook Page Navigated
      this.page.on('framenavigated', async frame => {
        if (frame === this.page.mainFrame() && !this.isDestroyed) {
          const url = frame.url();
          let title = '';
          try { title = await this.page.title(); } catch {}
          this.send({ type: 'navigated', url, title });
        }
      });

      // Start Screencast at 1280x800 with 75% JPEG quality
      await this.cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 75,
        maxWidth: 1280,
        maxHeight: 800,
        everyNthFrame: 1
      });

      this.send({ type: 'status', message: `Navigating to ${this.targetUrl}...` });

      // Navigate
      await this.page.goto(this.targetUrl, {
        waitUntil: ['domcontentloaded'],
        timeout: 15000
      }).catch(err => {
        this.send({ type: 'warn', message: `Navigation notice: ${err.message}` });
      });

      // After DOMContentLoaded, mark baseline loaded so subsequent requests are tagged Dynamic-Only
      setTimeout(() => {
        this.initialDocLoaded = true;
      }, 1000);

      this.send({ type: 'ready', url: this.page.url() });

    } catch (err) {
      this.send({ type: 'error', message: `Failed to initialize virtual browser: ${err.message}` });
      this.destroy();
    }
  }

  /**
   * Sets up DevTools Protocol Network hooks for real-time live request tracking.
   */
  setupNetworkHooks() {
    this.cdp.on('Network.requestWillBeSent', params => {
      if (this.isDestroyed) return;
      const { requestId, request, initiator, type, timestamp } = params;

      let name = 'request';
      try {
        const u = new URL(request.url);
        name = u.pathname.split('/').pop() || u.hostname;
        if (u.search) name += u.search.substring(0, 30);
      } catch {
        name = request.url.substring(0, 40);
      }

      const isDynamicOnly = this.initialDocLoaded;

      const entry = {
        id: requestId,
        name: name || request.url,
        url: request.url,
        method: request.method,
        resourceType: type ? type.toLowerCase() : 'other',
        initiator: formatInitiator(initiator),
        startTime: timestamp,
        status: null,
        size: 'Pending',
        time: 'Pending',
        isDynamicOnly,
        requestHeaders: request.headers || {}
      };

      this.requests.set(requestId, entry);

      this.send({
        type: 'network_event',
        action: 'start',
        payload: {
          id: entry.id,
          name: entry.name,
          url: entry.url,
          method: entry.method,
          resourceType: entry.resourceType,
          initiator: entry.initiator,
          status: 'Pending',
          size: entry.size,
          time: entry.time,
          isDynamicOnly: entry.isDynamicOnly
        }
      });
    });

    this.cdp.on('Network.responseReceived', params => {
      if (this.isDestroyed) return;
      const { requestId, response, type } = params;
      const entry = this.requests.get(requestId);
      if (entry) {
        entry.status = response.status;
        entry.statusText = response.statusText;
        entry.mimeType = response.mimeType;
        if (type) entry.resourceType = type.toLowerCase();
        entry.responseHeaders = response.headers || {};
        entry.remoteIPAddress = response.remoteIPAddress;

        this.send({
          type: 'network_event',
          action: 'response',
          payload: {
            id: entry.id,
            status: entry.status,
            resourceType: entry.resourceType
          }
        });
      }
    });

    this.cdp.on('Network.loadingFinished', params => {
      if (this.isDestroyed) return;
      const { requestId, encodedDataLength, timestamp } = params;
      const entry = this.requests.get(requestId);
      if (entry) {
        const durationMs = entry.startTime ? Math.max(1, Math.round((timestamp - entry.startTime) * 1000)) : 0;
        const formattedTime = durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)} s` : `${durationMs} ms`;
        const formattedSize = formatSize(encodedDataLength);

        entry.size = formattedSize;
        entry.time = formattedTime;
        entry.durationMs = durationMs;

        this.send({
          type: 'network_event',
          action: 'complete',
          payload: {
            id: entry.id,
            status: entry.status || 200,
            size: formattedSize,
            time: formattedTime,
            isDynamicOnly: entry.isDynamicOnly,
            requestHeaders: entry.requestHeaders,
            responseHeaders: entry.responseHeaders
          }
        });
      }
    });

    this.cdp.on('Network.loadingFailed', params => {
      if (this.isDestroyed) return;
      const { requestId, errorText, canceled } = params;
      const entry = this.requests.get(requestId);
      if (entry) {
        entry.status = canceled ? 0 : 'Failed';
        entry.time = 'Failed';
        entry.size = '0 B';

        this.send({
          type: 'network_event',
          action: 'complete',
          payload: {
            id: entry.id,
            status: canceled ? 'Canceled' : 'Failed',
            size: '0 B',
            time: 'Failed',
            errorText,
            isDynamicOnly: entry.isDynamicOnly
          }
        });
      }
    });
  }

  /**
   * Dispatches user interaction events (clicks, moves, keystrokes, scroll) directly into Chromium.
   */
  async handleClientInput(msg) {
    if (this.isDestroyed || !this.cdp) return;
    this.resetInactivityTimeout();

    try {
      switch (msg.action) {
        case 'mouse_click':
        case 'mouse_down':
        case 'mouse_up': {
          const type = msg.action === 'mouse_click' ? 'mousePressed' : (msg.action === 'mouse_down' ? 'mousePressed' : 'mouseReleased');
          await this.cdp.send('Input.dispatchMouseEvent', {
            type,
            x: Math.round(msg.x),
            y: Math.round(msg.y),
            button: msg.button || 'left',
            clickCount: msg.clickCount || 1
          });
          if (msg.action === 'mouse_click') {
            await this.cdp.send('Input.dispatchMouseEvent', {
              type: 'mouseReleased',
              x: Math.round(msg.x),
              y: Math.round(msg.y),
              button: msg.button || 'left',
              clickCount: 1
            });
          }
          break;
        }

        case 'mouse_move': {
          await this.cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: Math.round(msg.x),
            y: Math.round(msg.y)
          });
          break;
        }

        case 'mouse_wheel': {
          await this.cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: Math.round(msg.x || 0),
            y: Math.round(msg.y || 0),
            deltaX: Math.round(msg.deltaX || 0),
            deltaY: Math.round(msg.deltaY || 0)
          });
          break;
        }

        case 'key_down':
        case 'key_up': {
          const type = msg.action === 'key_down' ? 'keyDown' : 'keyUp';
          await this.cdp.send('Input.dispatchKeyEvent', {
            type,
            text: msg.text || undefined,
            unmodifiedText: msg.text || undefined,
            key: msg.key,
            code: msg.code,
            windowsVirtualKeyCode: msg.keyCode
          });
          break;
        }

        case 'navigate': {
          if (msg.url) {
            const norm = normalizeUrl(msg.url);
            if (!norm.valid) {
              this.send({ type: 'warn', message: `Invalid navigation URL: ${norm.error}` });
              break;
            }
            try {
              const parsedNav = new URL(norm.url);
              const dnsCheck = await validateHostnameAndResolve(parsedNav.hostname);
              if (!dnsCheck.valid) {
                this.send({ type: 'warn', message: `SSRF Security Block: ${dnsCheck.error}` });
                break;
              }
              this.targetUrl = norm.url;
              this.send({ type: 'status', message: `Navigating to ${norm.url}...` });
              await this.page.goto(norm.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(err => {
                this.send({ type: 'warn', message: `Navigation notice: ${err.message}` });
              });
            } catch (err) {
              this.send({ type: 'warn', message: `Navigation error: ${err.message}` });
            }
          }
          break;
        }

        case 'reload': {
          await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          break;
        }

        case 'back': {
          await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
          break;
        }

        case 'forward': {
          await this.page.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
          break;
        }
      }
    } catch {
      // Ignore input dispatch race conditions during navigation
    }
  }

  /**
   * Gracefully tears down the session and frees browser resources.
   */
  async destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    clearTimeout(this.inactivityTimer);

    if (this.cdp) {
      try {
        await this.cdp.send('Page.stopScreencast');
      } catch {}
      try {
        await this.cdp.detach();
      } catch {}
      this.cdp = null;
    }

    if (this.page) {
      try {
        await this.page.close();
      } catch {}
      this.page = null;
    }

    if (this.context) {
      try {
        await this.context.close();
      } catch {}
      this.context = null;
    }

    if (this.ws) {
      try {
        if (this.ws.readyState === 1) {
          this.ws.close();
        }
      } catch {}
      this.ws = null;
    }
  }
}

/**
 * Global Manager for handling incoming WebSocket connections.
 */
class VirtualBrowserManager {
  static handleConnection(ws, req) {
    const parsedUrl = new URL(req.url, 'http://localhost');
    let targetUrl = parsedUrl.searchParams.get('url');

    if (!targetUrl) {
      ws.send(JSON.stringify({ type: 'error', message: 'Missing target URL parameter (?url=https://example.com)' }));
      ws.close();
      return;
    }

    targetUrl = targetUrl.trim();
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(targetUrl)) {
      targetUrl = targetUrl.startsWith('//') ? `https:${targetUrl}` : `https://${targetUrl}`;
    }

    const session = new VirtualSession(ws, targetUrl);

    ws.on('message', data => {
      try {
        const msg = JSON.parse(data);
        session.handleClientInput(msg);
      } catch {
        // Ignore malformed client messages
      }
    });

    ws.on('close', () => {
      session.destroy();
    });

    ws.on('error', () => {
      session.destroy();
    });

    session.init();
  }
}

module.exports = {
  VirtualBrowserManager,
  VirtualSession
};
