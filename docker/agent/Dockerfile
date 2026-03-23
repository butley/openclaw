# Butley Agent Dockerfile - Multi-stage optimized build
# 
# Build context: butley/openclaw (the fork directory)
# Uses multi-stage build for minimal image size while preserving all functionality

# ============================================================
# STAGE 1: Builder - Build with all dev dependencies
# ============================================================
FROM node:25-bookworm AS builder

# Install Bun (required for build scripts like a2ui bundle)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Install latest corepack and enable pnpm
RUN npm install -g --force corepack@latest && corepack enable

WORKDIR /opt/openclaw

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

# Install ALL dependencies (dev + prod needed for build)
RUN CI=true pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the main project (tsdown bundle)
# a2ui bundling can fail due to TypeScript bugs; fall back gracefully
RUN OPENCLAW_A2UI_SKIP_MISSING=1 pnpm build || \
    (echo "Full build failed, trying without a2ui..." && \
     OPENCLAW_A2UI_SKIP_MISSING=1 tsdown && \
     pnpm build:plugin-sdk:dts && \
     node --import tsx scripts/write-plugin-sdk-entry-dts.ts && \
     node --import tsx scripts/canvas-a2ui-copy.ts && \
     node --import tsx scripts/copy-hook-metadata.ts && \
     node --import tsx scripts/write-build-info.ts && \
     node --import tsx scripts/write-cli-compat.ts) || \
    (test -f dist/entry.js && echo "Build partially succeeded, continuing...")

# Copy butley-api extension to dist (custom fork extension, not built by tsdown)
RUN cp -r extensions/butley-api dist/extensions/butley-api

# Build the Control UI
ENV OPENCLAW_PREFER_PNPM=1
RUN CI=true pnpm ui:build

# Verify build output
RUN test -f /opt/openclaw/dist/entry.js && echo "✅ Build verified: entry.js exists"

# Prune to production-only dependencies
RUN CI=true pnpm install --prod --frozen-lockfile --ignore-scripts && \
    pnpm rebuild --pending || true

# Aggressively remove unnecessary packages that leaked through workspace deps
# Target: linux/amd64 (GNU libc) - remove ARM64, musl, and dev tools
RUN rm -rf \
    # node-llama-cpp - remove ALL variants (not used in agent)
    node_modules/.pnpm/@node-llama-cpp+linux-*@*/             \
    node_modules/.pnpm/@node-llama-cpp+darwin-*@*/            \
    node_modules/.pnpm/node-llama-cpp@*/                       \
    # LanceDB - keep x64-gnu, remove arm64 and musl
    node_modules/.pnpm/@lancedb+lancedb-linux-arm64-*@*/      \
    node_modules/.pnpm/@lancedb+lancedb-linux-x64-musl@*/     \
    node_modules/.pnpm/@lancedb+lancedb-darwin-*@*/           \
    # Canvas - keep x64-gnu latest, remove arm64, musl, old versions
    node_modules/.pnpm/@napi-rs+canvas-linux-arm64-*@*/       \
    node_modules/.pnpm/@napi-rs+canvas-linux-x64-musl@*/      \
    node_modules/.pnpm/@napi-rs+canvas-darwin-*@*/            \
    node_modules/.pnpm/@napi-rs+canvas-linux-x64-gnu@0.1.89*/ \
    # Sharp - keep x64 gnu, remove arm64 and musl
    node_modules/.pnpm/@img+sharp-libvips-linux-arm64@*/      \
    node_modules/.pnpm/@img+sharp-libvips-linuxmusl-*@*/      \
    node_modules/.pnpm/@img+sharp-libvips-darwin-*@*/         \
    # Dev tools (never needed at runtime)
    node_modules/.pnpm/esbuild@*/                              \
    node_modules/.pnpm/@esbuild*/                              \
    node_modules/.pnpm/@oxlint*/                               \
    node_modules/.pnpm/@oxlint-tsgolint*/                      \
    node_modules/.pnpm/oxlint*/                                \
    node_modules/.pnpm/@typescript+native-preview*/            \
    node_modules/.pnpm/typescript@*/                           \
    node_modules/.pnpm/@rolldown*/                             \
    node_modules/.pnpm/rolldown@*/                             \
    node_modules/.pnpm/tsdown@*/                               \
    node_modules/.pnpm/tsx@*/                                  \
    node_modules/.pnpm/vitest*/                                \
    node_modules/.pnpm/@vitest*/                               \
    node_modules/.pnpm/oxfmt*/                                 \
    2>/dev/null || true

# ============================================================
# STAGE 2: Runtime (minimal image with all Butley agent deps)
# ============================================================
FROM node:25-slim AS runtime

# Install runtime system dependencies including Python (for agent skills)
# build-essential needed for native modules like better-sqlite3 (QMD dependency)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    git \
    jq \
    openssl \
    python3 \
    python3-pip \
    python3-venv \
    unzip \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Install QMD for semantic memory search (long-term memory)
