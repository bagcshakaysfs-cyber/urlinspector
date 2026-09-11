const cheerio = require('cheerio');

/**
 * Builds a simplified DOM tree representation up to maxDepth.
 */
function buildDomTree($, element, currentDepth = 1, maxDepth = 4) {
  if (currentDepth > maxDepth || !element) return null;

  const node = $(element);
  const tagName = element.tagName ? element.tagName.toLowerCase() : '';

  // Skip comments and text nodes for tree structure
  if (!tagName || ['script', 'style', 'noscript', 'svg', 'iframe'].includes(tagName)) {
    return {
      tag: tagName,
      id: node.attr('id') || null,
      class: node.attr('class') || null,
      children: []
    };
  }

  const id = node.attr('id') || null;
  const className = node.attr('class') || null;

  const children = [];
  node.children().each((_, child) => {
    if (child.type === 'tag') {
      const childTree = buildDomTree($, child, currentDepth + 1, maxDepth);
      if (childTree) {
        children.push(childTree);
      }
    }
  });

  return {
    tag: tagName,
    id,
    class: className,
    children
  };
}

/**
 * Formats the DOM tree into a clean text representation with branches.
 */
function formatDomTreeAsText(treeNode, prefix = '', isLast = true, depth = 0) {
  if (!treeNode) return '';

  let label = treeNode.tag;
  if (treeNode.id) label += `#${treeNode.id}`;
  if (treeNode.class) {
    const firstClass = treeNode.class.trim().split(/\s+/)[0];
    if (firstClass) label += `.${firstClass}`;
  }

  let output = '';
  if (depth === 0) {
    output += `${label}\n`;
  } else {
    output += `${prefix}${isLast ? '└── ' : '├── '}${label}\n`;
  }

  const childPrefix = depth === 0 ? '' : prefix + (isLast ? '    ' : '│   ');
  const count = treeNode.children ? treeNode.children.length : 0;

  for (let i = 0; i < count; i++) {
    const isChildLast = i === count - 1;
    output += formatDomTreeAsText(treeNode.children[i], childPrefix, isChildLast, depth + 1);
  }

  return output;
}

/**
 * Parses HTML content and extracts comprehensive technical metadata.
 */
