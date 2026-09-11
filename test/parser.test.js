const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseHtml, formatDomTreeAsText } = require('../src/parser');
const { analyzeSeo } = require('../src/seo-analyzer');

const SAMPLE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Test Page Title</title>
  <meta name="description" content="This is a test description for verifying HTML parser.">
  <meta name="keywords" content="test, parser, seo">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://example.com/test">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Open Graph -->
  <meta property="og:title" content="OG Test Title">
  <meta property="og:description" content="OG Test Description">
  <meta property="og:image" content="https://example.com/og.jpg">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Twitter Title">

  <!-- Stylesheets -->
  <link rel="stylesheet" href="/assets/style.css">
  <link rel="stylesheet" href="https://cdn.example.com/lib.css">
  <style>body { margin: 0; }</style>

  <!-- JSON-LD -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Test Site"
  }
  </script>
</head>
<body>
  <header id="main-header">
    <nav class="navbar primary-nav">
      <a href="/home">Home</a>
      <a href="/about">About Us</a>
      <a href="https://external.org" rel="nofollow">External Link</a>
    </nav>
  </header>

  <main>
    <h1>Main H1 Heading</h1>
    <h2>Section H2 Heading</h2>
    <h3>Sub H3 Heading</h3>

    <form action="/submit" method="POST">
      <input type="text" name="query" />
      <button type="submit">Submit</button>
    </form>

    <div class="gallery">
      <img src="/logo.png" alt="Company Logo" loading="eager">
      <img src="/hero.webp" alt="Hero Banner" loading="lazy">
      <img src="/missing-alt.png">
    </div>
  </main>

  <script src="/assets/app.js"></script>
  <script>console.log("Inline script");</script>
</body>
</html>
`;

describe('HTML Parser & SEO Analyzer', () => {
  describe('parseHtml()', () => {
    test('extracts correct document statistics', () => {
      const parsed = parseHtml(SAMPLE_HTML, 'https://example.com/test');
      assert.ok(parsed);
      assert.equal(parsed.stats.forms, 1);
      assert.equal(parsed.stats.links, 3);
      assert.equal(parsed.stats.images, 3);
      assert.equal(parsed.stats.scripts, 3); // 1 JSON-LD, 1 external, 1 inline
      assert.equal(parsed.stats.stylesheets, 2);
      assert.equal(parsed.stats.inlineStyles, 1);
      assert.ok(parsed.stats.domElements > 10);
    });

    test('extracts <head> metadata correctly', () => {
      const parsed = parseHtml(SAMPLE_HTML, 'https://example.com/test');
      assert.equal(parsed.head.title, 'Test Page Title');
      assert.equal(parsed.head.description, 'This is a test description for verifying HTML parser.');
      assert.equal(parsed.head.keywords, 'test, parser, seo');
      assert.equal(parsed.head.robots, 'index, follow');
      assert.equal(parsed.head.canonical, 'https://example.com/test');
      assert.equal(parsed.head.lang, 'en');
      assert.equal(parsed.head.charset, 'UTF-8');
      assert.equal(parsed.head.viewport, 'width=device-width, initial-scale=1.0');
    });

    test('extracts headings breakdown', () => {
      const parsed = parseHtml(SAMPLE_HTML, 'https://example.com/test');
      assert.equal(parsed.headings.h1Count, 1);
      assert.equal(parsed.headings.h1[0], 'Main H1 Heading');
      assert.equal(parsed.headings.h2Count, 1);
      assert.equal(parsed.headings.h2[0], 'Section H2 Heading');
      assert.equal(parsed.headings.h3Count, 1);
      assert.equal(parsed.headings.h3[0], 'Sub H3 Heading');
    });

    test('categorizes internal vs external links and rel="nofollow"', () => {
      const parsed = parseHtml(SAMPLE_HTML, 'https://example.com/test');
      assert.equal(parsed.links.total, 3);
      assert.equal(parsed.links.internal, 2); // /home, /about
      assert.equal(parsed.links.external, 1); // https://external.org
      assert.equal(parsed.links.nofollow, 1);
    });

    test('analyzes images and flags missing alt attributes', () => {
      const parsed = parseHtml(SAMPLE_HTML, 'https://example.com/test');
      assert.equal(parsed.images.total, 3);
      assert.equal(parsed.images.withAlt, 2);
      assert.equal(parsed.images.missingAlt, 1);
      assert.equal(parsed.images.lazyLoaded, 1);
    });

    test('extracts scripts and stylesheets correctly', () => {
      const parsed = parseHtml(SAMPLE_HTML, 'https://example.com/test');
      assert.ok(parsed.scripts.files.some(s => s.includes('/assets/app.js')));
      assert.equal(parsed.scripts.inlineCount, 1);
      assert.equal(parsed.stylesheets.externalCount, 2);
      assert.equal(parsed.stylesheets.inlineCount, 1);
    });

    test('extracts Open Graph, Twitter cards, and JSON-LD', () => {
      const parsed = parseHtml(SAMPLE_HTML, 'https://example.com/test');
      assert.equal(parsed.social.openGraph.title, 'OG Test Title');
      assert.equal(parsed.social.twitter.card, 'summary_large_image');
      assert.equal(parsed.structuredData.count, 1);
      assert.equal(parsed.structuredData.items[0].name, 'Test Site');
    });

    test('builds simplified DOM structure tree', () => {
      const parsed = parseHtml(SAMPLE_HTML, 'https://example.com/test');
      assert.ok(parsed.domTree);
      assert.ok(parsed.domTree.formattedText.includes('html'));
      assert.ok(parsed.domTree.formattedText.includes('body'));
      assert.ok(parsed.domTree.formattedText.includes('header#main-header'));
    });
  });

  describe('analyzeSeo()', () => {
    test('produces comprehensive SEO evaluation', () => {
      const parsed = parseHtml(SAMPLE_HTML, 'https://example.com/test');
      const seo = analyzeSeo(parsed, 'https://example.com/test');
      assert.ok(seo);
      assert.ok(seo.summary.passes > 0);
      assert.ok(seo.items.some(i => i.factor === 'Page Title' && i.status === 'pass'));
      assert.ok(seo.items.some(i => i.factor === 'Canonical URL' && i.status === 'pass'));
      assert.ok(seo.items.some(i => i.factor === 'H1 Heading' && i.status === 'pass'));
      assert.ok(seo.items.some(i => i.factor === 'Image ALT Attributes' && i.status === 'warning'));
    });
  });
});