# Using npm with Node 25 (has native node:sqlite support)
# Then remove build-essential (only needed for compiling better-sqlite3)
RUN npm install -g @tobilu/qmd && \
    ln -sf /usr/local/lib/node_modules/@tobilu/qmd/bin/qmd /usr/local/bin/qmd && \
    apt-get purge -y build-essential && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# QMD models are NOT baked into image - they are mounted from host at runtime:
#   /var/data/qmd-models -> /root/.cache/qmd/models (read-only)
# This keeps the image small (~1.2GB vs ~3.3GB) and allows model updates without rebuild.
# See container_manager.py for volume mount configuration.

# Install gog CLI (Google Gmail/Calendar/Drive integration)
ARG GOGCLI_VERSION=0.9.0
RUN curl -L "https://github.com/steipete/gogcli/releases/download/v${GOGCLI_VERSION}/gogcli_${GOGCLI_VERSION}_linux_amd64.tar.gz" \
  | tar -xz -C /usr/local/bin gog && chmod +x /usr/local/bin/gog

# Install Poetry (for agent skills that need Python)
RUN pip3 install --break-system-packages poetry==1.8.4 || true

# Enable corepack for pnpm (needed if any pnpm commands are used at runtime)
RUN npm install -g --force corepack@latest && corepack enable

# Install Chrome for Testing + Puppeteer Stealth for browser automation
# Chrome for Testing is Google's official automation-ready Chrome channel.
# puppeteer-extra-plugin-stealth provides ~12 anti-detection evasions that
# bypass WAFs (Imperva, Cloudflare, DataDome) which block vanilla headless Chrome.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libx11-6 \
    libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    fonts-liberation wget \
    && CHROME_VERSION=$(wget -qO- "https://googlechromelabs.github.io/chrome-for-testing/LATEST_RELEASE_STABLE") \
    && wget -q "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" -O /tmp/chrome.zip \
    && unzip -q /tmp/chrome.zip -d /opt/ \
    && mv /opt/chrome-linux64 /opt/chrome \
    && ln -sf /opt/chrome/chrome /usr/local/bin/chrome \
    && rm /tmp/chrome.zip \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

WORKDIR /opt/openclaw

# Copy only what's needed for runtime:
# 1. Built dist (bundled JS + control UI + canvas host + hooks + plugin-sdk)
COPY --from=builder /opt/openclaw/dist ./dist

# 2. Entry point
COPY --from=builder /opt/openclaw/openclaw.mjs ./openclaw.mjs

# 3. Package metadata (needed for node module resolution)
COPY --from=builder /opt/openclaw/package.json ./package.json
COPY --from=builder /opt/openclaw/pnpm-workspace.yaml ./pnpm-workspace.yaml

# 4. Production node_modules (native bindings, non-bundled deps)
COPY --from=builder /opt/openclaw/node_modules ./node_modules

# 5. Install puppeteer packages into app node_modules (after COPY so dir exists)
# Use a temp dir to install then copy — avoids npm errors from pnpm workspace package.json.
RUN cd /tmp && npm init -y > /dev/null 2>&1 \
    && npm install puppeteer-core puppeteer-extra puppeteer-extra-plugin-stealth \
    && cp -r /tmp/node_modules/puppeteer-core /opt/openclaw/node_modules/ \
    && cp -r /tmp/node_modules/puppeteer-extra* /opt/openclaw/node_modules/ \
    && cp -r /tmp/node_modules/deepmerge /opt/openclaw/node_modules/ 2>/dev/null || true \
    && rm -rf /tmp/node_modules /tmp/package.json /tmp/package-lock.json

# 5. Runtime assets (assets excluded - images ignored by .dockerignore)
COPY --from=builder /opt/openclaw/extensions ./extensions
COPY --from=builder /opt/openclaw/skills ./skills
COPY --from=builder /opt/openclaw/docs ./docs

# 6. Entrypoint/scripts (from docker/agent in the context)
COPY docker/agent/entrypoint.sh /entrypoint.sh
COPY docker/agent/bootstrap.py /bootstrap.py
COPY docker/agent/scripts/elevenlabs-stt.sh /usr/local/bin/elevenlabs-stt.sh
RUN chmod +x /entrypoint.sh /usr/local/bin/elevenlabs-stt.sh

# Create symlink for CLI access (use openclaw.mjs for proper ESM loading)
RUN ln -s /opt/openclaw/openclaw.mjs /usr/local/bin/openclaw && \
    chmod +x /opt/openclaw/openclaw.mjs

# Verify the build
RUN openclaw --version || echo "Version check skipped"

# Environment
ENV NODE_ENV=production \
    TZ=America/New_York \
    HOME=/root \
    PATH="/opt/openclaw/node_modules/.bin:/root/.local/bin:/usr/local/bin:$PATH" \
    OPENCLAW_PORT=18789 \
    OPENCLAW_BIND=lan \
    XDG_CACHE_HOME=/root/.openclaw

# Create runtime directories
RUN mkdir -p /root/.openclaw /root/.openclaw/devices /root/workspace

WORKDIR /root

EXPOSE 18789

ENTRYPOINT ["/entrypoint.sh"]
