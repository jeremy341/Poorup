FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY public ./public
COPY server ./server
COPY ecosystem.config.cjs ./

ENV NODE_ENV=production
ENV PORT=8080

USER node
EXPOSE 8080
CMD ["node", "server/server.js"]

