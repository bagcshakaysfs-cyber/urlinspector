/**
 * Web Inspector Main Application Controller
 * Handles user interactions, form submissions, navigation, tabs, and modals.
 */

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

    onError: (msg) => {
      inspectBtn.disabled = false;
      progressCard.style.display = 'none';
      dashboardResults.style.display = 'none';
      errorCard.style.display = 'flex';
      if (errorMessage) errorMessage.textContent = msg;
    },

    onSuccess: (data) => {
      inspectBtn.disabled = false;
      progressCard.style.display = 'none';
      errorCard.style.display = 'none';
      dashboardResults.style.display = 'block';

      // Update URL in browser history without reload
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('url', data.url);
      window.history.pushState({}, '', currentUrl);

      // Render dashboard components
      UI.renderStatusCard(data);
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
    inspectBtn.disabled = true;
    errorCard.style.display = 'none';
    dashboardResults.style.display = 'none';
    client.inspect(targetUrl);
  }

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

  // Check URL query parameters on initial page load
  const params = new URLSearchParams(window.location.search);
  const initialUrl = params.get('url');
  if (initialUrl && urlInput) {
    urlInput.value = initialUrl;
    updateClearBtn();
    triggerInspection(initialUrl);
  }
});
