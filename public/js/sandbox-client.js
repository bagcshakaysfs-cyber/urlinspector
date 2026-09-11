/**
 * Virtual Browser Sandbox Client
 * Handles real-time CDP screencasting over WebSocket, mouse/keyboard input translation,
 * and live Chrome DevTools-grade Network Activity table updates.
 */

class VirtualSandbox {
  constructor() {
    this.ws = null;
    this.currentUrl = '';
    this.requests = new Map();
    this.requestsList = [];
    this.activeFilter = 'all';
    this.searchQuery = '';
    this.imgBuffer = new Image();
    this.canvas = null;
    this.ctx = null;
    this.isConnecting = false;
    this.selectedRequest = null;

    this.initElements();
    this.attachEventListeners();
  }

  initElements() {
    this.modal = document.getElementById('modal-sandbox');
    this.canvas = document.getElementById('sandbox-canvas');
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
    }
    this.addressInput = document.getElementById('sandbox-address-input');
    this.statusBadge = document.getElementById('sandbox-status-badge');
    this.networkTbody = document.getElementById('sandbox-network-tbody');

    this.totalCountElem = document.getElementById('sb-count-total');
    this.dynamicCountElem = document.getElementById('sb-count-dynamic');
    this.sizeCountElem = document.getElementById('sb-count-size');
    this.errorsCountElem = document.getElementById('sb-count-errors');
  }

  attachEventListeners() {
    // Canvas mouse interactions
    if (this.canvas) {
      this.canvas.addEventListener('mousedown', e => this.handleMouseEvent('mouse_down', e));
      this.canvas.addEventListener('mouseup', e => this.handleMouseEvent('mouse_up', e));
      this.canvas.addEventListener('click', e => {
        this.canvas.focus();
        this.handleMouseEvent('mouse_click', e);
      });
      this.canvas.addEventListener('mousemove', e => this.handleMouseMove(e));
      this.canvas.addEventListener('wheel', e => this.handleWheel(e), { passive: false });

      // Canvas keyboard interactions
      this.canvas.setAttribute('tabindex', '0');
      this.canvas.addEventListener('keydown', e => this.handleKeyEvent('key_down', e));
      this.canvas.addEventListener('keyup', e => this.handleKeyEvent('key_up', e));
    }

    // Navigation buttons
    document.getElementById('sb-btn-back')?.addEventListener('click', () => this.sendInput({ action: 'back' }));
    document.getElementById('sb-btn-forward')?.addEventListener('click', () => this.sendInput({ action: 'forward' }));
    document.getElementById('sb-btn-reload')?.addEventListener('click', () => this.sendInput({ action: 'reload' }));

    // Address bar navigation
    this.addressInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        let url = this.addressInput.value.trim();
        if (url) {
          if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
          this.sendInput({ action: 'navigate', url });
        }
      }
    });

    // Close buttons
    document.getElementById('sb-btn-close')?.addEventListener('click', () => this.close());
    this.modal?.querySelector('.sandbox-modal-close')?.addEventListener('click', () => this.close());

    // Filter tabs
    document.querySelectorAll('.sb-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sb-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.getAttribute('data-filter') || 'all';
        this.renderNetworkTable();
      });
    });

    // Search filter input
    const searchInput = document.getElementById('sb-search-input');
    searchInput?.addEventListener('input', e => {
      this.searchQuery = (e.target.value || '').trim().toLowerCase();
      this.renderNetworkTable();
    });

    // Detail drawer close
    document.getElementById('sb-drawer-close')?.addEventListener('click', () => {
      const drawer = document.getElementById('sb-request-drawer');
      if (drawer) drawer.style.display = 'none';
    });
  }

  getScaledCoordinates(e) {
    if (!this.canvas) return { x: 0, y: 0 };
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = 1280 / rect.width;
    const scaleY = 800 / rect.height;
    return {
      x: Math.max(0, Math.min(1280, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(800, (e.clientY - rect.top) * scaleY))
    };
  }

  handleMouseEvent(action, e) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const { x, y } = this.getScaledCoordinates(e);
    const button = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
    this.sendInput({
      action,
      x,
      y,
      button,
      clickCount: 1
    });
  }

  handleMouseMove(e) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const { x, y } = this.getScaledCoordinates(e);
    this.sendInput({
      action: 'mouse_move',
      x,
      y
    });
  }

  handleWheel(e) {
    e.preventDefault();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const { x, y } = this.getScaledCoordinates(e);
    this.sendInput({
      action: 'mouse_wheel',
      x,
      y,
      deltaX: e.deltaX,
      deltaY: e.deltaY
    });
  }

  handleKeyEvent(action, e) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Don't forward tab switching hotkeys
    if (e.key === 'Tab') return;
    e.preventDefault();

    this.sendInput({
      action,
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      text: e.key.length === 1 ? e.key : undefined
    });
  }

  sendInput(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch {}
    }
  }

  /**
   * Opens the virtual browser sandbox connected to target URL.
   */
  open(targetUrl) {
    let cleanUrl = (targetUrl || '').trim();
    if (!cleanUrl) cleanUrl = 'https://example.com';
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(cleanUrl)) {
      cleanUrl = cleanUrl.startsWith('//') ? `https:${cleanUrl}` : `https://${cleanUrl}`;
    }

    this.currentUrl = cleanUrl;
    this.requests.clear();
    this.requestsList = [];
    this.activeFilter = 'all';
    this.searchQuery = '';

    if (this.modal) {
      this.modal.classList.add('open');
    }

    if (this.addressInput) {
      this.addressInput.value = cleanUrl;
    }

    this.setStatus('Initializing Chromium...', 'connecting');
    this.resetStats();
    this.renderNetworkTable();

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/sandbox?url=${encodeURIComponent(cleanUrl)}`;

    if (this.ws) {
      try { this.ws.close(); } catch {}
    }

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.setStatus('Connected · Streaming Viewport', 'connected');
    };

    this.ws.onmessage = event => {
      try {
        const msg = JSON.parse(event.data);
        this.handleServerMessage(msg);
      } catch (err) {
        console.error('Error parsing sandbox message:', err);
      }
    };

    this.ws.onclose = () => {
      this.setStatus('Session Disconnected', 'disconnected');
    };

    this.ws.onerror = err => {
      this.setStatus('Connection Error', 'error');
    };
  }

  handleServerMessage(msg) {
    switch (msg.type) {
      case 'status':
        this.setStatus(msg.message, 'connecting');
        break;

      case 'ready':
        this.setStatus('Live Sandbox Active', 'ready');
        if (msg.url && this.addressInput) {
          this.addressInput.value = msg.url;
        }
        break;

      case 'frame':
        this.renderFrame(msg.data);
        break;

      case 'navigated':
        if (msg.url && this.addressInput) {
          this.addressInput.value = msg.url;
        }
        break;

      case 'network_event':
        this.handleNetworkEvent(msg);
        break;

      case 'error':
        this.setStatus(`Error: ${msg.message.split('\n')[0].substring(0, 45)}...`, 'error');
        this.showCanvasError(msg.message);
        break;

      case 'warn':
        console.warn('[Virtual Sandbox Notice]', msg.message);
        break;
    }
  }

  showCanvasError(message) {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width;
    const h = this.canvas.height;

    this.ctx.fillStyle = '#090d16';
    this.ctx.fillRect(0, 0, w, h);

    this.ctx.fillStyle = '#ef4444';
    this.ctx.font = 'bold 24px Inter, -apple-system, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('⚠️ Virtual Sandbox Alert', w / 2, h / 2 - 60);

    this.ctx.fillStyle = '#cbd5e1';
    this.ctx.font = '14px "JetBrains Mono", Consolas, monospace';
    const lines = (message || 'Unknown error occurred').split('\n');
    let startY = h / 2 - 15;
    for (let i = 0; i < Math.min(lines.length, 7); i++) {
      this.ctx.fillText(lines[i], w / 2, startY + (i * 24));
    }
  }

  renderFrame(base64Data) {
    if (!this.ctx || !this.canvas) return;
    this.imgBuffer.onload = () => {
      this.ctx.drawImage(this.imgBuffer, 0, 0, this.canvas.width, this.canvas.height);
    };
    this.imgBuffer.src = 'data:image/jpeg;base64,' + base64Data;
  }

  handleNetworkEvent(msg) {
    const { action, payload } = msg;
    if (!payload || !payload.id) return;

    if (action === 'start') {
      this.requests.set(payload.id, payload);
      this.requestsList.unshift(payload); // Newest at top
    } else if (action === 'response' || action === 'complete') {
      const existing = this.requests.get(payload.id);
      if (existing) {
        Object.assign(existing, payload);
      } else {
        this.requests.set(payload.id, payload);
        this.requestsList.unshift(payload);
      }
    }

    this.updateStats();
    this.renderNetworkTable();
  }

  setStatus(text, state) {
    if (!this.statusBadge) return;
    this.statusBadge.textContent = text;
    this.statusBadge.className = `sb-status-badge status-${state}`;
  }

  resetStats() {
    if (this.totalCountElem) this.totalCountElem.textContent = '0';
    if (this.dynamicCountElem) this.dynamicCountElem.textContent = '0';
    if (this.sizeCountElem) this.sizeCountElem.textContent = '0 B';
    if (this.errorsCountElem) this.errorsCountElem.textContent = '0';
  }

  updateStats() {
    let total = this.requestsList.length;
    let dynamic = 0;
    let errors = 0;
    let totalBytes = 0;

    for (const req of this.requestsList) {
      if (req.isDynamicOnly) dynamic++;
      const s = Number(req.status);
      if (s >= 400 || req.status === 'Failed') errors++;

      if (typeof req.size === 'string' && req.size !== 'Pending') {
        const parts = req.size.split(' ');
        const num = parseFloat(parts[0]);
        if (!isNaN(num)) {
          if (parts[1] === 'MB') totalBytes += num * 1024 * 1024;
          else if (parts[1] === 'kB') totalBytes += num * 1024;
          else if (parts[1] === 'B') totalBytes += num;
        }
      }
    }

    if (this.totalCountElem) this.totalCountElem.textContent = String(total);
    if (this.dynamicCountElem) this.dynamicCountElem.textContent = String(dynamic);
    if (this.errorsCountElem) this.errorsCountElem.textContent = String(errors);
    if (this.sizeCountElem) {
      if (totalBytes < 1024) this.sizeCountElem.textContent = `${Math.round(totalBytes)} B`;
      else if (totalBytes < 1024 * 1024) this.sizeCountElem.textContent = `${(totalBytes / 1024).toFixed(1)} kB`;
      else this.sizeCountElem.textContent = `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
    }
  }

  renderNetworkTable() {
    if (!this.networkTbody) return;

    const filtered = this.requestsList.filter(item => {
      // Search filter
      if (this.searchQuery) {
        const nameMatch = (item.name || '').toLowerCase().includes(this.searchQuery);
        const urlMatch = (item.url || '').toLowerCase().includes(this.searchQuery);
        if (!nameMatch && !urlMatch) return false;
      }

      // Tab filter
      const type = (item.resourceType || '').toLowerCase();
      const status = Number(item.status);
      switch (this.activeFilter) {
        case 'dynamic': return Boolean(item.isDynamicOnly);
        case 'fetch': return type === 'xhr' || type === 'fetch';
        case 'js': return type === 'script';
        case 'css': return type === 'stylesheet';
        case 'img': return type === 'image';
        case 'error': return status >= 400 || item.status === 'Failed';
        default: return true;
      }
    });

    if (filtered.length === 0) {
      this.networkTbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-dim); padding: 1.5rem 0;">
            ${this.requestsList.length === 0 ? 'Waiting for browser requests...' : 'No requests match current filter.'}
          </td>
        </tr>
      `;
      return;
    }

    this.networkTbody.innerHTML = filtered.map(req => {
      const statusNum = Number(req.status);
      let statusClass = 'status-pending';
      if (statusNum >= 200 && statusNum < 300) statusClass = 'status-2xx';
      else if (statusNum >= 300 && statusNum < 400) statusClass = 'status-3xx';
      else if (statusNum >= 400 && statusNum < 500) statusClass = 'status-4xx';
      else if (statusNum >= 500 || req.status === 'Failed') statusClass = 'status-5xx';

      const typeLabel = req.resourceType || 'other';

      return `
        <tr class="sb-net-row" data-id="${req.id}">
          <td class="col-name" title="${this.escape(req.url)}">
            <span class="file-name">${this.escape(req.name)}</span>
          </td>
          <td class="col-status">
            <span class="sb-status-pill ${statusClass}">${req.status || '...'}</span>
          </td>
          <td class="col-method font-mono">${this.escape(req.method || 'GET')}</td>
          <td class="col-type font-mono">${this.escape(typeLabel)}</td>
          <td class="col-initiator font-mono" title="${this.escape(req.initiator)}">${this.escape(req.initiator)}</td>
          <td class="col-size font-mono">${req.size || 'Pending'}</td>
          <td class="col-time font-mono">${req.time || 'Pending'}</td>
          <td class="col-condition">
            ${req.isDynamicOnly ? '<span class="badge-dynamic-only">⚡ Dynamic-Only</span>' : '<span class="badge-static-html">Static HTML</span>'}
          </td>
        </tr>
      `;
    }).join('');

    // Attach row click listeners for inspecting headers
    this.networkTbody.querySelectorAll('.sb-net-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id');
        const req = this.requests.get(id);
        if (req) this.showRequestDetails(req);
      });
    });
  }

  showRequestDetails(req) {
    const drawer = document.getElementById('sb-request-drawer');
    if (!drawer) return;

    drawer.style.display = 'block';

    const titleElem = document.getElementById('sb-drawer-title');
    const urlElem = document.getElementById('sb-drawer-url');
    const reqHeadersElem = document.getElementById('sb-drawer-req-headers');
    const resHeadersElem = document.getElementById('sb-drawer-res-headers');

    if (titleElem) titleElem.textContent = `${req.method || 'GET'} ${req.name}`;
    if (urlElem) urlElem.textContent = req.url;

    let reqHeadersText = '';
    if (req.requestHeaders && Object.keys(req.requestHeaders).length > 0) {
      reqHeadersText = Object.entries(req.requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n');
    } else {
      reqHeadersText = 'No request headers captured.';
    }

    let resHeadersText = '';
    if (req.responseHeaders && Object.keys(req.responseHeaders).length > 0) {
      resHeadersText = Object.entries(req.responseHeaders).map(([k, v]) => `${k}: ${v}`).join('\n');
    } else {
      resHeadersText = 'Response headers pending or unavailable.';
    }

    if (reqHeadersElem) reqHeadersElem.textContent = reqHeadersText;
    if (resHeadersElem) resHeadersElem.textContent = resHeadersText;
  }

  escape(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    if (this.modal) {
      this.modal.classList.remove('open');
    }
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}

window.VirtualSandbox = VirtualSandbox;
