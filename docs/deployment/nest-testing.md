# Nest Testing Deployment

The testing host receives only a verified commit from the testing branch. It is the only environment allowed to run the 1,000-client load harness.

## Required environment

    NODE_ENV=production
    POORUP_ALLOWED_ORIGINS=https://testing.poorup.example
    POORUP_DATA_DIR=/srv/poorup/data
    POORUP_BACKUP_DIR=/srv/poorup/backups
    POORUP_MAINTENANCE_TOKEN=<host secret>
    POORUP_RELEASE_ID=<commit SHA>
    POORUP_PERSISTENCE_ADAPTER=json
    POORUP_HORIZONTAL_SCALE=false

## Promotion

1. Merge a reviewed PR into testing.
2. CI must be green.
3. Deploy the exact commit SHA into an immutable release directory.
4. Run health, socket, browser, and load checks.
5. Keep the previous release available for rollback.

testing must not share data, credentials, or sockets with main Production.

## Capacity evidence

After browser and socket smoke checks, run the opt-in harness from a trusted
operator workstation with `POORUP_LOAD_ENV=testing` and the testing URL only:

    POORUP_LOAD_ENV=testing POORUP_LOAD_TARGET=https://testing.poorup.example POORUP_LOAD_CLIENTS=1000 node qa/load/poorup-socket-load.mjs

Store only the JSON summary with the release SHA. Capture event-loop lag,
memory recovery, duplicate-settlement checks, and the drain outcome from the
testing host; the client harness cannot observe those private server metrics.
