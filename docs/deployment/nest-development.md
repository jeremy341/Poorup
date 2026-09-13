# Nest Development Deployment

Nest is the development host for Poorup while the game remains a single modular Node/Express/Socket.IO service.

## Runtime

- release directories are separate from persistent data
- PM2 keeps one poorup process online and restores it on boot
- the app runs as a dedicated poorup user, not root
- PORT, POORUP_DATA_DIR, and POORUP_BACKUP_DIR are provided by the host
- credentials are environment secrets only

## Local development

    npm ci
    npm run dev

## Required checks

    npm run test:full
    npm run lint
    npm run lint:client
    npm run test:browser

Development uses POORUP_MAINTENANCE_MODE=normal and a private data directory. Never point it at Production data.