function parseHtml(htmlString, baseUrl = '') {
  if (!htmlString || typeof htmlString !== 'string') {
    return null;
  }

  const $ = cheerio.load(htmlString);
  let baseHostname = '';
  try {
    if (baseUrl) {
      baseHostname = new URL(baseUrl).hostname.toLowerCase();
    }
  } catch {
    // Ignore invalid baseUrl
  }

  // 1. Document Statistics
  const totalElements = $('*').length;
  const totalLinks = $('a').length;
  const totalImages = $('img').length;
  const totalScripts = $('script').length;
  const totalStylesheets = $('link[rel*="stylesheet" i]').length;
  const totalInlineStyles = $('style').length;
  const totalForms = $('form').length;

  // 2. Head Information
  const title = $('title').first().text().trim() || null;
  const metaDescription =
    $('meta[name="description" i]').attr('content')?.trim() ||
    $('meta[property="og:description" i]').attr('content')?.trim() ||
    null;
  const metaKeywords = $('meta[name="keywords" i]').attr('content')?.trim() || null;
  const metaRobots = $('meta[name="robots" i]').attr('content')?.trim() || null;
  const canonical = $('link[rel="canonical" i]').attr('href')?.trim() || null;
  const lang = $('html').attr('lang')?.trim() || null;
  const charset =
    $('meta[charset]').attr('charset')?.trim() ||
    $('meta[http-equiv="Content-Type" i]').attr('content')?.trim() ||
    null;
  const viewport = $('meta[name="viewport" i]').attr('content')?.trim() || null;
  const favicon =
    $('link[rel="icon" i]').attr('href')?.trim() ||
    $('link[rel="shortcut icon" i]').attr('href')?.trim() ||
    $('link[rel="apple-touch-icon" i]').attr('href')?.trim() ||
    null;

  // 3. Headings Analysis
  const headings = {
    h1: [],
    h2: [],
    h3: []
  };

  $('h1').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text) headings.h1.push(text);
  });
  $('h2').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text) headings.h2.push(text);
  });
  $('h3').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text) headings.h3.push(text);
  });

  // 4. Links Inspection
  const linksList = [];
  let internalCount = 0;
  let externalCount = 0;
  let nofollowCount = 0;

  $('a').each((_, el) => {
    const href = $(el).attr('href')?.trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    const rel = $(el).attr('rel')?.trim() || '';
    const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 100);
    const isNofollow = /nofollow/i.test(rel);
    if (isNofollow) nofollowCount++;

    let isInternal = true;
    let absoluteUrl = href;

    try {
      if (baseUrl) {
        const resolved = new URL(href, baseUrl);
        absoluteUrl = resolved.href;
        isInternal = resolved.hostname.toLowerCase() === baseHostname;
      } else if (href.startsWith('http://') || href.startsWith('https://')) {
        isInternal = false;
      }
    } catch {
      isInternal = !href.startsWith('http');
    }

    if (isInternal) {
      internalCount++;
    } else {
      externalCount++;
    }

    if (linksList.length < 150) {
      linksList.push({
        url: absoluteUrl,
        rawHref: href,
        text,
        type: isInternal ? 'Internal' : 'External',
        rel: rel || '—',
        isNofollow
      });
    }
  });

  // 5. Images Inspection
  const imagesList = [];
  let withAlt = 0;
  let missingAlt = 0;
  let lazyLoaded = 0;

  $('img').each((_, el) => {
    const src = $(el).attr('src')?.trim() || $(el).attr('data-src')?.trim() || '';
    if (!src) return;

    const altAttr = $(el).attr('alt');
    const hasAlt = altAttr !== undefined && altAttr !== null && altAttr.trim().length > 0;
    const loading = $(el).attr('loading')?.toLowerCase() || 'eager';
    const isLazy = loading === 'lazy' || $(el).attr('data-lazy') !== undefined;

    if (hasAlt) {
      withAlt++;
    } else {
      missingAlt++;
    }

    if (isLazy) {
      lazyLoaded++;
    }

    if (imagesList.length < 150) {
      imagesList.push({
        src,
        alt: hasAlt ? altAttr.trim() : 'Missing',
        hasAlt,
        loading: isLazy ? 'lazy' : 'eager'
      });
    }
  });

  // 6. Scripts Breakdown
  const externalScripts = [];
  let inlineScriptsCount = 0;

  $('script').each((_, el) => {
    const type = $(el).attr('type')?.toLowerCase().trim() || 'text/javascript';
    // Exclude JSON-LD and data scripts from executable script count
    if (['application/ld+json', 'application/json', 'importmap'].includes(type)) {
      return;
    }

    const src = $(el).attr('src')?.trim();
    if (src) {
      let resolvedSrc = src;
      try {
        if (baseUrl) resolvedSrc = new URL(src, baseUrl).href;
      } catch {
        // Keep original
      }
      if (externalScripts.length < 100) {
        externalScripts.push(resolvedSrc);
      }
    } else {
      inlineScriptsCount++;
    }
  });

  // 7. Stylesheets Breakdown
  const externalStylesheets = [];

  $('link[rel*="stylesheet" i]').each((_, el) => {
    const href = $(el).attr('href')?.trim();
    if (href) {
      let resolvedHref = href;
      try {
        if (baseUrl) resolvedHref = new URL(href, baseUrl).href;
      } catch {
        // Keep original
      }
      if (externalStylesheets.length < 100) {
        externalStylesheets.push(resolvedHref);
      }
    }
  });

  // 8. Open Graph & Twitter Cards
  const openGraph = {};
  $('meta[property^="og:" i]').each((_, el) => {
    const prop = $(el).attr('property')?.toLowerCase().replace(/^og:/, '');
    const content = $(el).attr('content')?.trim();
    if (prop && content) {
      openGraph[prop] = content;
    }
  });

  const twitterCard = {};
  $('meta[name^="twitter:" i]').each((_, el) => {
    const name = $(el).attr('name')?.toLowerCase().replace(/^twitter:/, '');
    const content = $(el).attr('content')?.trim();
    if (name && content) {
      twitterCard[name] = content;
    }
  });

  // 9. Structured Data (JSON-LD)
  const jsonLd = [];
  $('script[type="application/ld+json" i]').each((_, el) => {
    try {
      const content = $(el).html();
      if (content) {
        const parsed = JSON.parse(content.trim());
        jsonLd.push(parsed);
      }
    } catch {
      jsonLd.push({ error: 'Malformed JSON-LD payload' });
    }
  });

  // 10. DOM Structure Tree
  const htmlRoot = $('html').get(0);
  const domTree = htmlRoot ? buildDomTree($, htmlRoot, 1, 4) : null;
  const domTreeText = domTree ? formatDomTreeAsText(domTree) : '';

  return {
    stats: {
      totalSize: Buffer.byteLength(htmlString, 'utf8'),
      domElements: totalElements,
      links: totalLinks,
      images: totalImages,
      scripts: totalScripts,
      stylesheets: totalStylesheets,
      inlineStyles: totalInlineStyles,
      forms: totalForms
    },
    head: {
      title,
      description: metaDescription,
      keywords: metaKeywords,
      robots: metaRobots,
      canonical,
      lang,
      charset,
      viewport,
      favicon
    },
    headings: {
      h1Count: headings.h1.length,
      h2Count: headings.h2.length,
      h3Count: headings.h3.length,
      h1: headings.h1,
      h2: headings.h2.slice(0, 10),
      h3: headings.h3.slice(0, 10)
    },
    links: {
      total: totalLinks,
      internal: internalCount,
      external: externalCount,
      nofollow: nofollowCount,
      items: linksList
    },
    images: {
      total: totalImages,
      withAlt,
      missingAlt,
      lazyLoaded,
      items: imagesList
    },
    scripts: {
      total: totalScripts,
      externalCount: externalScripts.length,
      inlineCount: inlineScriptsCount,
      files: externalScripts
    },
    stylesheets: {
      total: totalStylesheets,
      externalCount: externalStylesheets.length,
      inlineCount: totalInlineStyles,
      files: externalStylesheets
    },
    social: {
      openGraph: Object.keys(openGraph).length > 0 ? openGraph : null,
      twitter: Object.keys(twitterCard).length > 0 ? twitterCard : null
    },
    structuredData: {
      count: jsonLd.length,
      items: jsonLd
    },
    domTree: {
      raw: domTree,
      formattedText: domTreeText
    }
  };
}

module.exports = {
  parseHtml,
  buildDomTree,
  formatDomTreeAsText
};
