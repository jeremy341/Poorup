FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY public ./public
COPY server ./server
# The ecosystem file reads the host env file through this helper.
COPY scripts/loadEnvFile.cjs ./scripts/loadEnvFile.cjs
COPY ecosystem.config.cjs ./

ENV NODE_ENV=production
ENV PORT=8080
# Production refuses to boot without explicit positive rate limits; these match
# the defaults in .env.example.
ENV POORUP_HTTP_RATE_LIMIT=240
ENV POORUP_HTTP_RATE_WINDOW_MS=60000
ENV POORUP_SOCKET_RATE_LIMIT=120
ENV POORUP_SOCKET_RATE_WINDOW_MS=60000
# Durable defaults: JSON stores, sessions, and backups live under
# /var/lib/poorup. Mount a volume there or set POORUP_DATA_DIR /
# POORUP_BACKUP_DIR explicitly. Otherwise restarts wipe state.
ENV POORUP_DATA_DIR=/var/lib/poorup/data
ENV POORUP_BACKUP_DIR=/var/lib/poorup/backups
# Create the data and backup directories owned by the runtime user before the
# volume is declared, so a fresh volume inherits node ownership and writes work.
RUN mkdir -p /var/lib/poorup/data /var/lib/poorup/backups && chown -R node:node /var/lib/poorup
# Persistent JSON stores live outside the image layer: mount a volume at
# /var/lib/poorup, otherwise restarts lose accounts, matches, and sessions.
VOLUME ["/var/lib/poorup"]

USER node
EXPOSE 8080
# Readiness, not liveness: a draining or backup-stale container reports unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]
