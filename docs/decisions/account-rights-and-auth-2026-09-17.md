# Account Rights and Authentication Decision Record

**Decision date:** 2026-09-17  
**Status:** Owner-confirmed product decisions; implementation is not yet applied.  
**Scope:** Account profile, export, deletion, recovery, sessions, retention, and related release gates.

## Confirmed decisions

| Area | Decision | Required behavior |
|---|---|---|
| Deletion lifecycle | 30-day deactivation | The account becomes restricted immediately; a daily job permanently processes accounts whose grace period has expired. |
| Entry point | Profile section only | Only an authenticated Profile → Account surface exposes account deletion, export, session revocation, or recovery-email controls. No footer, lobby, Social, or game shortcut is added. |
| Active round | Block request | A seated account cannot request deletion until it leaves the active table. The Profile surface explains `LEAVE TABLE FIRST`. |
| Confirmation | Password + typed phrase | The user re-enters the current password and types the exact phrase `DELETE ACCOUNT`. The server validates both values. |
| Immediate sessions | Revoke other sessions | Every other session is revoked when the request is accepted. The current session remains only for the restricted recovery/deletion-pending view. |
| Grace-period actions | Restricted profile only | Export, recovery-email management, cancel deletion, and sign-out remain available. Playing, Social actions, account edits, and new room participation are blocked. |
| Cancellation | Self-service | The user signs in during the grace period, opens Profile, chooses `CANCEL ACCOUNT DELETION`, and confirms with the current password. |
| Final data scope | Personal purge + aggregate retention | Delete profile, sessions, Social relationships/notifications, Cosmetics, personal match history, achievements, and account-linked projections. Keep only irreversibly anonymized aggregate analytics/balance rows. |
| Guest history | Local-only | Do not persist personally identifiable guest match history. Only the active room and local client state may contain guest identity; aggregate analytics are allowed after sanitization. |
| Analytics retention | 12 months | Aggregate/pseudonymous analytics and balance observations are automatically pruned after 12 months. |
| Backup retention | 30 days | Backups rotate for 30 days. A completed account purge marks affected backup generations for early cleanup or verified anonymization. |
| Account export | Immediate JSON download | Export includes the owner’s profile, saved designs, statistics, match history, achievements, Social data, and recovery-email state. It excludes password hashes/salts, session tokens/hashes, private opponent terms, raw chat, provider credentials, and internal secrets. |
| Recovery email | Optional after creation | A user may add an address from Profile after account creation. It is inactive until verified through a single-use 30-minute link. |
| Recovery reset | Provider-neutral email | Password reset uses a single-use 30-minute token and revokes all sessions after a successful reset. |
| Recovery notifications | Full lifecycle notices | Send notices for deletion request, cancellation, and final deletion. Never include secrets or private game data. |
| Recovery-email change | Re-verify replacement | Require current password, verify the new address, notify the old verified address, and retain the old address until the new one is confirmed. |
| Sessions | 30/90 policy | Expire after 30 days of inactivity or 90 days absolute lifetime. A successful login issues a new token and revokes prior tokens. |
| Session storage | Server-side sessions + secure cookie | Keep the session record server-side and issue one `HttpOnly`, `Secure`, `SameSite` cookie per device. A new device can sign in independently; no bearer session token is persisted in `localStorage`. |
| Cross-tab state | Immediate synchronization | Logout, revocation, deactivation, and cancellation propagate through the existing storage-event/session reconciliation path. |
| Username reuse | Delayed release | Reserve the username during the 30-day period; release it only after final deletion succeeds. |
| Public visibility | Hide immediately | Deactivated accounts disappear from search, rankings, Friends, invites, and public profiles. Existing references display `ACCOUNT DEACTIVATED`. |
| Mail adapter | Provider-neutral | Use `POORUP_MAIL_API_URL`, `POORUP_MAIL_API_KEY`, and `POORUP_MAIL_FROM`; no provider secret is committed. |
| Support | GitHub Issues | Publish the repository Issues URL (`https://github.com/jeremy341/Poorup/issues`) for support, export, deletion, and bug reports. |
| Terms | No Terms-of-Service page | Do not create or restore a Terms-of-Service route. The release adds only the approved compact Privacy & Account Deletion information surface. |

## Data contract

The account-delete request must derive the account identity from the authenticated
session. A client-supplied account ID is ignored. The validated request shape is:

```text
account-delete {
  requestId: bounded opaque string,
  sessionToken: current bearer,
  currentPassword: 8–72 character string,
  typedUsername: exact normalized username,
  accountId: server-derived only
}
```

The server must be transaction-like across stores: if any required purge step fails,
the account, sessions, Social data, local acknowledgement state, and deletion marker
remain unchanged and the client receives an actionable failure. A retry with the same
`requestId` returns the memoized result without repeating the purge.

## Retained aggregates

Retained rows must contain only bounded measures, a pseudonymous key generated by the
existing analytics HMAC boundary, rule/board/balance revisions, and timestamps needed
for the 12-month retention job. They must not contain usernames, account IDs, room
codes, chat, raw events, exact private deal terms, provider payloads, IP addresses, or
User-Agent values.

## Remaining owner facts before public launch

The following are operational facts, not product-policy inventions, and must be
entered into deployment configuration before enabling the public account release:

- mail provider endpoint, API key, sender identity, and delivery domain;
- the operator identity shown on the Privacy page;
- the canonical HTTPS origin and index/no-index policy;
- the final Privacy copy review and last-updated date;
- production backup directory, retention job owner, and monitoring destination.

No production code should claim that deletion, email recovery, or the Privacy page is
active until those configuration facts and the implementation tests are present.
