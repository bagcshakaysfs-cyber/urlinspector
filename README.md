# Web Inspector 🔍

> A clean, lightweight, production-ready website status and HTML inspection tool designed for Heroku hosting, Docker deployment, and developer dashboards.

Web Inspector allows developers, DevOps engineers, and webmasters to enter any publicly accessible URL or bare domain to inspect its HTTP response status, redirect chains, headers, technical metadata, HTML structure, SEO health, security headers, DNS records, and TLS certificate information.

---

## Features

- **Accurate HTTP Status & Timing:** Real-time response status, category indicators (2xx Success, 3xx Redirect, 4xx Client Error, 5xx Server Error), latency measurement in milliseconds, protocol detection, and remote server fingerprinting.
- **Redirect Chain Tracing:** Visual step-by-step breakdown of multi-hop redirects with status codes (301, 302, 307, 308), `Location` targets, and per-hop latencies. Includes cycle/loop detection.
- **Strict SSRF & DNS Rebinding Protections:** Pre-resolution IP validation blocking loopback (`127.0.0.0/8`, `::1`), private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local/APIPA (`169.254.0.0/16`), cloud metadata services (`169.254.169.254`, `metadata.google.internal`), carrier-grade NAT, and IPv4-mapped IPv6 ranges.
- **Realistic Browser Emulation:** Sends realistic desktop Chrome/Edge `User-Agent` and navigation headers (`Accept`, `Accept-Language`, `Sec-Ch-Ua`, `Sec-Fetch-*`) to prevent anti-bot blocking by public web servers.
- **Cheerio HTML Parsing:** Calculates DOM element counts, forms, links, images, scripts, and stylesheets.
- **`<head>` & Metadata Extraction:** Title, meta description, keywords, robots directives, canonical URL, document language, charset, viewport, and favicon.
- **Technical SEO Audit:** Heading hierarchy (H1, H2, H3), images missing `alt` attributes, internal vs external link distribution, `rel="nofollow"` detection, Open Graph metadata, Twitter Cards, and schema.org JSON-LD structured data.
- **Security Headers & Cookie Masking:** Checks for HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and Permissions-Policy. Extracts `Set-Cookie` metadata with cookie values automatically masked (`••••••••`) for privacy.
- **DNS & TLS Inspection:** Public DNS records (A, AAAA, CNAME, MX, TXT) and HTTPS certificate validity, issuer, cipher suite, and expiry countdown.
- **Interactive Raw HTML Viewer:** Token-based syntax highlighting, line numbers gutter, live code search with match highlighting, one-click copy, `.html` file download, and fullscreen toggle.
- **Heroku & Docker Ready:** Configured with `Procfile`, reverse proxy trust (`trust proxy: 1`), health check endpoint (`/api/health`), and unprivileged non-root Dockerfile.

---

## Architecture

```text
/public
  /css/app.css            # Custom dark mode stylesheet, glassmorphism & responsive grid
  /js/app.js              # Application controller, form handlers & tabs
  /js/inspector.js        # API client & progressive status tracking
  /js/ui.js               # DOM renderers, tables & code viewer
  index.html              # Modern dashboard UI
  robots.txt              # Production crawling rules
  sitemap.xml             # Application sitemap

/src
  url-validator.js        # URL normalization, port check & SSRF defense
  fetcher.js              # Safe HTTP client, redirects, stream byte limits & timeouts
  parser.js               # Cheerio HTML parser, head metadata & DOM tree
  seo-analyzer.js         # Technical SEO health audit
  security-headers.js     # Security header evaluations & cookie masking
  dns.js                  # DNS queries (A, AAAA, CNAME, MX, TXT)
  tls.js                  # TLS certificate and cipher inspection
  inspector.js            # Main inspection orchestrator

/test
  url-validator.test.js   # SSRF & normalization unit tests
  parser.test.js          # HTML parser and SEO unit tests
  security-headers.test.js# Security headers and cookie masking unit tests
  api.test.js             # Mock HTTP server integration tests

server.js                 # Express server with rate limiting and static serving
Procfile                  # Heroku process definition
Dockerfile                # Production-ready multi-stage container
.env.example              # Environment variables template
```

---

## Installation & Local Development

### Prerequisites
- Node.js 20.0.0 or higher
- npm 10.0.0 or higher

### Setup

1. Clone or navigate to the repository:
   ```bash
   cd "curl status checker"
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the environment configuration template:
   ```bash
   cp .env.example .env
   ```

4. Run the development server (with automatic reload):
   ```bash
   npm run dev
   ```

5. Open your browser at `http://localhost:3000`.

### Running Tests
Run the built-in Node.js automated test suite:
```bash
npm test
```

