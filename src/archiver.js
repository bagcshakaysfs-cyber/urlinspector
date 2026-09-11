const path = require('node:path');
const archiver = require('archiver');
const cheerio = require('cheerio');
const { safeFetch } = require('./fetcher');
const { normalizeUrl } = require('./url-validator');

const DEFAULT_MAX_TOTAL_BYTES = 30 * 1024 * 1024; // 30 MB
const DEFAULT_MAX_ASSET_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_MAX_ASSETS = 100;
const CONCURRENCY_LIMIT = 6;

/**
 * Sanitizes and generates a safe local filename based on URL extension and index.
 */
function getAssetFilename(urlStr, folder, index) {
  try {
    const parsed = new URL(urlStr);
    const basename = path.basename(parsed.pathname);
    const ext = path.extname(basename).split('?')[0].split('#')[0].toLowerCase();
    
    // Remove unsafe characters from base
    const cleanBase = basename.replace(/[^a-zA-Z0-9_\-\.]/g, '_').substring(0, 40);
    
    if (cleanBase && ext) {
      return `assets/${folder}/${index}_${cleanBase}`;
    }
    
    const fallbackExt = folder === 'css' ? '.css' : folder === 'js' ? '.js' : folder === 'images' ? '.png' : '.bin';
    return `assets/${folder}/asset_${index}${fallbackExt}`;
  } catch {
    return `assets/${folder}/asset_${index}`;
  }
}

/**
 * Extracts and categorizes all asset URLs from an HTML document.
 */
function extractAssetsFromHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const assets = [];
  const seenUrls = new Set();

  function addAsset(rawSrc, type, folder, element, attr) {
    if (!rawSrc || typeof rawSrc !== 'string') return;
    const trimmed = rawSrc.trim();
    if (trimmed.startsWith('data:') || trimmed.startsWith('javascript:') || trimmed.startsWith('#') || trimmed.startsWith('mailto:')) {
      return;
    }

    try {
      const resolved = new URL(trimmed, baseUrl).href;
      if (!seenUrls.has(resolved)) {
        seenUrls.add(resolved);
        assets.push({
          originalSrc: trimmed,
          resolvedUrl: resolved,
          type,
          folder,
          element,
          attr
        });
      }
    } catch {
      // Invalid URL syntax, ignore
    }
  }

  // Stylesheets
  $('link[rel="stylesheet"]').each((_, el) => {
    addAsset($(el).attr('href'), 'css', 'css', el, 'href');
  });

  // Scripts
  $('script[src]').each((_, el) => {
    addAsset($(el).attr('src'), 'js', 'js', el, 'src');
  });

  // Images
  $('img[src]').each((_, el) => {
    addAsset($(el).attr('src'), 'image', 'images', el, 'src');
  });

  // Favicons & Icons
  $('link[rel*="icon"]').each((_, el) => {
    addAsset($(el).attr('href'), 'icon', 'images', el, 'href');
  });

  // Media & Video / Audio Sources
  $('source[src]').each((_, el) => {
    addAsset($(el).attr('src'), 'media', 'media', el, 'src');
  });

  return { $, assets: assets.slice(0, DEFAULT_MAX_ASSETS) };
}

/**
 * Runs tasks with concurrency limit.
 */
