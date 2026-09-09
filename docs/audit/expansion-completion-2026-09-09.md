# Rulesets, Seasons, Market Expansion, and Board Variants — Completion Audit

## Scope

This audit re-reads the supplied `/goal` implementation plan and checks the
current Poorup worktree rather than relying on the earlier planning notes.

## Requirement evidence

| Requirement | Current evidence | Result |
| --- | --- | --- |
| One modular monolith and one rules engine | `server/rulesetRegistry.js`, `server/boardRegistry.js`, `server/gameLogic.js`, `server/marketExpansion.js`, `server/seasonModule.js`, `server/cosmeticCatalog.js`, `server/telemetryModule.js` | PASS |
| Classic / After Hours / Custom presets and immutable digest | Registry tests, room summaries, `rulesetDigest`, reconnect projections | PASS |
| Quick Table, public directory metadata, host lock, Rules copy | `clientLobbyUi.js`, `clientRoomsUi.js`, `clientSocialSurfaces.js`, room/socket tests | PASS |
| Standard 40 compatibility and Metro 52 contract | `server/boardRegistry.test.js`, Metro browser integration, semantic tile IDs and card mapping | PASS |
| Grand 64 reserved and not exposed | `EXPOSED_BOARD_VARIANTS`, `BoardRegistry.variants()` | PASS |
| Eight-week seasons, eligibility, percentile, capped tracks, claims | `server/seasonModule.js`, season tests, Rankings reward ledger | PASS |
| Full cosmetic collection and noncompetitive token claims | `server/cosmeticCatalog.js`, Collection tab, detail preview/equip flow | PASS |
| Bounded privacy-safe telemetry | `server/telemetryModule.js`, event/market/bot runtime records, telemetry tests | PASS |
| Margin, shorting, collateralized options, forced obligations | `server/marketExpansion.js`, Finance rail, market and bankruptcy tests | PASS |
| AI and NO-AI share legal candidates and sanitized Metro context | `botApi.js`, `botAdvisor.js`, `botStrategicContext.js`, 100-game coverage campaign | PASS |
| Four viewport browser/accessibility matrix | `qa/playwright.config.js`, `qa/poorup.spec.js`: 29 passed, 3 intentional Metro skips outside desktop-1920 | PASS |
| 1920px visual validation | Home, Rankings/Season, Rules, Social, Profile, Collection, favicon captures; desktop Metro/Market integration and responsive checks | PASS |
| CORS, persistent JSON, backups, process and edge-limit deployment seam | `serverConfig.js`, `backupStore.js`, `httpRateLimiter.js`, `persistenceMode.js`, production docs | PASS (deploy configuration required) |
| Quality gates | `npm test`, `npm run coverage`, both lint targets, `npm audit`, syntax check, boot smoke, `npm pack --dry-run` | PASS |

## Verification snapshot

- Full contract/integration suite: PASS, including rooms (75), socket (18),
  bot, event, market, persistence, social, and history suites.
- Coverage run with a bounded 100-game campaign: **90.56% statements,
  77.09% branches, 87.88% functions**.
- Dependency audit: **0 vulnerabilities**.
- Syntax check: **142 JavaScript files**.
- Browser QA: **29 passed, 3 intentional skips** across 1920×1080,
  1366×768, 1024×768, and 390×844.

## Production handoff

Before an unrestricted public launch, set `POORUP_ALLOWED_ORIGINS`, put the
service behind Cloudflare or an equivalent edge/IP limiter, keep
`POORUP_DATA_DIR` on persistent storage, and schedule the documented backup
rotation/restore drill. The server intentionally fails closed for production
without the origin allow-list and refuses horizontal mode without a
transactional persistence URL.

## Recent completion slices

- `8374d68` — live home signals and the single-stage Rankings surface.
- `660bdbc` — seasonal claim status, cosmetic details/categories, market
  obligation context, bot market candidates, Metro tax rendering, AFK-only
  season exclusion, and production-origin validation.
