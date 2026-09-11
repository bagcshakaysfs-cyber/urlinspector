/**
 * Web Inspector API Client
 * Manages HTTP communication with /api/inspect and orchestrates progress stages.
 */
class InspectorClient {
  constructor(options = {}) {
    this.onProgress = options.onProgress || (() => {});
    this.onError = options.onError || (() => {});
    this.onSuccess = options.onSuccess || (() => {});
  }

  async inspect(targetUrl, mode = 'fast') {
    if (!targetUrl || typeof targetUrl !== 'string') {
      this.onError('Please enter a valid website URL or domain.');
      return;
    }

    const isDynamic = mode === 'dynamic';

    // Step 1: Validating URL & SSRF checks
    this.onProgress({
      step: 1,
      label: isDynamic ? 'Launching headless browser & checking security rules...' : 'Validating URL & checking security rules...',
      percent: 25
    });

    // Staggered progress steps for smooth UX feedback
    const step2Timer = setTimeout(() => {
      this.onProgress({
        step: 2,
        label: isDynamic ? 'Executing client-side JavaScript & loading SPA components...' : 'Connecting to server & fetching HTTP response...',
        percent: 50
      });
    }, isDynamic ? 600 : 400);

    const step3Timer = setTimeout(() => {
      this.onProgress({
        step: 3,
        label: isDynamic ? 'Extracting rendered DOM, screenshot & background network calls...' : 'Parsing HTML structure, headings & metadata...',
        percent: 75
      });
    }, isDynamic ? 2000 : 1200);

    try {
      const apiUrl = `/api/inspect?url=${encodeURIComponent(targetUrl.trim())}&mode=${encodeURIComponent(mode)}`;
      const response = await fetch(apiUrl);

      clearTimeout(step2Timer);
      clearTimeout(step3Timer);

      this.onProgress({ step: 4, label: 'Analyzing SEO, security headers & finalizing report...', percent: 95 });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const errorMsg = data.error || `HTTP ${response.status}: Failed to inspect website.`;
        this.onError(errorMsg, data);
        return;
      }

      this.onProgress({ step: 4, label: 'Inspection complete!', percent: 100 });
      setTimeout(() => {
        this.onSuccess(data);
      }, 250);
    } catch (err) {
      clearTimeout(step2Timer);
      clearTimeout(step3Timer);
      this.onError(`Network request failed: ${err.message}. Please verify the server is running.`);
    }
  }
}

window.InspectorClient = InspectorClient;