---

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for the HTTP server. Assessed dynamically on Heroku. |
| `NODE_ENV` | `development` | Environment mode (`production` or `development`). |
| `REQUEST_TIMEOUT_MS` | `10000` | Maximum timeout for outbound HTTP requests (10s). |
| `MAX_RESPONSE_SIZE` | `5242880` | Maximum response payload size in bytes (5 MB). |
| `MAX_REDIRECTS` | `5` | Maximum number of redirect hops before aborting. |
| `ALLOWED_PORTS` | `80,443,8080,8443` | Permitted outbound target ports. |
| `RATE_LIMIT_WINDOW_MS` | `600000` | Rate limiter window in milliseconds (10 minutes). |
| `RATE_LIMIT_MAX` | `30` | Maximum requests per IP per rate limit window. |
| `USER_AGENT` | Chrome Desktop UA | Browser User-Agent header used when inspecting websites. |

---

## Heroku Deployment

This application is configured out of the box for Heroku hosting:

1. Create a Heroku application:
   ```bash
   heroku create web-inspector-app
   ```

2. Set environment variables on Heroku:
   ```bash
   heroku config:set NODE_ENV=production
   ```

3. Deploy using Git:
   ```bash
   git push heroku main
   ```

4. Verify that the dyno is up:
   ```bash
   heroku ps:scale web=1
   heroku open
   ```

The application automatically respects Heroku's assigned `$PORT` and utilizes `app.set('trust proxy', 1)` to accurately detect client IPs for rate limiting behind the Heroku router.

---

## Docker Deployment

Build and run using the production Dockerfile:

```bash
# Build the Docker image
docker build -t web-inspector .

# Run the container
docker run -d -p 3000:3000 --name web-inspector web-inspector

# Check health status
curl http://localhost:3000/api/health
```

---

## REST API Documentation

### Inspect Website
Inspects a public URL or bare domain.

```http
GET /api/inspect?url={target_url}
```

#### Request Parameters
- `url` (required, string): The target URL or domain (e.g. `https://example.com` or `example.com`).

#### Example cURL
```bash
curl "http://localhost:3000/api/inspect?url=https://example.com"
```

#### Example Response
```json
{
  "success": true,
  "url": "https://example.com/",
  "finalUrl": "https://example.com/",
  "status": {
    "code": 200,
    "text": "OK",
    "category": "success",
    "httpVersion": "HTTP/1.1"
  },
  "responseTime": 248,
  "protocol": "HTTPS",
  "contentType": "text/html",
  "contentLength": 1256,
  "server": "ECS (dcb/7F83)",
  "redirects": [],
  "headers": {
    "content-type": "text/html; charset=UTF-8",
    "cache-control": "max-age=604800"
  },
  "html": {
    "stats": {
      "totalSize": 1256,
      "domElements": 15,
      "links": 1,
      "images": 0,
      "scripts": 0,
      "stylesheets": 0
    },
    "head": {
      "title": "Example Domain",
      "viewport": "width=device-width, initial-scale=1"
    }
  },
  "seo": {
    "summary": { "passes": 6, "warnings": 2, "fails": 0 }
  },
  "security": {
    "score": { "passed": 2, "warnings": 1, "missing": 3 },
    "cookies": []
  },
  "dns": {
    "records": { "a": ["93.184.216.34"] }
  }
}
```

---

## Security & SSRF Protection

Web Inspector is designed to be a **public website inspector**, not an internal network scanner. Strict protections are applied at every stage:

1. **Protocol Whitelist:** Only `http:` and `https:` schemes are allowed. Schemes like `file:`, `ftp:`, `gopher:`, or `javascript:` are rejected immediately.
2. **Pre-connection DNS & IP Filtering:** The application resolves the target hostname via DNS before making any socket connection. If the target resolves to any loopback (`127.0.0.0/8`, `::1`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`), cloud metadata (`169.254.169.254`, `metadata.google.internal`), or broadcast address, the connection is immediately aborted.
3. **Redirect Hop Re-validation:** Every hop in a redirect chain is re-validated with full IP checks before the client follows the redirect `Location`.
4. **Port Restrictions:** Outbound connections are restricted by default to ports `80`, `443`, `8080`, and `8443`.
5. **Memory & Size Safeguards:** Responses are streamed with a strict 5 MB cumulative limit and a 10-second timeout to prevent denial-of-service or heap exhaustion.
6. **Cookie Masking:** Set-Cookie values returned by remote hosts are obfuscated (`••••••••`) so authentication tokens are never exposed in reports.

---

## Technical Limitations

- **Server-Rendered HTML Only:** Web Inspector fetches the raw HTTP response delivered by the target server. It does **not** execute client-side JavaScript Single Page Applications (React, Vue, Angular client-side hydration). Dynamic DOM elements created exclusively in the browser after execution may not appear in the static source.
- **Bot Countermeasures:** While the tool uses realistic desktop browser User-Agents and navigation headers, websites protected by advanced interactive JavaScript challenges (e.g. Cloudflare Turnstile, browser fingerprinting CAPTCHAs) may return challenge pages.

---

## License

MIT License. Open source for educational and operational use.
