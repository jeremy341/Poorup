# All-account data reset runbook

This operation clears every account and account-linked local store, including
sessions, recovery tokens, social links, match history, achievements, seasons,
cosmetics, telemetry, analytics rollups, and their configured store backups.
The global AI-provider configuration and maintenance marker are preserved.

The tool is dry-run by default. It rejects an empty or relative data path,
filesystem roots, repository paths, symlinked data/backup directories, and
symlinked store files. Its report includes only store names, resolved paths,
row/file counts, and the count of unrecognized data files; it never prints
account names, IDs, credentials, recovery addresses, token values, or backup
contents. It also reports only the count of IDs in
`POORUP_ADMIN_ACCOUNT_IDS`, never the IDs themselves.

The known local `__dbg.json`, `__gold_acct.json`, and `__gold_matches.json`
files are classified as account/match data and are included in the purge.
Other unrecognized files still block apply until reviewed.

When `POORUP_DATA_DIR` is unset, the local app defaults to the ignored
`server/data` directory inside its checkout. The special
`--preview-repository-root=<repo>` option is read-only and previews only that
exact `server/data` directory. It cannot be combined with `--apply`. Any
unrecognized data files are counted and block apply until they are classified.
Applying a reset still requires an external data directory; migrate the app's
data to an external `POORUP_DATA_DIR` before the destructive apply step.

## Preconditions

1. Put the application into maintenance/draining mode and stop new matches.
2. Stop the local or hosted process so no store can be rewritten concurrently.
3. Take and verify an operator-controlled backup outside the application data
   directory. Keep it only for the approved recovery window; do not create a
   hidden application-side copy.
4. Set `POORUP_DATA_DIR` and, if configured, `POORUP_BACKUP_DIR` for exactly
   one environment. Never reuse a path copied from another environment.
5. Remove the old `POORUP_ADMIN_ACCOUNT_IDS` values from the persistent local
   and Nest service configurations before reset. Confirm the dry-run reports
   zero configured allowlist entries. The script blocks apply if the current
   process still sees any old admin IDs and requires an explicit
   `--admin-allowlist-cleared` acknowledgement.
6. Review the dry-run paths/counts out of band. Do not paste its output if it
   contains infrastructure paths you do not want in chat.

## Dry-run

From the repository root in PowerShell:

```powershell
$env:POORUP_DATA_DIR = 'C:\path\to\one\environment\data'
$env:POORUP_BACKUP_DIR = 'C:\path\to\one\environment\backups'
node scripts/purge-all-account-data.mjs
```

Repeat separately for local development and Nest. The default command does not
write files. It fails closed if any configured store is malformed or any
allowlisted path is unsafe.

For a local checkout that relies on the legacy in-repository default, use only
this read-only preview; it cannot apply a reset:

```powershell
$repoRoot = (git rev-parse --show-toplevel).Trim()
node scripts/purge-all-account-data.mjs "--preview-repository-root=$repoRoot"
```

## Apply gate

Do not run this command until the owner has reviewed the exact environment,
resolved paths, row/file counts, and the externally verified backup. The
environment path must be repeated exactly in `--expect-data-dir`, and the
explicit phrase is required as a second guard:

```powershell
node scripts/purge-all-account-data.mjs --apply `
  --confirm="DELETE ALL POORUP ACCOUNT DATA" `
  --expect-data-dir="$env:POORUP_DATA_DIR" `
  --admin-allowlist-cleared
```

This is irreversible once the external recovery window expires. Store files
are rewritten atomically one at a time. A caught write failure triggers an
in-process rollback from bytes held in memory; a machine/process crash during
the multi-file operation can still leave a partial reset, so keep the service
stopped and retain the verified external recovery copy until post-checks pass.

After an approved apply, inspect only aggregate health (store parseability,
empty account/session counts, expected global AI-provider configuration,
service readiness) and never log account records. Only after creating and
verifying the replacement account should the operator add that account's new
internal ID to `POORUP_ADMIN_ACCOUNT_IDS` and restart the service. Keep the environment in
maintenance until the owner creates a fresh account and signs in successfully.
