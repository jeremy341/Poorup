# Poorup Release Runbook

1. Merge only a reviewed PR into main.
2. Confirm the tier-appropriate gates before the `testing` → `main` hop:
   required checks `test` and `boot smoke` are green, browser QA is green on
   the `development` → `testing` promotion (it runs on that hop, not on every
   PR), the CodeScene cloud check has been reviewed, and human approval is on
   every hop. Once the `testing` merge queue is enabled, heavy-tier checks run
   against the queue's merge result automatically — a green queue group is
   then the primary evidence for this step.
3. Record the release SHA.
4. Create and verify a backup.
5. Set maintenance to DRAINING.
6. Block new rooms and new round starts.
7. Wait for active rounds to reach zero.
8. Deploy the exact SHA.
9. Run /healthz, /readyz, and Socket.IO smoke tests.
10. Set maintenance to NORMAL.
11. Monitor Analytics and logs.
12. Keep the previous release for rollback.

Keep `development`, `testing`, and `main` as permanent branches. When merging
promotion PRs, do not enable source-branch deletion; only short-lived feature
branches may be deleted after their PR is merged.

If active rounds do not reach zero before the approved deadline, stop the deployment rather than forcefully restarting the server.

