FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY public ./public
COPY server ./server
COPY ecosystem.config.cjs ./

ENV NODE_ENV=production
ENV PORT=8080
# Durable defaults: JSON stores, sessions, and backups live under
# /var/lib/poorup. Mount a volume there or set POORUP_DATA_DIR /
# POORUP_BACKUP_DIR explicitly — otherwise restarts wipe state.
ENV POORUP_DATA_DIR=/var/lib/poorup
ENV POORUP_BACKUP_DIR=/var/lib/poorup/backups
VOLUME ["/var/lib/poorup"]
# Persistent JSON stores live outside the image layer: mount a volume at
# /var/lib/poorup and set POORUP_DATA_DIR + POORUP_BACKUP_DIR to match,
# otherwise restarts lose accounts, matches, and sessions.
VOLUME ["/var/lib/poorup"]

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]

