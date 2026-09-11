FROM node:20-alpine AS base

# Install dependencies for Chromium headless browser
RUN apk add --no-cache \
    curl \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont && \
    ln -sf /usr/bin/chromium /usr/bin/chromium-browser 2>/dev/null || true

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy source code and public assets
COPY . .

# Ensure cache directory exists and node user owns /app
RUN mkdir -p /app/.cache/puppeteer && chown -R node:node /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Set non-root user
USER node

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start the application
CMD ["node", "server.js"]
