# Nest Development and Testing Environments

Poorup runs as a modular Node/Express/Socket.IO service. Development and testing
are separate environments with isolated data, credentials, and sockets.

## Development

Nest Development is for development builds. It uses
`POORUP_MAINTENANCE_MODE=normal` and a private data directory. Never point it at
Production data.

- release directories stay separate from persistent data
- PM2 keeps one `poorup` process online and restores it on boot
- the service runs as the dedicated `poorup` user, not root

Local development:

```sh
npm ci
npm run dev
```

Run the required checks before promotion:

```sh
npm run test:full
npm run lint
npm run lint:client
npm run test:browser
```

The host provides `PORT`, `POORUP_DATA_DIR`, and `POORUP_BACKUP_DIR` as
environment configuration. Credentials are secrets, not repository files.

## Testing

The testing host receives only a verified commit from the `testing` branch. It
is the only environment allowed to run the 1,000-client load harness.

Required environment:

```sh
NODE_ENV=production
POORUP_ALLOWED_ORIGINS=https://testing.poorup.example
POORUP_DATA_DIR=/srv/poorup/data
POORUP_BACKUP_DIR=/srv/poorup/backups
POORUP_MAINTENANCE_TOKEN=<host secret>
POORUP_RELEASE_ID=<commit SHA>
POORUP_PERSISTENCE_ADAPTER=json
POORUP_HORIZONTAL_SCALE=false
```

Promotion and verification:

1. Merge a reviewed PR into `testing`.
2. Require green CI.
3. Deploy the exact commit SHA into an immutable release directory.
4. Run health, socket, browser, and load checks.
5. Keep the previous release available for rollback.

After browser and socket smoke checks, run the opt-in harness from a trusted
operator workstation with the testing URL only:

```sh
POORUP_LOAD_ENV=testing POORUP_LOAD_TARGET=https://testing.poorup.example POORUP_LOAD_CLIENTS=1000 node qa/load/poorup-socket-load.mjs
```

Store only the JSON summary with the release SHA. Capture event-loop lag,
memory recovery, duplicate-settlement checks, and the drain outcome from the
testing host; the client harness cannot observe those private server metrics.

Testing must not share data, credentials, or sockets with Production.
