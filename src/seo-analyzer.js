/**
 * Analyzes parsed HTML and extracts structured SEO technical health checks.
 */
function analyzeSeo(parsedHtml, finalUrl = '') {
  if (!parsedHtml) {
    return null;
  }

  const { head, headings, images, links, social, structuredData } = parsedHtml;
  const items = [];

  // 1. Title Check
  if (head.title) {
    const len = head.title.length;
    let status = 'pass';
    let note = `Length: ${len} characters`;
    if (len < 10) {
      status = 'warning';
      note = `Title is very short (${len} chars). 30–60 characters recommended.`;
    } else if (len > 70) {
      status = 'warning';
      note = `Title may truncate in SERPs (${len} chars). Under 60 characters recommended.`;
    }
    items.push({
      factor: 'Page Title',
      status,
      value: head.title,
      note
    });
  } else {
    items.push({
      factor: 'Page Title',
      status: 'fail',
      value: null,
      note: 'Missing <title> tag. Search engines cannot index page title.'
    });
  }

  // 2. Meta Description Check
  if (head.description) {
    const len = head.description.length;
    let status = 'pass';
    let note = `Length: ${len} characters`;
    if (len < 40) {
      status = 'warning';
      note = `Description is short (${len} chars). 50–160 characters recommended.`;
    } else if (len > 160) {
      status = 'warning';
      note = `Description may truncate (${len} chars). Keep under 160 characters.`;
    }
    items.push({
      factor: 'Meta Description',
      status,
      value: head.description,
      note
    });
  } else {
    items.push({
      factor: 'Meta Description',
      status: 'warning',
      value: null,
      note: 'Missing meta description. Search engines will generate snippets from page content.'
    });
  }

  // 3. Canonical URL
  if (head.canonical) {
    let status = 'pass';
    let note = 'Found';
    if (finalUrl) {
      try {
        const canUrl = new URL(head.canonical, finalUrl).href;
        const finUrl = new URL(finalUrl).href;
        if (canUrl === finUrl) {
          note = 'Matches current page URL';
        } else {
          note = `Points to: ${head.canonical}`;
        }
      } catch {
        note = `Specified canonical: ${head.canonical}`;
      }
    }
    items.push({
      factor: 'Canonical URL',
      status,
      value: head.canonical,
      note
    });
  } else {
    items.push({
      factor: 'Canonical URL',
      status: 'warning',
      value: null,
      note: 'No canonical URL declared. Helps prevent duplicate content issues.'
    });
  }

  // 4. Robots Meta
  if (head.robots) {
    items.push({
      factor: 'Robots Meta',
      status: 'pass',
      value: head.robots,
      note: `Directives: ${head.robots}`
    });
  } else {
    items.push({
      factor: 'Robots Meta',
      status: 'pass',
      value: 'Not specified (Defaults to index, follow)',
      note: 'Default search engine crawling behavior applies.'
    });
  }

  // 5. Headings: H1
  const h1Count = headings?.h1Count || 0;
  if (h1Count === 1) {
    items.push({
      factor: 'H1 Heading',
      status: 'pass',
      value: headings.h1[0],
      note: 'Exactly 1 H1 heading found (Optimal).'
    });
  } else if (h1Count === 0) {
    items.push({
      factor: 'H1 Heading',
      status: 'fail',
      value: '0 found',
      note: 'No H1 heading found. A single clear H1 is recommended for topic relevance.'
    });
  } else {
    items.push({
      factor: 'H1 Heading',
      status: 'warning',
      value: `${h1Count} found`,
      note: `Found ${h1Count} H1 headings. Best practice is typically a single H1 per page.`
    });
  }

  // 6. Headings: H2 & H3
  const h2Count = headings?.h2Count || 0;
  const h3Count = headings?.h3Count || 0;
  items.push({
    factor: 'Subheadings (H2 / H3)',
    status: h2Count > 0 ? 'pass' : 'info',
    value: `H2: ${h2Count}, H3: ${h3Count}`,
    note: h2Count > 0 ? 'Good sub-heading hierarchy structure.' : 'No H2 subheadings found.'
  });

  // 7. Image ALT Attributes
  const totalImgs = images?.total || 0;
  const missingAlt = images?.missingAlt || 0;
  if (totalImgs === 0) {
    items.push({
      factor: 'Image ALT Attributes',
      status: 'info',
      value: '0 images',
      note: 'No <img> elements detected.'
    });
  } else if (missingAlt === 0) {
    items.push({
      factor: 'Image ALT Attributes',
      status: 'pass',
      value: `All ${totalImgs} images have ALT text`,
      note: 'Optimal for accessibility and image search SEO.'
    });
  } else {
    items.push({
      factor: 'Image ALT Attributes',
      status: 'warning',
      value: `${missingAlt} of ${totalImgs} missing ALT text`,
      note: `${missingAlt} images lack descriptive ALT attributes.`
    });
  }

  // 8. Link Breakdown
  const totalLinks = links?.total || 0;
  const internalLinks = links?.internal || 0;
  const externalLinks = links?.external || 0;
  const nofollowLinks = links?.nofollow || 0;
  items.push({
    factor: 'Link Distribution',
    status: totalLinks > 0 ? 'pass' : 'info',
    value: `${totalLinks} total (${internalLinks} internal, ${externalLinks} external)`,
    note: `${nofollowLinks} link(s) use rel="nofollow".`
  });

  // 9. Open Graph Metadata
  const og = social?.openGraph;
  if (og && (og.title || og.image || og.description)) {
    items.push({
      factor: 'Open Graph (Social)',
      status: 'pass',
      value: og.title || 'Configured',
      note: `Includes: ${Object.keys(og).join(', ')}`
    });
  } else {
    items.push({
      factor: 'Open Graph (Social)',
      status: 'warning',
      value: 'Not found',
      note: 'Social sharing previews on Facebook, LinkedIn, etc. may be incomplete.'
    });
  }

  // 10. Twitter Card
  const twitter = social?.twitter;
  if (twitter && (twitter.card || twitter.title || twitter.image)) {
    items.push({
      factor: 'Twitter Card',
      status: 'pass',
      value: twitter.card || 'Configured',
      note: `Type: ${twitter.card || 'summary'}`
    });
  } else {
    items.push({
      factor: 'Twitter Card',
      status: 'warning',
      value: 'Not found',
      note: 'Twitter cards provide rich preview cards when shared on X/Twitter.'
    });
  }

  // 11. Structured Data (JSON-LD)
  const jsonLdCount = structuredData?.count || 0;
  if (jsonLdCount > 0) {
    items.push({
      factor: 'Structured Data (JSON-LD)',
      status: 'pass',
      value: `${jsonLdCount} block(s) detected`,
      note: 'Enables rich search results (schema.org).'
    });
  } else {
    items.push({
      factor: 'Structured Data (JSON-LD)',
      status: 'info',
      value: 'None detected',
      note: 'No application/ld+json schemas found in server response.'
    });
  }

  // Compute overall summary counts
  const passes = items.filter(i => i.status === 'pass').length;
  const warnings = items.filter(i => i.status === 'warning').length;
  const fails = items.filter(i => i.status === 'fail').length;

  return {
    disclaimer: 'This is a basic technical inspection based on server-delivered HTML, not a complete algorithmic SEO audit.',
    summary: {
      total: items.length,
      passes,
      warnings,
      fails
    },
    items
  };
}

module.exports = {
  analyzeSeo
};
