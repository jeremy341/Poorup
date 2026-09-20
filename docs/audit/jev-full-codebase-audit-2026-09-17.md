# Poorup Full Codebase Release Audit — Jev — 2026-09-17

**Mode:** TypeSafe/Jev advisory audit, no repository write access  
**Model:** `jev-1.13.0` (all successful requests)  
**Scope:** complete file inventory plus redacted deep reads of high-risk source/document clusters.  
**Key handling:** the API key was process-only, never written to disk or output. It is compromised by chat exposure and must be revoked.

## TypeSafe method

TypeSafe was installed from the official `typesafe-ai/skills` repository. Jev was
called through `POST https://api.typesafe.ai/v1/systemone` using the documented
`state`, `model`, and `questions` shape. The audit uses independent `Choice`,
`Noul`, and `Score` questions over the same state; probabilities and confidence are
preserved for review. See the [TypeSafe agent-skill guide](https://docs.typesafe.ai/agent-skill),
[State](https://docs.typesafe.ai/concepts/state), [Choice](https://docs.typesafe.ai/primitives/choice),
[Noul](https://docs.typesafe.ai/primitives/noul), [Score](https://docs.typesafe.ai/primitives/score),
and [Confidence](https://docs.typesafe.ai/confidence) references.

Jev never received raw secrets, API credentials, session tokens, PII, chat, private
deals or account identifiers. Binary assets were represented by path, size, hash and
reference metadata; TypeSafe state currently accepts text/JSON, not audio/video/image.

## Coverage

| Input | Coverage |
|---|---:|
| Complete repository inventory | 640 files (583 text, 57 binary/other) |
| Markdown/README inventory | 137 files |
| SVG metadata graph | 106 files |
| QA files | 15 files |
| Deep server source files | 16 files |
| Deep client source files | 9 files |
| Deep MD/source documents | 10 files |
| Historical/current triage cases | 12 + 5 verification cases |

The 640-file inventory was first evaluated by subsystem (Server 161, Public 218,
QA 16, Docs 146, Root 99). The first request accidentally omitted the scope field
and was discarded; the corrected request covered all five scopes.

## Historical and current case results

| Case | Jev classification | Next action | Release-blocking probability |
|---|---|---|---:|
| Cross-room seat | `historical_fixed` | `add_regression` | 0.11 |
| Degraded render | `historical_fixed` | `add_regression` | 0.11 |
| Account rights | `planned` (low confidence) | `doc_update` | 0.24 |
| Seat-0 bias | `needs_telemetry` | `instrument` | 0.30 |
| Feature opportunity gap | first pass `intentional`, verification `needs_telemetry` | `instrument` | 0.16 first pass |
| Auction deadline | `historical_fixed` | `add_regression` | 0.23 |
| No ToS | `intentional` | `doc_update` | 0.22 |
| Theme chooser | `intentional` | `add_regression` | 0.14 |
| Wallet/Items | `planned` | `defer` | 0.11 |
| Performance budget | first pass `current_bug`, verification `owner_review` | `fix_now` → `owner_review` | 0.58 first pass |
| Bot contract loop | `historical_fixed` | `add_regression` | 0.17 |
| Music-box plan | `docs_stale` | `doc_update` | 0.05 |

The feature-opportunity case is a deliberate model disagreement: the first broad
Choice answer was wrong, while a narrower Noul question returned
`needsTelemetry = 0.93`. This demonstrates why Jev output cannot close a release gate
without deterministic reconciliation and human review.

## Server deep-read signals

`current_bug` is the Jev Noul probability that a current defect exists; `severity` is
the Score value on a 0–4 release-risk scale.

| File | Dominant hotspot | Current-bug probability | Severity |
|---|---|---:|---:|
| `server/gameLogic.js` | integrity | 0.44 | 2.14 |
| `server/rooms.js` | integrity | 0.47 | 2.39 |
| `server/socketRuntime.js` | lifecycle | 0.39 | 2.16 |
| `server/accountStore.js` | security | 0.56 | 2.79 |
| `server/contractLogic.js` | integrity | 0.43 | 2.28 |
| `server/tradeApi.js` | integrity | 0.41 | 2.40 |
| `server/economyApi.js` | integrity | 0.43 | 2.33 |
| `server/marketExpansion.js` | integrity | 0.52 | 2.51 |
| `server/bankruptcyApi.js` | integrity | 0.40 | 2.27 |
| `server/seasonModule.js` | integrity | 0.59 | 2.52 |
| `server/telemetryModule.js` | security | 0.47 | 2.14 |
| `server/backupStore.js` | persistence | 0.64 | 2.65 |
| `server/botLogic.js` | integrity | 0.26 | 1.77 |
| `server/botAdvisor.js` | security | 0.38 | 1.90 |
| `server/socialStore.js` | security | 0.67 | 2.69 |
| `server/server.js` | security | 0.40 | 2.43 |

These are review priorities, not confirmed bugs. Jev's confidence was low or
moderate for many severity values, so current tests and source evidence remain the
authority.

## Client deep-read signals

| File | Dominant hotspot | Current-bug probability | Severity |
|---|---|---:|---:|
| `public/main.js` | state | 0.43 | 2.14 |
| `public/clientStateSync.js` | state | 0.42 | 2.14 |
| `public/clientGameModalsUi.js` | modal | 0.62 | 2.56 |
| `public/clientSurfaces.js` | modal | 0.44 | 2.15 |
| `public/clientTheme.js` | a11y | 0.53 | 1.82 |
| `public/clientThemeRender.js` | visual | 0.42 | 1.53 |
| `public/clientAuctionUi.js` | state | 0.48 | 2.03 |
| `public/clientPopupUi.js` | gameplay | 0.46 | 1.99 |
| `public/clientBoardRender.js` | visual | 0.36 | 1.74 |

Jev therefore agrees with the local priority order: state synchronization and modal
semantics first, then theme/a11y and visual review. It does not prove a new defect in
these files.

## Documentation signals

| Document group | Jev signal | Local reconciliation |
|---|---|---|
| Current release-hardening audit | `active`, stale probability 0.74 | Keep active; its execution update is authoritative. |
| Markdown-release audit | `superseded` | Jev is wrong on status; it is the current reconciliation document and should remain active. |
| Account-rights plan | `planned` | Correct. |
| Devlog 7 | `reference` | Correct historical provenance. |
| RR-18/RR-25/RR-33/RR-40 | `reference` | Correct; findings require current-source cross-check. |
| Production hardening | `active` | Correct; deployment gates remain open. |
| Poorup design authority | `active` | Correct. |

The Markdown-release audit disagreement is important: Jev saw the document's dated
historical language and underweighted its explicit current-tree correction. The local
source-of-truth rule wins.

## SVG and QA signals

- SVG inventory: 106 assets; corrected graph found 37 direct normalized runtime
  references, 71 dynamic theme/runtime references and 19 no-current-reference
  candidates. Jev returned `runtime` with 0.76 confidence and deletion probability
  0.23. This supports review, not deletion.
- QA inventory: 15 files; Jev returned coverage Score `4.0` with confidence `1.0`.
  The local Playwright evidence confirms broad viewport/state coverage, while planned
  skips remain explicit.

## Jev-only conclusions

1. **Balance:** seat-0 bias and feature-opportunity gaps require instrumentation, not
   immediate rule changes.
2. **Code:** server integrity/persistence and client state/modal surfaces deserve the
   first human review.
3. **Docs:** most historical reports are reference/superseded; current source and
   tests must override stale line-level language.
4. **Assets:** no SVG was safe to delete from metadata alone.
5. **Performance:** whether the measured budget blocks release is an owner decision,
   not an automatic Jev fix.

## Limitations and gate policy

- Jev is advisory and probabilistic; it cannot establish truth from a typed response.
- The inventory pass used file metadata; deep reads were limited to high-risk source
  and document clusters so API context remained bounded.
- Binary audio/raster assets were not sent to Jev; local hashes/reference scans cover
  them.
- Jev did not run code, tests, browser sessions, or balance simulations.
- Jev must never override a failed deterministic gate, change game rules, delete an
  asset, or mark an unverified legal/privacy claim complete.

## Jev verdict

Jev agrees with the major local conclusion: the core game hardening is substantially
covered, but account rights, CodeScene, performance policy, representative balance
experiments and review findings remain open. The strongest actionable Jev output is
`INSTRUMENT` for balance questions and `OWNER_REVIEW` for policy/performance gates;
numeric tuning and destructive cleanup remain blocked until evidence and approval exist.
