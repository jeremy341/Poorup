# Poorup Rollback Runbook

1. Keep maintenance state visible.
2. Identify the last known-good release tag.
3. Verify its release directory and backup exist.
4. Switch the active release symlink back.
5. Reload PM2 under the dedicated runtime user.
6. Verify /healthz, /readyz, and Socket.IO.
7. Return to NORMAL only after smoke checks pass.
8. Record the failed SHA and reason.

Rollback never force-pushes, rewrites main, or deletes the failed release before the incident is recorded.