async function runWithConcurrency(tasks, limit) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const currentIndex = index++;
      try {
        results[currentIndex] = await tasks[currentIndex]();
      } catch (err) {
        results[currentIndex] = { error: err.message };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Creates an offline-browsable ZIP archive of a website.
 * Streams the generated .zip archive to the writable response stream.
 *
 * @param {string} targetUrl Target website URL
 * @param {object} options Options { html, maxTotalBytes, outputStream }
 */
async function createWebsiteArchive(targetUrl, options = {}) {
  const normalized = normalizeUrl(targetUrl);
  if (!normalized.valid) {
    throw new Error(normalized.error);
  }

  let html = options.html;
  let finalUrl = targetUrl;

  // If HTML is not pre-supplied, fetch it
  if (!html) {
    const fetchResult = await safeFetch(targetUrl);
    if (!fetchResult.success) {
      throw new Error(fetchResult.error || 'Failed to fetch base website content.');
    }
    html = fetchResult.body;
    finalUrl = fetchResult.finalUrl || targetUrl;
  }

  // 1. Extract assets
  const { $, assets } = extractAssetsFromHtml(html, finalUrl);

  const selectedSet = Array.isArray(options.selectedUrls) && options.selectedUrls.length > 0
    ? new Set(options.selectedUrls.map(u => String(u).trim()))
    : null;

  // Filter to only selected assets if a selection was specified
  const filteredAssets = selectedSet
    ? assets.filter(a => selectedSet.has(a.resolvedUrl) || selectedSet.has(a.originalSrc))
    : assets;

  // Map to local paths
  const assetMap = new Map();
  filteredAssets.forEach((asset, idx) => {
    const localRelativePath = getAssetFilename(asset.resolvedUrl, asset.folder, idx + 1);
    assetMap.set(asset.resolvedUrl, {
      ...asset,
      localRelativePath,
      localHtmlPath: `./${localRelativePath}`
    });
  });

  // 2. Rewrite HTML paths in Cheerio DOM for selected assets
  filteredAssets.forEach(asset => {
    const mapped = assetMap.get(asset.resolvedUrl);
    if (mapped) {
      $(asset.element).attr(asset.attr, mapped.localHtmlPath);
    }
  });

  // Add offline archive metadata header notice
  $('head').prepend(`
    <!-- 
      Offline Website Bundle Created by Web Inspector
      Source URL: ${finalUrl}
      Archive Timestamp: ${new Date().toISOString()}
    -->
  `);

  const rewrittenHtml = $.html();

  // 3. Initialize Archiver instance
  const archive = archiver('zip', {
    zlib: { level: 6 }
  });

  // Add rewritten index.html
  archive.append(rewrittenHtml, { name: 'index.html' });

  // Add README
  const readmeContent = [
    '========================================================================',
    'WEB INSPECTOR - OFFLINE WEBSITE ARCHIVE BUNDLE',
    '========================================================================',
    `Original URL : ${finalUrl}`,
    `Generated At : ${new Date().toISOString()}`,
    `Total Assets : ${assets.length}`,
    '',
    'How to view:',
    'Double-click "index.html" to open the archived website in your local browser.',
    'All styles, images, and scripts are referenced locally from the "assets/" folder.',
    '========================================================================'
  ].join('\n');
  archive.append(readmeContent, { name: 'README.txt' });

  // 4. Concurrently download assets with safety caps
  let totalDownloadedBytes = 0;
  let successfulAssets = 0;

  const downloadTasks = Array.from(assetMap.values()).map(asset => async () => {
    if (totalDownloadedBytes >= DEFAULT_MAX_TOTAL_BYTES) {
      return { skipped: true, reason: 'Total archive size limit exceeded.' };
    }

    try {
      const res = await safeFetch(asset.resolvedUrl, {
        maxSize: DEFAULT_MAX_ASSET_BYTES,
        timeoutMs: 6000
      });

      if (res.success && res.bodyBuffer && res.bodyBuffer.length > 0) {
        totalDownloadedBytes += res.bodyBuffer.length;
        archive.append(res.bodyBuffer, { name: asset.localRelativePath });
        successfulAssets++;
        return { success: true, url: asset.resolvedUrl, size: res.bodyBuffer.length };
      }
      return { success: false, url: asset.resolvedUrl, error: res.error };
    } catch (err) {
      return { success: false, url: asset.resolvedUrl, error: err.message };
    }
  });

  await runWithConcurrency(downloadTasks, CONCURRENCY_LIMIT);

  // Finalize archive
  archive.finalize();

  return {
    archive,
    stats: {
      url: finalUrl,
      totalAssetsFound: assets.length,
      downloadedAssets: successfulAssets,
      totalBytes: totalDownloadedBytes
    }
  };
}

module.exports = {
  createWebsiteArchive,
  extractAssetsFromHtml
};
