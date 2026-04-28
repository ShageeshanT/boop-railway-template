# syntax=docker/dockerfile:1.7

# ─── Stage 1: builder ──────────────────────────────────────────────
# Full Node image so native deps (Baileys / libsignal) install cleanly.
FROM node:20-bookworm AS builder

WORKDIR /app

# Install dependencies first (better Docker layer cache)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy the rest of the source
COPY . .

# Generate Convex types from the schema. --typecheck=disable avoids
# needing a live deployment connection at build time.
RUN npx convex codegen --typecheck=disable || \
    echo "[warn] convex codegen failed — server may fail to import generated types at runtime. Configure CONVEX_DEPLOY_KEY at build time if you need type generation."

# Build the debug dashboard (outputs to debug/dist/)
RUN npm run build:debug


# ─── Stage 2: runtime ──────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

# System packages: openssh-client lets `railway ssh` work cleanly,
# and ca-certificates is needed for HTTPS to Convex / Anthropic / WhatsApp.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        openssh-client \
        tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy production node_modules + source from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/server ./server
COPY --from=builder /app/convex ./convex
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/debug/dist ./debug/dist
COPY --from=builder /app/.claude ./.claude
COPY --from=builder /app/skills-lock.json ./skills-lock.json
COPY --from=builder /app/assets ./assets

# Install Claude CLI globally so users can `railway ssh` and run `claude`
# to log in once. Credentials land in $HOME/.claude (= /data/.claude with
# the volume mount), so they survive redeploys.
RUN npm install -g @anthropic-ai/claude-code

# Persistent data directory. Mount a Railway volume here.
#   /data/.env       — wizard-written env file
#   /data/.claude/   — Claude CLI credentials
#   /data/.wa-auth/  — WhatsApp Baileys session
RUN mkdir -p /data && chmod 700 /data

ENV HOME=/data \
    BOOP_DATA_DIR=/data \
    WA_AUTH_DIR=/data/.wa-auth \
    NODE_ENV=production \
    PORT=3456

EXPOSE 3456

# tini handles PID 1 signal forwarding (graceful exit on Railway redeploys)
ENTRYPOINT ["/usr/bin/tini", "--"]

# tsx runs TS directly — no separate compile step, restart picks up wizard env writes
CMD ["npx", "tsx", "server/index.ts"]
