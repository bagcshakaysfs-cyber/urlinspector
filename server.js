require('dotenv').config();
const path = require('node:path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { inspectWebsite } = require('./src/inspector');
const { createWebsiteArchive } = require('./src/archiver');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Heroku router and reverse proxies (enables correct client IP in req.ip)
app.set('trust proxy', 1);

// Disable X-Powered-By header for cleaner fingerprint
app.disable('x-powered-by');

// Rate limiting configuration
const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 10 * 60 * 1000; // 10 minutes
const maxRequests = parseInt(process.env.RATE_LIMIT_MAX, 10) || 30; // 30 requests per window

const apiLimiter = rateLimit({
  windowMs,
  max: maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: `Rate limit exceeded. Maximum ${maxRequests} inspection requests per 10 minutes. Please try again later.`
  }
});

// Parse JSON and urlencoded bodies if needed
app.use(express.json({ limit: '1mb' }));

// Serve static assets from public/ directory
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  etag: true
}));

// Health check endpoint for Heroku, Docker, and monitoring
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    app: 'Web Inspector',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Primary Inspection API Endpoint (Supports mode=fast and mode=dynamic)
app.get('/api/inspect', apiLimiter, async (req, res, next) => {
  const targetUrl = req.query.url;
  const mode = req.query.mode === 'dynamic' ? 'dynamic' : 'fast';

  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Query parameter "url" is required (e.g. /api/inspect?url=https://example.com).'
    });
  }

  try {
    const result = await inspectWebsite(targetUrl, { mode });
    if (!result.success) {
      return res.status(422).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// Offline Website & Asset Archiver Endpoint (.zip streaming supporting GET & POST with selected assets)
async function handleArchiveRequest(req, res, next) {
  const targetUrl = req.method === 'POST' ? req.body?.url : req.query.url;
  const mode = (req.method === 'POST' ? req.body?.mode : req.query.mode) === 'dynamic' ? 'dynamic' : 'fast';
  const selectedUrls = req.method === 'POST' ? req.body?.selectedUrls : null;

  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Parameter "url" is required (e.g. url=https://example.com).'
    });
  }

  try {
    let preloadedHtml = null;
    if (mode === 'dynamic') {
      const inspectRes = await inspectWebsite(targetUrl, { mode: 'dynamic' });
      if (inspectRes.success && inspectRes.rawHtml) {
        preloadedHtml = inspectRes.rawHtml;
      }
    }

    const { archive, stats } = await createWebsiteArchive(targetUrl, {
      html: preloadedHtml,
      selectedUrls
    });

    let safeHost = 'website';
    try {
      safeHost = new URL(targetUrl).hostname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    } catch {
      // Fallback
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="bundle-${safeHost}.zip"`);
    res.setHeader('X-Archived-Assets', String(stats.downloadedAssets));

    archive.pipe(res);
  } catch (err) {
    next(err);
  }
}

app.get('/api/archive', apiLimiter, handleArchiveRequest);
app.post('/api/archive', apiLimiter, handleArchiveRequest);

// Centralized error handler: never leak stack traces to client
app.use((err, req, res, _next) => {
  console.error('[WebInspector Error]', {
    message: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    url: req.url,
    ip: req.ip
  });

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: err.message || 'Internal server error during website inspection.'
  });
});

// Handle 404 for unmapped API routes
app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API route '${req.method} ${req.path}' not found.`
  });
});

// Fallback to index.html for frontend routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`[Web Inspector] Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode.`);
  console.log(`[Web Inspector] URL: http://localhost:${PORT}`);
});

// Graceful shutdown handling for Heroku and Docker SIGTERM/SIGINT
function handleShutdown(signal) {
  console.log(`[Web Inspector] Received ${signal}. Starting graceful shutdown...`);
  server.close(() => {
    console.log('[Web Inspector] HTTP server closed.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[Web Inspector] Forcefully terminating after timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

module.exports = app;
