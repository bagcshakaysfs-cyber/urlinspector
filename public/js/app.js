/**
 * Web Inspector Main Application Controller
 * Handles user interactions, form submissions, mode toggling, interactive asset selection,
 * bundle downloads, navigation, tabs, and modals.
 */

// Global Asset Manager for selective packaging
window.AssetManager = {
  selectedUrls: new Set(),
  allDiscoveredUrls: new Set(),

  init(html) {
    this.selectedUrls.clear();
    this.allDiscoveredUrls.clear();

    if (!html) return;
    const { scripts, stylesheets, images } = html;

    if (scripts?.files) {
      scripts.files.forEach(f => {
        this.selectedUrls.add(f);
        this.allDiscoveredUrls.add(f);
      });
    }
    if (stylesheets?.files) {
      stylesheets.files.forEach(f => {
        this.selectedUrls.add(f);
        this.allDiscoveredUrls.add(f);
      });
    }
    if (images?.items) {
      images.items.forEach(img => {
        if (img.src) {
          this.selectedUrls.add(img.src);
          this.allDiscoveredUrls.add(img.src);
        }
      });
    }

    this.updateButtons();
  },

  toggle(url, isChecked) {
    if (!url) return;
    if (isChecked) {
      this.selectedUrls.add(url);
    } else {
      this.selectedUrls.delete(url);
    }
    this.updateButtons();
  },

  toggleCategory(category, isChecked) {
    document.querySelectorAll(`.asset-cb[data-category="${category}"]`).forEach(cb => {
      cb.checked = isChecked;
      const url = cb.getAttribute('data-url');
      if (url) {
        if (isChecked) {
          this.selectedUrls.add(url);
        } else {
          this.selectedUrls.delete(url);
        }
      }
    });
    this.updateButtons();
  },

  selectAll() {
    document.querySelectorAll('.asset-cb').forEach(cb => {
      cb.checked = true;
      const url = cb.getAttribute('data-url');
      if (url) this.selectedUrls.add(url);
    });
    document.querySelectorAll('.select-all-category-cb').forEach(cb => {
      cb.checked = true;
    });
    this.updateButtons();
  },

  deselectAll() {
    document.querySelectorAll('.asset-cb').forEach(cb => {
      cb.checked = false;
    });
    document.querySelectorAll('.select-all-category-cb').forEach(cb => {
      cb.checked = false;
    });
    this.selectedUrls.clear();
    this.updateButtons();
  },

  updateButtons() {
    const count = this.selectedUrls.size;
    const total = this.allDiscoveredUrls.size;

    const bundleBtns = [
      document.getElementById('btn-download-bundle'),
      document.getElementById('btn-download-bundle-alt')
    ];

    bundleBtns.forEach(btn => {
      if (!btn) return;
      if (count === 0) {
        btn.textContent = '📦 Select assets to download';
        btn.disabled = true;
        btn.style.opacity = '0.5';
      } else {
        btn.textContent = btn.id?.includes('alt') 
          ? `📦 Bundle (${count})` 
          : `📦 Download Selected (${count} assets) in .zip`;
        btn.disabled = false;
        btn.style.opacity = '1';
      }
    });

    const badge = document.getElementById('asset-selection-count-badge');
    if (badge) {
      badge.textContent = `${count} of ${total} assets selected for .zip package`;
    }
  },

  getSelectedArray() {
    return Array.from(this.selectedUrls);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('inspect-form');
  const urlInput = document.getElementById('url-input');
  const clearBtn = document.getElementById('btn-clear-input');
  const inspectBtn = document.getElementById('btn-inspect');

  const progressCard = document.getElementById('progress-card');
  const progressBar = document.getElementById('progress-bar-fill');
  const progressTitle = document.getElementById('progress-title-text');
  const errorCard = document.getElementById('error-card');
  const errorMessage = document.getElementById('error-message-text');
  const dashboardResults = document.getElementById('dashboard-results');

  // Mode Selection (Fast HTTP vs Dynamic SPA Browser)
  let currentMode = 'fast';
  const modeFastBtn = document.getElementById('mode-fast-btn');
  const modeDynamicBtn = document.getElementById('mode-dynamic-btn');

  function setMode(mode) {
    currentMode = mode;
    if (modeFastBtn && modeDynamicBtn) {
      modeFastBtn.classList.toggle('active', mode === 'fast');
      modeFastBtn.setAttribute('aria-selected', mode === 'fast' ? 'true' : 'false');
      modeDynamicBtn.classList.toggle('active', mode === 'dynamic');
      modeDynamicBtn.setAttribute('aria-selected', mode === 'dynamic' ? 'true' : 'false');
    }

    const hintContent = document.getElementById('mode-hint-content');
    if (hintContent) {
      if (mode === 'dynamic') {
        hintContent.innerHTML = `
          <span class="mode-hint-dot dot-dynamic"></span>
          <span class="mode-hint-desc">
            <strong>Headless Chromium Engine:</strong> Launches a real headless browser (1280x800). Hydrates client-side JavaScript (React, Vue, Next.js), captures viewport screenshot &amp; intercepts dynamic background API calls (~2-4s).
          </span>
        `;
      } else {
        hintContent.innerHTML = `
          <span class="mode-hint-dot dot-fast"></span>
          <span class="mode-hint-desc">
            <strong>Fast HTTP Engine:</strong> Direct network fetch. Analyzes raw headers, SSR HTML, status codes &amp; TLS security with sub-second latency (~150ms).
          </span>
        `;
      }
    }

    const inspectBtnSpan = document.querySelector('#btn-inspect span');
    if (inspectBtnSpan) {
      inspectBtnSpan.textContent = mode === 'dynamic' ? 'Launch Browser & Inspect' : 'Inspect Website';
    }
  }

  modeFastBtn?.addEventListener('click', () => setMode('fast'));
  modeDynamicBtn?.addEventListener('click', () => setMode('dynamic'));

  // Initialize Inspector Client
  const client = new InspectorClient({
    onProgress: ({ step, label, percent }) => {
      progressCard.style.display = 'block';
      errorCard.style.display = 'none';

      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressTitle) progressTitle.textContent = label;

      // Update steps indicator
      for (let i = 1; i <= 4; i++) {
        const stepElem = document.getElementById(`step-item-${i}`);
        if (!stepElem) continue;
        stepElem.classList.remove('active', 'done');
        if (i < step) {
          stepElem.classList.add('done');
        } else if (i === step) {
          stepElem.classList.add('active');
        }
      }
    },

    onError: (msg, data) => {
      inspectBtn.disabled = false;
      progressCard.style.display = 'none';
      dashboardResults.style.display = 'none';
      errorCard.style.display = 'flex';
      if (errorMessage) errorMessage.textContent = msg;

      // Render diagnostic trace logs if available even upon failure
      if (data && Array.isArray(data.logs) && data.logs.length > 0) {
        UI.renderExecutionLogs(data.logs, currentMode, lastTargetUrl);
      }
    },

    onSuccess: (data) => {
      inspectBtn.disabled = false;
      progressCard.style.display = 'none';
      errorCard.style.display = 'none';
      dashboardResults.style.display = 'block';

      // Update URL in browser history without reload
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('url', data.url);
      if (currentMode === 'dynamic') {
        currentUrl.searchParams.set('mode', 'dynamic');
      } else {
        currentUrl.searchParams.delete('mode');
      }
      window.history.pushState({}, '', currentUrl);

      // Render dashboard components
      UI.renderStatusCard(data);
      UI.renderDynamicInsights(data.dynamic, data.finalUrl || data.url);
      UI.renderExecutionLogs(data.logs, data.mode || currentMode, data.finalUrl || data.url);
      UI.renderRedirectTimeline(data.redirects);
      UI.renderPageInfo(data.html, data.nonHtmlNotice);
      UI.renderSeoCard(data.seo);
      UI.renderSecuritySection(data.security);
      UI.renderDnsAndTls(data.dns, data.tls);
      UI.renderHeadersTable(data.headers);
      UI.renderAssetsTabs(data.html);
      UI.initCodeViewer(data.rawHtml);
      UI.renderRawHttp(data);

      // Smooth scroll to results
      dashboardResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // Track active inspection target URL
  let lastTargetUrl = '';

  // Handle URL input changes & clear button
  function updateClearBtn() {
    if (clearBtn) {
      clearBtn.style.display = urlInput.value.length > 0 ? 'flex' : 'none';
    }
  }

  urlInput?.addEventListener('input', updateClearBtn);
  clearBtn?.addEventListener('click', () => {
    urlInput.value = '';
    updateClearBtn();
    urlInput.focus();
  });

  // Handle Quick Chips
  document.querySelectorAll('.chip[data-url]').forEach(chip => {
    chip.addEventListener('click', () => {
      const url = chip.getAttribute('data-url');
      if (urlInput) {
        urlInput.value = url;
        updateClearBtn();
        triggerInspection(url);
      }
    });
  });

  // Form submission
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (url) {
      triggerInspection(url);
    }
  });

  function triggerInspection(targetUrl) {
    lastTargetUrl = targetUrl;
    inspectBtn.disabled = true;
    errorCard.style.display = 'none';
    dashboardResults.style.display = 'none';
    // Fresh session: clear previous execution logs
    UI.clearExecutionLogs();
    client.inspect(targetUrl, currentMode);
  }

  // Handle Interactive Asset Selection Event Delegation
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('asset-cb')) {
      const url = e.target.getAttribute('data-url');
      window.AssetManager.toggle(url, e.target.checked);
    } else if (e.target.classList.contains('select-all-category-cb')) {
      const category = e.target.getAttribute('data-category');
      window.AssetManager.toggleCategory(category, e.target.checked);
    }
  });

  document.getElementById('btn-select-all-assets')?.addEventListener('click', () => {
    window.AssetManager.selectAll();
  });

  document.getElementById('btn-deselect-all-assets')?.addEventListener('click', () => {
    window.AssetManager.deselectAll();
  });

  // Handle Offline Site Bundle (.ZIP) Download with Selected Assets
  async function downloadSiteBundle(targetUrl) {
    if (!targetUrl) return;
    const selectedUrls = window.AssetManager.getSelectedArray();

    if (selectedUrls.length === 0) {
      alert('Please select at least one asset to download.');
      return;
    }

    const bundleBtns = [
      document.getElementById('btn-download-bundle'),
      document.getElementById('btn-download-bundle-alt')
    ];

    bundleBtns.forEach(btn => {
      if (btn) btn.textContent = `⏳ Packaging ${selectedUrls.length} assets...`;
    });

    try {
      const response = await fetch('/api/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          mode: currentMode,
          selectedUrls
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${response.status}: Failed to package archive.`);
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;

      let safeHost = 'website';
      try {
        safeHost = new URL(targetUrl).hostname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      } catch {}
      a.download = `bundle-${safeHost}.zip`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      alert(`Archive download failed: ${err.message}`);
    } finally {
      window.AssetManager.updateButtons();
    }
  }

  document.getElementById('btn-download-bundle')?.addEventListener('click', () => {
    const url = urlInput?.value.trim();
    if (url) downloadSiteBundle(url);
  });

  document.getElementById('btn-download-bundle-alt')?.addEventListener('click', () => {
    const url = urlInput?.value.trim();
    if (url) downloadSiteBundle(url);
  });

  // Handle Asset Tabs Switching
  const tabButtons = document.querySelectorAll('.tab-btn[data-tab]');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetTabId = btn.getAttribute('data-tab');
      const targetTab = document.getElementById(targetTabId);
      if (targetTab) targetTab.classList.add('active');
    });
  });

  // Handle Modals (About & API Docs)
  function setupModal(triggerId, modalId) {
    const trigger = document.getElementById(triggerId);
    const modal = document.getElementById(modalId);
    if (!trigger || !modal) return;

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      modal.classList.add('open');
    });

    const closeBtn = modal.querySelector('.modal-close');
    closeBtn?.addEventListener('click', () => modal.classList.remove('open'));

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });
  }

  setupModal('nav-about-btn', 'modal-about');
  setupModal('nav-api-btn', 'modal-api');

  // Copy cURL command in API modal
  document.getElementById('btn-copy-curl')?.addEventListener('click', (e) => {
    const curlCode = document.getElementById('curl-sample-code')?.textContent || '';
    navigator.clipboard.writeText(curlCode.trim()).then(() => {
      e.currentTarget.textContent = 'Copied!';
      setTimeout(() => (e.currentTarget.textContent = 'Copy cURL'), 2000);
    });
  });

  // Initialize Virtual Browser Sandbox
  if (typeof VirtualSandbox === 'function') {
    window.sandboxInstance = new VirtualSandbox();

    document.getElementById('nav-sandbox-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      const url = urlInput?.value.trim() || 'https://example.com';
      window.sandboxInstance.open(url);
    });

    document.getElementById('btn-hero-launch-sandbox')?.addEventListener('click', (e) => {
      e.preventDefault();
      const url = urlInput?.value.trim() || 'https://example.com';
      window.sandboxInstance.open(url);
    });
  }

  // Check URL query parameters on initial page load
  const params = new URLSearchParams(window.location.search);
  const initialUrl = params.get('url');
  const initialMode = params.get('mode');

  if (initialMode === 'dynamic') {
    setMode('dynamic');
  }

  if (initialUrl && urlInput) {
    urlInput.value = initialUrl;
    updateClearBtn();
    triggerInspection(initialUrl);
  }
});
