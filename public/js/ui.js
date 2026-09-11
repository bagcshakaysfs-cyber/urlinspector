/**
 * Web Inspector UI Controller & Renderers
 * Responsible for DOM generation, tables, syntax highlighting, and code viewer interactions.
 */

const UI = {
  /**
   * Safe HTML escaping to prevent XSS.
   */
  escape(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  /**
   * Formats byte count into human readable size.
   */
  formatBytes(bytes) {
    if (bytes === 0 || !bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },

  /**
   * Renders the primary Website Status card.
   */
  renderStatusCard(data) {
    const card = document.getElementById('status-card');
    if (!card) return;

    const { status, responseTime, protocol, finalUrl, contentType, contentLength, server } = data;
    const code = status.code;
    const category = status.category;

    let badgeClass = 'status-2xx';
    let statusLabel = 'ONLINE';

    if (code >= 300 && code < 400) {
      badgeClass = 'status-3xx';
      statusLabel = 'REDIRECT';
    } else if (code >= 400 && code < 500) {
      badgeClass = 'status-4xx';
      statusLabel = 'CLIENT ERROR';
    } else if (code >= 500) {
      badgeClass = 'status-5xx';
      statusLabel = 'SERVER ERROR';
    }

    card.innerHTML = `
      <div class="status-header-row">
        <div class="status-badge-lg ${badgeClass}">
          <span class="pulse-dot"></span>
          <span>${statusLabel}</span>
        </div>
        <div style="display:flex; gap: 0.5rem; align-items: center;">
          <span style="font-size: 0.82rem; color: var(--text-dim); font-family: var(--font-mono);">${status.httpVersion || 'HTTP/1.1'}</span>
        </div>
      </div>

      <div class="status-metrics-grid">
        <div class="metric-box">
          <div class="metric-label">HTTP Status</div>
          <div class="metric-val" style="color: ${code < 400 ? 'var(--accent-emerald)' : 'var(--accent-rose)'};">
            ${code} ${this.escape(status.text)}
          </div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Response Time</div>
          <div class="metric-val" style="color: ${responseTime < 800 ? 'var(--accent-emerald)' : 'var(--accent-amber)'};">
            ${responseTime} ms
          </div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Protocol</div>
          <div class="metric-val">
            ${protocol}
          </div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Content-Type</div>
          <div class="metric-val" style="font-size: 0.95rem;">
            ${this.escape(contentType || 'unknown')}
          </div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Content-Length</div>
          <div class="metric-val">
            ${this.formatBytes(contentLength)}
          </div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Server</div>
          <div class="metric-val" style="font-size: 0.95rem;">
            ${this.escape(server || 'Not disclosed')}
          </div>
        </div>
      </div>

      <div class="final-url-bar">
        <div style="display:flex; align-items: center; gap: 0.5rem; min-width: 0;">
          <span style="color: var(--text-dim); font-size: 0.8rem; text-transform: uppercase;">Final URL:</span>
          <span class="final-url-text">${this.escape(finalUrl)}</span>
        </div>
        <button class="btn-sm" id="btn-copy-url" data-url="${this.escape(finalUrl)}">
          Copy URL
        </button>
      </div>
    `;

    document.getElementById('btn-copy-url')?.addEventListener('click', (e) => {
      const urlToCopy = e.currentTarget.getAttribute('data-url');
      navigator.clipboard.writeText(urlToCopy).then(() => {
        e.currentTarget.textContent = 'Copied!';
        setTimeout(() => (e.currentTarget.textContent = 'Copy URL'), 2000);
      });
    });
  },

  /**
   * Renders Dynamic SPA Execution Insights (screenshot preview, API calls, runtime errors).
   */
  renderDynamicInsights(dynamic) {
    const card = document.getElementById('dynamic-spa-card');
    if (!card) return;

    if (!dynamic || !dynamic.enabled) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';

    const { screenshot, apiCalls = [], consoleMessages = [], durationMs } = dynamic;

    let apiRowsHtml = '';
    apiCalls.forEach(call => {
      const statusBadge = call.status ? (call.status < 400 ? 'badge-pass' : 'badge-fail') : 'badge-neutral';
      apiRowsHtml += `
        <tr>
          <td><span class="badge ${statusBadge}">${call.status || 'Pending'}</span></td>
          <td class="font-mono" style="font-weight: 600; width: 75px;">${this.escape(call.method || 'GET')}</td>
          <td class="font-mono" style="word-break: break-all;">
            <a href="${this.escape(call.url)}" target="_blank" rel="noopener noreferrer">${this.escape(call.url)}</a>
          </td>
        </tr>
      `;
    });

    let consoleHtml = '';
    if (consoleMessages.length > 0) {
      consoleHtml = `
        <div style="margin-top: 1rem; border-top: 1px solid var(--border-subtle); padding-top: 0.85rem;">
          <div style="font-size: 0.72rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-bottom: 0.5rem;">
            Captured Runtime Console Messages (${consoleMessages.length})
          </div>
          <pre class="dom-tree-container" style="max-height: 160px; font-size: 0.76rem; color: #fbbf24;">${consoleMessages.map(m => `[${this.escape(m.type.toUpperCase())}] ${this.escape(m.text)}`).join('\n')}</pre>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-icon">🖥️</div>
          <h2 class="card-title">Dynamic SPA Browser Execution</h2>
        </div>
        <span class="badge badge-pass">Client JS Hydrated (${durationMs || 0}ms)</span>
      </div>

      <div class="grid-2-col">
        ${screenshot ? `
          <div>
            <div style="font-size: 0.72rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-bottom: 0.5rem;">
              Viewport Render Preview
            </div>
            <div class="dynamic-screenshot-preview">
              <img src="${screenshot}" alt="Rendered page viewport screenshot" />
              <div class="dynamic-screenshot-badge">1280x800 Chromium</div>
            </div>
          </div>
        ` : ''}
        <div>
          <div style="font-size: 0.72rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-bottom: 0.5rem;">
            Intercepted Dynamic API Requests (${apiCalls.length})
          </div>
          <div class="table-responsive" style="max-height: 280px;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Method</th>
                  <th>Endpoint</th>
                </tr>
              </thead>
              <tbody>
                ${apiRowsHtml || '<tr><td colspan="3" style="color: var(--text-dim);">No background fetch/XHR API requests observed.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      ${consoleHtml}
    `;
  },

  /**
   * Renders Redirect Chain section if redirects occurred.
   */
  renderRedirectTimeline(redirects) {
    const card = document.getElementById('redirect-card');
    if (!card) return;

    if (!redirects || redirects.length === 0) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';
    const container = document.getElementById('redirect-timeline');
    if (!container) return;

    let html = '';
    redirects.forEach((hop, idx) => {
      html += `
        <div class="redirect-hop">
          <div class="redirect-hop-left">
            <span class="hop-number">${hop.hop}</span>
            <div style="min-width: 0;">
              <div class="hop-url">${this.escape(hop.fromUrl)}</div>
              <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 0.15rem;">
                Latency: ${hop.responseTimeMs || 0} ms
              </div>
            </div>
          </div>
          <span class="redirect-arrow-badge">↓ ${hop.statusCode} ${this.escape(hop.statusText || '')}</span>
        </div>
      `;

      if (idx < redirects.length - 1) {
        html += `
          <div class="redirect-arrow">
            <span>↓</span>
          </div>
        `;
      }
    });

    container.innerHTML = html;
  },

  /**
   * Renders HTML document statistics and <head> details.
   */
  renderPageInfo(html, nonHtmlNotice) {
    const card = document.getElementById('page-info-card');
    if (!card) return;

    if (!html) {
      card.innerHTML = `
        <div class="card-header">
          <div class="card-title-group">
            <div class="card-icon">📄</div>
            <h2 class="card-title">HTML Document Information</h2>
          </div>
        </div>
        <div class="notice-box">
          <span>ℹ️</span>
          <span>${this.escape(nonHtmlNotice || 'No HTML content was returned to analyze.')}</span>
        </div>
      `;
      return;
    }

    const { stats, head } = html;

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-icon">📄</div>
          <h2 class="card-title">HTML Document & Head Metadata</h2>
        </div>
      </div>

      <div class="stat-chips-grid">
        <div class="stat-chip">
          <div class="stat-chip-val">${this.formatBytes(stats.totalSize)}</div>
          <div class="stat-chip-label">Total Size</div>
        </div>
        <div class="stat-chip">
          <div class="stat-chip-val">${stats.domElements}</div>
          <div class="stat-chip-label">DOM Elements</div>
        </div>
        <div class="stat-chip">
          <div class="stat-chip-val">${stats.links}</div>
          <div class="stat-chip-label">Links</div>
        </div>
        <div class="stat-chip">
          <div class="stat-chip-val">${stats.images}</div>
          <div class="stat-chip-label">Images</div>
        </div>
        <div class="stat-chip">
          <div class="stat-chip-val">${stats.scripts}</div>
          <div class="stat-chip-label">Scripts</div>
        </div>
        <div class="stat-chip">
          <div class="stat-chip-val">${stats.stylesheets}</div>
          <div class="stat-chip-label">Stylesheets</div>
        </div>
        <div class="stat-chip">
          <div class="stat-chip-val">${stats.forms}</div>
          <div class="stat-chip-label">Forms</div>
        </div>
      </div>

      <div class="table-responsive" style="margin-top: 1rem;">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 25%;">Property</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Title</strong></td>
              <td class="font-mono">${this.escape(head.title || 'None declared')}</td>
            </tr>
            <tr>
              <td><strong>Meta Description</strong></td>
              <td>${this.escape(head.description || 'None declared')}</td>
            </tr>
            <tr>
              <td><strong>Canonical URL</strong></td>
              <td class="font-mono">${head.canonical ? `<a href="${this.escape(head.canonical)}" target="_blank" rel="noopener noreferrer">${this.escape(head.canonical)}</a>` : 'None declared'}</td>
            </tr>
            <tr>
              <td><strong>Robots Meta</strong></td>
              <td class="font-mono">${this.escape(head.robots || 'None declared')}</td>
            </tr>
            <tr>
              <td><strong>Language</strong></td>
              <td class="font-mono">${this.escape(head.lang || 'None declared')}</td>
            </tr>
            <tr>
              <td><strong>Charset</strong></td>
              <td class="font-mono">${this.escape(head.charset || 'None declared')}</td>
            </tr>
            <tr>
              <td><strong>Viewport</strong></td>
              <td class="font-mono">${this.escape(head.viewport || 'None declared')}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  },

  /**
   * Renders SEO Health audit section.
   */
  renderSeoCard(seo) {
    const card = document.getElementById('seo-card');
    if (!card) return;

    if (!seo) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';
    const { summary, items, disclaimer } = seo;

    let rowsHtml = '';
    items.forEach(item => {
      let badgeClass = 'badge-pass';
      let icon = '✓';
      if (item.status === 'warning') {
        badgeClass = 'badge-warning';
        icon = '⚠';
      } else if (item.status === 'fail') {
        badgeClass = 'badge-fail';
        icon = '✗';
      } else if (item.status === 'info') {
        badgeClass = 'badge-info';
        icon = 'ℹ';
      }

      rowsHtml += `
        <tr>
          <td><strong>${this.escape(item.factor)}</strong></td>
          <td>
            <span class="badge ${badgeClass}">${icon} ${item.status.toUpperCase()}</span>
          </td>
          <td>
            <div style="font-weight: 500;">${this.escape(item.value || 'None')}</div>
            <div style="font-size: 0.78rem; color: var(--text-dim); margin-top: 0.15rem;">${this.escape(item.note)}</div>
          </td>
        </tr>
      `;
    });

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-icon">🔍</div>
          <h2 class="card-title">SEO Technical Inspection</h2>
        </div>
        <div style="display:flex; gap: 0.5rem;">
          <span class="badge badge-pass">${summary.passes} PASS</span>
          <span class="badge badge-warning">${summary.warnings} WARN</span>
          <span class="badge badge-fail">${summary.fails} FAIL</span>
        </div>
      </div>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 25%;">Factor</th>
              <th style="width: 15%;">Status</th>
              <th>Details & Recommendation</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <div class="notice-box">
        <span>ℹ️</span>
        <span>${this.escape(disclaimer)}</span>
      </div>
    `;
  },

  /**
   * Renders Security Headers and Cookies section.
   */
  renderSecuritySection(security) {
    const card = document.getElementById('security-card');
    if (!card) return;

    if (!security) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';
    const { results, cookies, score, disclaimer } = security;

    let headerRows = '';
    results.forEach(res => {
      const badgeClass = res.status === 'pass' ? 'badge-pass' : (res.status === 'warning' ? 'badge-warning' : 'badge-fail');
      const icon = res.status === 'pass' ? '✓' : (res.status === 'warning' ? '⚠' : '✗');

      headerRows += `
        <tr>
          <td>
            <strong>${this.escape(res.header)}</strong>
            <div style="font-size: 0.75rem; color: var(--text-dim);">${this.escape(res.description)}</div>
          </td>
          <td>
            <span class="badge ${badgeClass}">${icon} ${res.status.toUpperCase()}</span>
          </td>
          <td class="font-mono" style="word-break: break-all; font-size: 0.8rem;">
            ${this.escape(res.value || 'Not set')}
          </td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">
            ${this.escape(res.note)}
          </td>
        </tr>
      `;
    });

    // Cookies rows
    let cookieRows = '';
    if (cookies && cookies.length > 0) {
      cookies.forEach(c => {
        cookieRows += `
          <tr>
            <td class="font-mono"><strong>${this.escape(c.name)}</strong></td>
            <td class="font-mono" style="color: var(--text-dim);">${this.escape(c.maskedValue)}</td>
            <td><span class="badge ${c.httpOnly ? 'badge-pass' : 'badge-warning'}">${c.httpOnly ? 'Yes' : 'No'}</span></td>
            <td><span class="badge ${c.secure ? 'badge-pass' : 'badge-warning'}">${c.secure ? 'Yes' : 'No'}</span></td>
            <td class="font-mono">${this.escape(c.sameSite)}</td>
            <td class="font-mono">${this.escape(c.path)}</td>
            <td style="font-size: 0.78rem;">${this.escape(c.expires)}</td>
          </tr>
        `;
      });
    }

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-icon">🛡️</div>
          <h2 class="card-title">Security Headers & Public Cookies</h2>
        </div>
        <div style="display:flex; gap: 0.5rem;">
          <span class="badge badge-pass">${score.passed} CONFIGURED</span>
          <span class="badge badge-fail">${score.missing} MISSING</span>
        </div>
      </div>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 25%;">Security Header</th>
              <th style="width: 12%;">Status</th>
              <th style="width: 33%;">Observed Value</th>
              <th>Evaluation</th>
            </tr>
          </thead>
          <tbody>
            ${headerRows}
          </tbody>
        </table>
      </div>

      <div style="margin-top: 1.5rem;">
        <h3 style="font-size: 0.95rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--text-main);">
          Public Set-Cookie Headers (${cookies ? cookies.length : 0})
        </h3>
        ${cookies && cookies.length > 0 ? `
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Cookie Name</th>
                  <th>Value</th>
                  <th>HttpOnly</th>
                  <th>Secure</th>
                  <th>SameSite</th>
                  <th>Path</th>
                  <th>Expires / Max-Age</th>
                </tr>
              </thead>
              <tbody>
                ${cookieRows}
              </tbody>
            </table>
          </div>
        ` : `
          <p style="font-size: 0.85rem; color: var(--text-dim);">No Set-Cookie headers were returned in this response.</p>
        `}
      </div>

      <div class="notice-box">
        <span>ℹ️</span>
        <span>${this.escape(disclaimer)} Cookie values are automatically masked for privacy and security.</span>
      </div>
    `;
  },

  /**
   * Renders DNS and TLS / HTTPS information cards.
   */
  renderDnsAndTls(dns, tls) {
    const card = document.getElementById('dns-tls-card');
    if (!card) return;

    let dnsHtml = '';
    if (dns && dns.success) {
      const { records } = dns;
      dnsHtml = `
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
          <div>
            <span style="font-size: 0.72rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">A Records (IPv4)</span>
            <div class="font-mono" style="margin-top: 0.2rem; font-size: 0.82rem; color: var(--text-main);">
              ${records.a.length > 0 ? records.a.map(ip => `<div>${this.escape(ip)}</div>`).join('') : '<span style="color: var(--text-dim)">None</span>'}
            </div>
          </div>
          <div>
            <span style="font-size: 0.72rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">AAAA Records (IPv6)</span>
            <div class="font-mono" style="margin-top: 0.2rem; font-size: 0.82rem; color: var(--text-main);">
              ${records.aaaa.length > 0 ? records.aaaa.map(ip => `<div>${this.escape(ip)}</div>`).join('') : '<span style="color: var(--text-dim)">None</span>'}
            </div>
          </div>
          <div>
            <span style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase;">CNAME</span>
            <div class="font-mono" style="margin-top: 0.2rem; font-size: 0.85rem;">
              ${records.cname.length > 0 ? records.cname.map(c => `<div>${this.escape(c)}</div>`).join('') : '<span style="color: var(--text-dim)">Apex domain (no CNAME)</span>'}
            </div>
          </div>
          <div>
            <span style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase;">MX Records</span>
            <div class="font-mono" style="margin-top: 0.2rem; font-size: 0.85rem;">
              ${records.mx.length > 0 ? records.mx.map(m => `<div>${m.priority} ${this.escape(m.exchange)}</div>`).join('') : '<span style="color: var(--text-dim)">None</span>'}
            </div>
          </div>
        </div>
      `;
    } else {
      dnsHtml = `<p style="color: var(--text-dim); font-size: 0.85rem;">${this.escape(dns?.error || 'DNS information unavailable.')}</p>`;
    }

    let tlsHtml = '';
    if (tls && tls.available) {
      const statusBadge = tls.status === 'Valid' ? 'badge-pass' : 'badge-fail';
      tlsHtml = `
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
          <div style="display:flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase;">Status</span>
            <span class="badge ${statusBadge}">${this.escape(tls.status)}</span>
          </div>
          <div>
            <span style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase;">Protocol & Cipher</span>
            <div class="font-mono" style="color: var(--accent-emerald); font-size: 0.85rem; margin-top: 0.2rem;">
              ${this.escape(tls.protocol)} • ${this.escape(tls.cipher)}
            </div>
          </div>
          <div>
            <span style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase;">Issuer</span>
            <div style="font-size: 0.85rem; font-weight: 500; margin-top: 0.2rem;">
              ${this.escape(tls.issuer)}
            </div>
          </div>
          <div>
            <span style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase;">Expiration</span>
            <div style="font-size: 0.85rem; margin-top: 0.2rem;">
              ${tls.validTo ? new Date(tls.validTo).toLocaleDateString() : 'Unknown'}
              ${tls.daysRemaining !== null ? `(${tls.daysRemaining} days remaining)` : ''}
            </div>
          </div>
          <div>
            <span style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase;">SANs (${tls.totalSans || 0})</span>
            <div class="font-mono" style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.2rem; word-break: break-all;">
              ${tls.sans.slice(0, 5).map(s => this.escape(s)).join(', ')}${tls.totalSans > 5 ? '...' : ''}
            </div>
          </div>
        </div>
      `;
    } else {
      tlsHtml = `<p style="color: var(--text-dim); font-size: 0.85rem;">${this.escape(tls?.error || 'TLS is not applicable for plain HTTP connections.')}</p>`;
    }

    card.innerHTML = `
      <div class="grid-2-col">
        <div class="card" style="margin-bottom: 0;">
          <div class="card-header">
            <div class="card-title-group">
              <div class="card-icon">🌐</div>
              <h2 class="card-title">DNS Records</h2>
            </div>
          </div>
          ${dnsHtml}
        </div>

        <div class="card" style="margin-bottom: 0;">
          <div class="card-header">
            <div class="card-title-group">
              <div class="card-icon">🔒</div>
              <h2 class="card-title">HTTPS / TLS Certificate</h2>
            </div>
          </div>
          ${tlsHtml}
        </div>
      </div>
    `;
  },

  /**
   * Renders HTTP Response Headers table with instant client-side search.
   */
  renderHeadersTable(headers) {
    const container = document.getElementById('headers-table-container');
    if (!container) return;

    if (!headers) {
      container.innerHTML = '<p style="color: var(--text-dim);">No headers returned.</p>';
      return;
    }

    const entries = Object.entries(headers);

    let rowsHtml = '';
    entries.forEach(([key, val]) => {
      const valStr = Array.isArray(val) ? val.join('\n') : String(val);
      rowsHtml += `
        <tr class="header-row" data-key="${this.escape(key.toLowerCase())}" data-val="${this.escape(valStr.toLowerCase())}">
          <td class="font-mono" style="width: 35%; color: var(--text-main);"><strong>${this.escape(key)}</strong></td>
          <td class="font-mono" style="word-break: break-all;">${this.escape(valStr)}</td>
        </tr>
      `;
    });

    container.innerHTML = `
      <div class="table-responsive" style="max-height: 400px;">
        <table class="data-table" id="table-headers">
          <thead>
            <tr>
              <th>Header Name</th>
              <th>Header Value</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;

    // Filter listener
    const searchInput = document.getElementById('search-headers');
    if (searchInput) {
      searchInput.value = '';
      searchInput.oninput = () => {
        const query = searchInput.value.toLowerCase().trim();
        const rows = container.querySelectorAll('.header-row');
        rows.forEach(r => {
          const k = r.getAttribute('data-key');
          const v = r.getAttribute('data-val');
          if (k.includes(query) || v.includes(query)) {
            r.style.display = '';
          } else {
            r.style.display = 'none';
          }
        });
      };
    }

    // Copy Headers button
    const copyBtn = document.getElementById('btn-copy-headers');
    if (copyBtn) {
      copyBtn.onclick = () => {
        const text = entries.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n');
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => (copyBtn.textContent = 'Copy Headers'), 2000);
        });
      };
    }
  },

  /**
   * Renders Assets breakdown: Links, Images, Scripts, Stylesheets, and DOM Tree.
   */
  renderAssetsTabs(html) {
    const card = document.getElementById('assets-card');
    if (!card) return;

    if (!html) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';
    const { links, images, scripts, stylesheets, domTree } = html;

    // Render Links
    const linksContainer = document.getElementById('tab-links');
    if (linksContainer) {
      let linkRows = '';
      links.items.forEach(l => {
        linkRows += `
          <tr class="asset-link-row" data-url="${this.escape(l.url.toLowerCase())}">
            <td class="font-mono"><a href="${this.escape(l.url)}" target="_blank" rel="noopener noreferrer">${this.escape(l.url)}</a></td>
            <td><span class="badge ${l.type === 'Internal' ? 'badge-info' : 'badge-neutral'}">${l.type}</span></td>
            <td class="font-mono">${this.escape(l.rel)}</td>
            <td><span class="badge ${l.isNofollow ? 'badge-warning' : 'badge-neutral'}">${l.isNofollow ? 'nofollow' : 'follow'}</span></td>
          </tr>
        `;
      });

      linksContainer.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
          <div style="font-size: 0.85rem; color: var(--text-muted);">
            Total: <strong>${links.total}</strong> (Internal: ${links.internal}, External: ${links.external}, Nofollow: ${links.nofollow})
          </div>
          <div class="table-search-box" style="margin-bottom: 0;">
            <input type="text" id="search-links-input" placeholder="Search extracted links..." />
          </div>
        </div>
        <div class="table-responsive" style="max-height: 400px;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Target URL</th>
                <th>Type</th>
                <th>Rel</th>
                <th>Follow</th>
              </tr>
            </thead>
            <tbody id="links-tbody">
              ${linkRows || '<tr><td colspan="4">No links found.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;

      document.getElementById('search-links-input')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        linksContainer.querySelectorAll('.asset-link-row').forEach(row => {
          row.style.display = row.getAttribute('data-url').includes(q) ? '' : 'none';
        });
      });
    }

    // Render Images
    const imagesContainer = document.getElementById('tab-images');
    if (imagesContainer) {
      let imgRows = '';
      images.items.forEach(img => {
        imgRows += `
          <tr>
            <td class="td-checkbox">
              <input type="checkbox" class="asset-cb" data-url="${this.escape(img.src)}" data-category="images" checked title="Select for .zip bundle" />
            </td>
            <td class="font-mono" style="word-break: break-all;">
              <a href="${this.escape(img.src)}" target="_blank" rel="noopener noreferrer">${this.escape(img.src)}</a>
            </td>
            <td>
              ${img.hasAlt ? `<span style="color: var(--accent-emerald);">✓ ${this.escape(img.alt)}</span>` : `<span class="badge badge-fail">Missing ALT</span>`}
            </td>
            <td>
              <span class="badge ${img.loading === 'lazy' ? 'badge-pass' : 'badge-neutral'}">${img.loading}</span>
            </td>
          </tr>
        `;
      });

      imagesContainer.innerHTML = `
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.75rem;">
          Total Images: <strong>${images.total}</strong> • With ALT: <strong>${images.withAlt}</strong> • Missing ALT: <strong style="color: ${images.missingAlt > 0 ? 'var(--accent-rose)' : 'inherit'};">${images.missingAlt}</strong> • Lazy Loaded: <strong>${images.lazyLoaded}</strong>
        </div>
        <div class="table-responsive" style="max-height: 400px;">
          <table class="data-table">
            <thead>
              <tr>
                <th class="th-checkbox">
                  <input type="checkbox" class="select-all-category-cb" data-category="images" checked title="Toggle All Images" />
                </th>
                <th>Image Source</th>
                <th>ALT Text</th>
                <th>Loading</th>
              </tr>
            </thead>
            <tbody>
              ${imgRows || '<tr><td colspan="4">No images found.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    }

    // Render Scripts & Stylesheets
    const scriptsContainer = document.getElementById('tab-scripts');
    if (scriptsContainer) {
      scriptsContainer.innerHTML = `
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.75rem;">
          Total Scripts: <strong>${scripts.total}</strong> • External: <strong>${scripts.externalCount}</strong> • Inline Blocks: <strong>${scripts.inlineCount}</strong>
        </div>
        <div class="table-responsive" style="max-height: 350px;">
          <table class="data-table">
            <thead>
              <tr>
                <th class="th-checkbox">
                  <input type="checkbox" class="select-all-category-cb" data-category="js" checked title="Toggle All Scripts" />
                </th>
                <th>#</th>
                <th>External Script URL</th>
              </tr>
            </thead>
            <tbody>
              ${scripts.files.map((file, idx) => `
                <tr>
                  <td class="td-checkbox">
                    <input type="checkbox" class="asset-cb" data-url="${this.escape(file)}" data-category="js" checked title="Select for .zip bundle" />
                  </td>
                  <td style="width: 50px;">${idx + 1}</td>
                  <td class="font-mono"><a href="${this.escape(file)}" target="_blank" rel="noopener noreferrer">${this.escape(file)}</a></td>
                </tr>
              `).join('') || '<tr><td colspan="3">No external scripts found.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    }

    const stylesContainer = document.getElementById('tab-stylesheets');
    if (stylesContainer) {
      stylesContainer.innerHTML = `
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.75rem;">
          Total Stylesheets: <strong>${stylesheets.total}</strong> • External: <strong>${stylesheets.externalCount}</strong> • Inline &lt;style&gt; Blocks: <strong>${stylesheets.inlineCount}</strong>
        </div>
        <div class="table-responsive" style="max-height: 350px;">
          <table class="data-table">
            <thead>
              <tr>
                <th class="th-checkbox">
                  <input type="checkbox" class="select-all-category-cb" data-category="css" checked title="Toggle All Stylesheets" />
                </th>
                <th>#</th>
                <th>Stylesheet Link</th>
              </tr>
            </thead>
            <tbody>
              ${stylesheets.files.map((file, idx) => `
                <tr>
                  <td class="td-checkbox">
                    <input type="checkbox" class="asset-cb" data-url="${this.escape(file)}" data-category="css" checked title="Select for .zip bundle" />
                  </td>
                  <td style="width: 50px;">${idx + 1}</td>
                  <td class="font-mono"><a href="${this.escape(file)}" target="_blank" rel="noopener noreferrer">${this.escape(file)}</a></td>
                </tr>
              `).join('') || '<tr><td colspan="3">No external stylesheets found.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    }

    // Initialize interactive AssetManager for checkbox selections
    if (window.AssetManager) {
      window.AssetManager.init(html);
    }

    // Render DOM Tree
    const treeContainer = document.getElementById('tab-dom-tree');
    if (treeContainer) {
      treeContainer.innerHTML = `
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.75rem;">
          Simplified DOM tree hierarchy (depth capped at 4 levels):
        </div>
        <div class="dom-tree-container">${this.escape(domTree.formattedText || 'Tree unavailable.')}</div>
      `;
    }
  },

  /**
   * Highlights HTML tokens safely.
   */
  highlightHtml(code) {
    const escaped = this.escape(code);
    return escaped
      // HTML comments
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="hl-comment">$1</span>')
      // DOCTYPE
      .replace(/(&lt;!(?:doctype|DOCTYPE)[\s\S]*?&gt;)/gi, '<span class="hl-doctype">$1</span>')
      // HTML tags and attributes
      .replace(/(&lt;\/?)([a-zA-Z0-9\-:]+)((?:[^&>]|&(?!gt;))*?)(\/?&gt;)/g, (_match, open, tagName, attrs, close) => {
        const highlightedAttrs = attrs.replace(/([a-zA-Z0-9\-:@.]+)(?:(=)(&quot;[\s\S]*?&quot;|&#039;[\s\S]*?&#039;|[^\s&>]+))?/g, (attrMatch, attrName, eq, attrVal) => {
          if (!attrName) return attrMatch;
          if (eq && attrVal !== undefined) {
            return `<span class="hl-attr">${attrName}</span>${eq}<span class="hl-val">${attrVal}</span>`;
          }
          return `<span class="hl-attr">${attrName}</span>`;
        });
        return `${open}<span class="hl-tag">${tagName}</span>${highlightedAttrs}${close}`;
      });
  },

  /**
   * Initializes the interactive Code Viewer with line numbers, copy, download, search, and fullscreen.
   */
  initCodeViewer(rawHtml) {
    const card = document.getElementById('raw-html-card');
    if (!card) return;

    if (!rawHtml) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';

    const lines = rawHtml.split(/\r?\n/);
    const totalLines = lines.length;
    const lineNumbersHtml = Array.from({ length: totalLines }, (_, i) => i + 1).join('\n');

    // Limit initial syntax highlighting to first 2500 lines for instant performance if file is huge
    const maxHighlightLines = 2500;
    let highlightedContent = '';
    if (lines.length > maxHighlightLines) {
      const firstChunk = lines.slice(0, maxHighlightLines).join('\n');
      const remainder = lines.slice(maxHighlightLines).join('\n');
      highlightedContent = this.highlightHtml(firstChunk) + '\n' + this.escape(remainder);
    } else {
      highlightedContent = this.highlightHtml(rawHtml);
    }

    const lineNumsElem = document.getElementById('code-line-nums');
    const codeAreaElem = document.getElementById('code-content');
    const codeBody = document.getElementById('code-viewer-body');

    if (lineNumsElem) lineNumsElem.textContent = lineNumbersHtml;
    if (codeAreaElem) codeAreaElem.innerHTML = highlightedContent;

    // Line wrap toggle
    const wrapBtn = document.getElementById('btn-wrap-html');
    if (wrapBtn && codeBody) {
      wrapBtn.onclick = () => {
        const isWrapped = codeBody.classList.toggle('wrap-lines');
        wrapBtn.classList.toggle('active', isWrapped);
        wrapBtn.textContent = isWrapped ? 'Unwrap Lines' : 'Wrap Lines';
      };
    }

    // Search inside code viewer
    const searchInput = document.getElementById('search-html-input');
    if (searchInput) {
      searchInput.value = '';
      searchInput.oninput = () => {
        const query = searchInput.value.trim();
        if (!query) {
          codeAreaElem.innerHTML = highlightedContent;
          return;
        }
        // Simple search highlighting
        const safeQuery = this.escape(query);
        const regex = new RegExp(`(${safeQuery})`, 'gi');
        codeAreaElem.innerHTML = highlightedContent.replace(regex, '<mark class="hl-match">$1</mark>');
      };
    }

    // Copy HTML button
    const copyBtn = document.getElementById('btn-copy-html');
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(rawHtml).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => (copyBtn.textContent = 'Copy HTML'), 2000);
        });
      };
    }

    // Download HTML button
    const downloadBtn = document.getElementById('btn-download-html');
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        const blob = new Blob([rawHtml], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'inspected_page.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };
    }

    // Fullscreen toggle
    const fullscreenBtn = document.getElementById('btn-fullscreen-html');
    if (fullscreenBtn) {
      fullscreenBtn.onclick = () => {
        card.classList.toggle('fullscreen');
        fullscreenBtn.textContent = card.classList.contains('fullscreen') ? 'Exit Fullscreen' : 'Fullscreen';
      };
    }

    // Collapse toggle
    const collapseBtn = document.getElementById('btn-collapse-html');
    if (collapseBtn && codeBody) {
      collapseBtn.onclick = () => {
        const isHidden = codeBody.style.display === 'none';
        codeBody.style.display = isHidden ? 'flex' : 'none';
        collapseBtn.textContent = isHidden ? 'Collapse' : 'Expand';
      };
    }
  },

  /**
   * Renders raw HTTP request headers sent and response details.
   */
  renderRawHttp(data) {
    const card = document.getElementById('raw-http-card');
    if (!card) return;

    const { requestHeaders, status, headers, finalUrl, protocol } = data;

    let reqHeadersText = `GET ${finalUrl} HTTP/1.1\n`;
    if (requestHeaders) {
      for (const [k, v] of Object.entries(requestHeaders)) {
        reqHeadersText += `${k}: ${v}\n`;
      }
    }

    let resHeadersText = `${protocol === 'HTTPS' ? 'HTTP/2' : 'HTTP/1.1'} ${status.code} ${status.text}\n`;
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        resHeadersText += `${k}: ${Array.isArray(v) ? v.join(', ') : v}\n`;
      }
    }

    const reqElem = document.getElementById('raw-request-pre');
    const resElem = document.getElementById('raw-response-pre');

    if (reqElem) reqElem.textContent = reqHeadersText;
    if (resElem) resElem.textContent = resHeadersText;
  }
};

window.UI = UI;
