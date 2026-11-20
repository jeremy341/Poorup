# Documentation index

Start with the [project README](../README.md): setup, how to run the tests, a map
of the repo and a ten-minute architecture overview. This folder holds the
reference and runbook documents behind it. To deploy, read the release runbook,
then the live runbook; to roll back, the rollback runbook.

## Running and operating the service

| Document | What it is for |
| --- | --- |
| [production-hardening.md](production-hardening.md) | Production environment variables, storage layout, backups and the checks to run before and after a deploy. |
| [deployment/nest-environments.md](deployment/nest-environments.md) | How the development and testing environments are separated, and the load-test gate. |
| [deployment/nest-live-runbook.md](deployment/nest-live-runbook.md) | The live Nest host: how it was migrated, the automatic deploy path, domain routing, and emergency rollback. |
| [deployment/release-runbook.md](deployment/release-runbook.md) | The ordered release checklist, from reviewed merge to verification. |
| [deployment/rollback-runbook.md](deployment/rollback-runbook.md) | Rolling a release back. |
| [admin-console.md](admin-console.md) | The operator console at `/admin/analytics`: tabs, admin endpoints, live counters and known gaps. |

## Security and abuse protection

| Document | What it is for |
| --- | --- |
| [security-notes.md](security-notes.md) | What the server protects and where: sockets, accounts, sessions, operator routes, the container; plus the November 2026 fixes and open decisions. |
| [security-headers.md](security-headers.md) | The HTTP response policy (CSP, security headers, host and timeout guards) and why each directive is there. |
| [rate-limits.md](rate-limits.md) | Every rate limit and abuse budget, its environment variable, and which HTTP routes and socket events it covers. |

## Product and UI reference

| Document | What it is for |
| --- | --- |
| [seo.md](seo.md) | Search indexing, link previews, `robots.txt`, `llms.txt`, structured data and how to switch indexing on. |
| [modal-action-rules.md](modal-action-rules.md) | Rules for the primary, secondary and dismiss actions of every modal and overlay. |
| [sponsored-purchase.md](sponsored-purchase.md) | How a sponsored property purchase works (escrowed contributions, accept and cancel rules, bot behavior). |
| [feature-status.json](feature-status.json) | Machine-checked list of product features with the files that prove each one; `server/docsFeatureStatus.test.js` verifies every path exists. |
| [../design/poorup_design_system.md](../design/poorup_design_system.md) | Visual design system: colors, type, spacing and components. |
| [../PRODUCT.md](../PRODUCT.md) | Product purpose, users, constraints and principles. |

## Other documentation in the repo

| Document | What it is for |
| --- | --- |
| [../AGENTS.md](../AGENTS.md) | Rules for coding agents working in this repository. |
| [../.env.example](../.env.example) | Every server environment variable, with comments. |
| [../qa/README.md](../qa/README.md) | Browser specs: how to run them and what each group covers. |
| [../qa/load/README.md](../qa/load/README.md) | The Socket.IO capacity harness for the testing deployment. |
| [../scripts/social/README.md](../scripts/social/README.md) | Regenerating the link-preview card image. |
| [../public/assets/audio/README.md](../public/assets/audio/README.md) | Music credits and licenses. |
| [../public/assets/fonts/README.md](../public/assets/fonts/README.md) | Font credits and licenses. |
| [../public/assets/parlor-patrol/README.md](../public/assets/parlor-patrol/README.md) | Parlor Patrol sprite and sound assets. |
