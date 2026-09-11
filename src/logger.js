/**
 * Scraper Execution Trace Logger
 * Records in-memory, timestamped, category-tagged trace events for each inspection session.
 * Logs are transient and scoped strictly to the active scan.
 */

class ScraperLogger {
  constructor() {
    this.startTime = Date.now();
    this.events = [];
    this.maxEvents = 200; // Safeguard against unbounded memory
  }

  /**
   * Appends an event to the trace log.
   */
  log(category, message, meta = null, level = 'info') {
    if (this.events.length >= this.maxEvents) return;

    const now = Date.now();
    const deltaMs = now - this.startTime;

    const event = {
      id: this.events.length + 1,
      time: now,
      deltaMs,
      deltaStr: `+${(deltaMs / 1000).toFixed(3)}s`,
      category: category.toUpperCase(),
      level,
      message: this.sanitizeMessage(message),
      meta: meta ? this.sanitizeMeta(meta) : undefined
    };

    this.events.push(event);
  }

  dns(message, meta) { this.log('DNS', message, meta, 'info'); }
  tls(message, meta) { this.log('TLS', message, meta, 'info'); }
  http(message, meta) { this.log('HTTP', message, meta, 'info'); }
  browser(message, meta) { this.log('BROWSER', message, meta, 'info'); }
  network(message, meta) { this.log('NETWORK', message, meta, 'info'); }
  api(message, meta) { this.log('API', message, meta, 'info'); }
  dom(message, meta) { this.log('DOM', message, meta, 'info'); }
  warn(message, meta) { this.log('WARN', message, meta, 'warn'); }
  error(message, meta) { this.log('ERROR', message, meta, 'error'); }
  done(message, meta) { this.log('DONE', message, meta, 'info'); }

  /**
   * Sanitizes string messages to prevent leaking long payloads or sensitive keys.
   */
  sanitizeMessage(msg) {
    if (typeof msg !== 'string') return String(msg);
    return msg
      .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
      .replace(/(session_id|sessionid|auth_token|token)=[^;,\s]+/gi, '$1=[MASKED]');
  }

  /**
   * Sanitizes metadata objects.
   */
  sanitizeMeta(meta) {
    try {
      const sanitized = {};
      for (const [key, val] of Object.entries(meta)) {
        if (typeof val === 'string') {
          sanitized[key] = this.sanitizeMessage(val);
        } else if (typeof val === 'number' || typeof val === 'boolean') {
          sanitized[key] = val;
        } else if (Array.isArray(val)) {
          sanitized[key] = val.slice(0, 10);
        }
      }
      return sanitized;
    } catch {
      return undefined;
    }
  }

  /**
   * Returns complete serialized trace events for this session.
   */
  getLogs() {
    return this.events;
  }
}

module.exports = { ScraperLogger };
