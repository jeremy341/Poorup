# Poorup Release-Hardening-, Balance- und UX-Audit

**Datum:** 2026-09-16  
**Arbeitsbaum:** `admin-analytics-dashboard-plan` (`cc51da2`, uncommitted changes present)  
**Scope:** Dokumentationsparität, Server-/Game-Logik, Insolvenz- und Spectator-Lifecycle,
Modal-UX, Rules-Seite, Balance-Evidenz, Screenshots und Asset-Hygiene.  
**Status:** Planungs- und Befunddokument. In diesem Durchlauf wurden keine Source-Dateien
geändert und keine Dateien gelöscht.

## 1. Executive verdict

Poorup ist für eine kontrollierte Beta mit Freunden technisch näher an einem Release als
die historischen Auditberichte vermuten lassen. Die aktuellen Tests decken viele frühere
Probleme bereits ab. Eine öffentliche, account-basierte Veröffentlichung ist aber noch
nicht freigabefähig, solange die offenen Server-Lifecycle-Bugs, die Insolvenzdarstellung,
die Dokumentationsmismatches, die Lizenz-/Asset-Fragen und die Release-Evidenz nicht
geschlossen sind.

Der wichtigste Produktvertrag für die nächste Phase lautet:

1. Negative Cash-Beträge dürfen nur als Teil einer offenen Forderung existieren.
2. Während eine Forderung offen ist, darf der Spieler nur rechtmäßige
   Liquiditätsaktionen ausführen; `END TURN` bleibt blockiert.
3. Nach vollständiger Zahlung ist `cash >= 0` ausreichend. Genau `$0` ist ein gültiger
   Turn-Endzustand.
4. Gibt ein Spieler auf, wird eine offene Schuld zuerst nach der bestehenden
   Gläubigerregel abgewickelt. Grundstücke gehen bei einem solventen Gläubiger an diesen;
   Bank-/freiwillige Auflösung gibt sie neutral an die Bank zurück.
5. Eine menschliche Eliminierung wechselt automatisch in einen read-only Spectator-
   Zustand. Der Token verschwindet vom Board. In der Sidebar bleibt der Spieler mit
   ausgegrautem Icon, Username und grauem `SPECTATING` sichtbar, bis `LEAVE TABLE` gewählt
   wird. Danach wird nur die Live-Zeile entfernt; History und Endscreen behalten den
   Teilnehmer.
6. Bots dürfen bankrottgehen, erhalten aber keinen interaktiven Spectator-Modus.

## 2. Evidence boundary

Die zwei gelieferten Audittexte wurden gegen den aktuellen Arbeitsbaum gespiegelt. Die
Datei `docs/audit/markdown-release-audit-2026-09-16.md` selbst ist eine wichtige
Vorarbeit, aber teilweise nicht mehr synchron zum dirty tree: Sie beschreibt vorhandene
Legal-Routen, während `git status` aktuell acht `public/legal/*.html`-Dateien und die
zugehörigen Server-/Tests als gelöscht markiert. Das ist vor einer Releaseaussage zu
klären und darf nicht als bereits gepatchter Zustand gelesen werden.

Der Arbeitsbaum enthält derzeit 147 getrackte Markdown-/README-Dateien (122 vorhandene
Dateien im Checkout) und 104 SVGs. Die Differenz entsteht unter anderem durch uncommitted
Löschungen. Historische Zeilennummern aus älteren Audits sind Belege für damalige
Reproduktionen; für die Umsetzung zählt immer ein frischer Source- und Testlauf auf dem
finalen SHA.

## 3. Documentation parity audit

### 3.1 Kategorien

Jede README-/Markdown-Datei erhält bei der vollständigen Ausführung genau eine Kategorie:

| Kategorie | Bedeutung | Aktion |
|---|---|---|
| Aktiv | Beschreibt den aktuellen Code, Betrieb oder einen verbindlichen Vertrag | behalten, bei Bedarf aktualisieren |
| Erledigt | Historischer Plan/Fix mit nachweisbarem Abschluss | behalten, Statusbanner und Evidenzlink ergänzen |
| Veraltet | Behauptung widerspricht dem aktuellen Code | korrigieren oder als superseded markieren |
| Referenz | Provenienz, Lizenz, Designquelle oder historische Untersuchung | behalten; nicht als Bugliste ausführen |
| Löschkandidat | Eindeutig unreferenziert und ohne Provenienz-/Rollbackwert | erst nach Liste, Scan und Freigabe löschen |

### 3.2 Bereits erkennbare Mismatches

| Priorität | Dokument-/Code-Mismatch | Befund | Geplante Behandlung |
|---|---|---|---|
| P1 | `docs/audit/markdown-release-audit-2026-09-16.md` vs. `git status` | Audit beschreibt Legal-Surfaces als vorhanden; im dirty tree sind sie gelöscht | Audit mit Arbeitsbaum-SHA und tatsächlichem Runtime-Zustand neu kennzeichnen |
| P1 | Rules-Seite vs. Feature-Pläne | `public/clientSocialSurfaces.js` markiert Wallet/Items, Airport-Reisen, Predictions und Bank-Tiers teilweise als live; mehrere Pläne markieren sie als geplant | Source-of-truth-Matrix erstellen; nicht implementierte Mutation als `PLANNED` kennzeichnen |
| P1 | Insolvenztext | Rules erklären Elimination/`Debt Deal`, aber nicht den neuen einheitlichen offenen-Schuldzustand und Spectator-Lifecycle | Rules-Kapitel und UI-Copy nach Implementierung aktualisieren |
| P2 | alte Auditberichte | `AUDIT-2026-09-08`, `AUDIT-DEEP`, `AUDIT-FULL` enthalten behobene Bugs weiter als offene Findings | Statusbanner `HISTORICAL / SUPERSEDED` ergänzen; keine Findings ungeprüft wiederöffnen |
| P2 | Music-/Legal-/Theme-Pläne | Mehrere Dokumente beschreiben verworfene Music-Box- oder Legal-Varianten | als Referenz/abgebrochen markieren, nicht als Runtime-Vertrag verwenden |
| P2 | Feature-Manifest | `docs/feature-status.json` ist auf einen älteren Evidence-Commit gepinnt | erst nach finalem Fix-SHA aktualisieren und den Parity-Test anpassen |
| P3 | Devlog/Produkttexte | `docs/DEVLOG-7.md` enthält „next step“-Aussagen zu bereits geänderten Systemen | historisch belassen, aber mit Datum und `implemented since`-Hinweis ergänzen |

### 3.3 Ausführungsregeln für die vollständige Inventur

1. `git ls-files` und Checkout-Dateien getrennt inventarisieren; deleted/untracked
   Dateien nicht vermischen.
2. Jede Datei gegen die erwähnten Module, Socket-Events, URLs, Settings, Tests und
   Screenshots prüfen.
3. Eingebaute oder verlinkte Feature-Status-Marker priorisieren; Plan-Checkboxen allein
   sind kein Beweis für Implementierung.
4. Alle widersprüchlichen Aussagen in einer Parity-Tabelle mit Code-/Testbeleg erfassen.
5. Zuerst eine begründete Löschliste mit Referenzscan, Testauswirkung und Recovery-Pfad
   ausgeben. Bis zur Freigabe nur archivieren oder markieren.

## 4. Current source-backed bugs

### P1 — cross-room started-seat can strand a table

`server/socketRuntime.js` (`detachStartedSeat`, etwa Zeilen 360–385) markiert beim
Wechsel in einen anderen Raum den alten Sitz als disconnected, startet aber nicht in allen
Pfaden die reguläre Ablauf-/Expiry-Behandlung. Ein offener Turn oder eine Forderung kann
damit im alten Raum hängen bleiben, obwohl der Client bereits im neuen Raum ist.

**Fix contract:** eine einzige idempotente `detach -> grace -> expire/settle`-Pipeline,
inklusive Timer, Obstacle-Cleanup, Reconnect-Fenster, Turn-Weitergabe und Test für
Cross-Room-Wechsel während Roll, Payment, Auction und Global-Event.

### P1 — degraded snapshot can abort rendering

`public/clientTopNavRender.js` und `public/clientHudRender.js` greifen auf den aktuellen
Spieler zu, ohne einen leeren/partiellen Snapshot vollständig abzusichern. Die lineare
`renderAll()`-Pipeline in `public/main.js` kann dadurch HUD, Winner-, Debt-, Auction- und
Accessibility-Synchronisation abbrechen.

**Fix contract:** sichere View-Projektion mit `currentPlayer || placeholder`, isolierte
Panel-Renderer, sichtbarer `UNAVAILABLE`-Status und ein Browser-/Unit-Test für leer,
teilweise und verspätet eintreffende Snapshots.

### P1/P2 — match idempotency expires with bounded history

`server/accountStore.js` dedupliziert ältere Match-IDs nur innerhalb des begrenzten
Match-History-Fensters. Nach mehr als 50 Einträgen kann ein Replay eines alten Matches
`gamesPlayed` und Rankings erneut erhöhen. Das analoge Season-Fenster in
`server/seasonModule.js` ist auf 1.000 IDs begrenzt.

**Fix contract:** ein dauerhaftes, größenbegrenztes Dedupe-Ledger oder ein Store-seitiger
Unique-Key pro `accountId + matchId`; Match-History-Limits bleiben reine Anzeige-/Payload-
Limits. Replays werden für Account, Season, Telemetry und Rewards gleichermaßen ignoriert.

### P2 — season mastery and fair-trade evidence

`server/seasonModule.js` berechnet Mastery aus kumulierten Feldern, wodurch wiederholte
Matches stärker wachsen als der tatsächlich neue Match-Beitrag. Gleichzeitig wird
`fairTrades` im Participant-Schema nicht zuverlässig geschrieben, sodass legitime Trades
als null in Season-Punkten erscheinen.

**Fix contract:** pro abgeschlossenem Match einen normalisierten Delta-Beitrag ableiten,
Schema und Migration für `fairTrades` definieren, Replay-/Bot-only-/AFK-Ausschlüsse
beibehalten und Grenzwerte mit Property-/Season-Tests sichern.

### P2 — open-debt turn contract is not explicit enough

Die aktuelle UI zeigt den Insolvenzpfad, aber die Zustände „negativ“, „Rettungsaktion
läuft“, „Forderung erfüllt“ und „Insolvenz gewählt“ sind nicht als einheitlicher Client-
und Serververtrag modelliert. `END TURN` darf nicht durch einen Snapshot oder eine
veraltete lokale Flagge wieder freigegeben werden.

**Fix contract:** `pendingPayment` ist die einzige Quelle für den Blocker; serverseitig
werden nur Rettungsaktionen mit aktueller Autorisierung akzeptiert. `END TURN` wird erst
bei `amountRemaining === 0` und `cash >= 0` zugelassen. `$0` ist gültig.

### P2 — action locks can be cleared by a snapshot

`public/clientStateSync.js` setzt Busy-/Rolling-Flags auf eingehenden Snapshots zurück,
obwohl der zugehörige Request noch keine Bestätigung erhalten hat. Ein schneller Snapshot
kann dadurch doppelte Rolls oder doppelte Mutationen ermöglichen.

**Fix contract:** Request-ID, serverseitige Ack-ID, Timeout und stale-response handling;
ein Snapshot darf einen lokalen Lock nur für denselben oder einen explizit abgeschlossenen
Request lösen.

### P2 — bankruptcy/spectator presentation is incomplete

Der Server setzt `bankrupt`, liquidiert/überträgt Assets und entfernt die Person aus der
aktiven Turn-Logik. Die Client-Projektion kennt jedoch keinen expliziten `spectator`-
Status; Board-Token und Sidebar-Zeile werden deshalb nicht nach dem gewünschten Vertrag
behandelt.

**Fix contract:** server-authoritative lifecycle fields (`bankrupt`, `spectating`,
`leftAt`/presence) oder eine äquivalente Projektion; kein Client-only „versteckt“-Hack.
Board-Renderer blendet bankrotte menschliche Tokens aus, Sidebar markiert sie grau,
`LEAVE TABLE` entfernt nur die Live-Presence.

### P2 — close/pending semantics are inconsistent

Einige Modals schließen neutral, andere besitzen verpflichtende Entscheidungen. Scrim,
Escape, Close-Button und Browser-Tab-Schließen müssen denselben risk-aware Vertrag
verwenden. Eine Warnung bei jedem Info-Modal wäre unnötig und verschlechtert die UX.

**Fix contract:** bestätigungspflichtig sind nur Insolvenz, verpflichtender Kauf,
Auction, Global-Event-Vote und ungesendete Deals. Deed-/Field-Details, Rules, Log,
Airport-Info und bereits abgeschlossene Aktionen schließen direkt. `beforeunload` bleibt
auf eine aktive, unaufgelöste Entscheidung beschränkt und nutzt den nativen Browserdialog.

### P2 — field modals do not share the deed-modal shell

Das eigene Deed-Modal ist die stärkste bestehende Referenz. Feld-/Popup-Modals nutzen
noch mehrere ältere Markup-/Spacing-Varianten.

**Fix contract:** gemeinsame Hülle (Farbstreifen, Icon, Kicker, Titel, Statuszeilen,
Footer) mit feldabhängigem Inhalt und server-projizierten erlaubten Aktionen. Nicht
zulässige Aktionen werden nicht als scheinbar klickbare disabled Buttons gerendert.

### P2 — accessibility and async feedback gaps

Die Audits fanden fehlende Chat-/Toast-Live-Regionen, ein nicht sauber containment-
fähiges Theme-Popover, mögliche Focus-Verluste bei Auction/Global Events und stille
Economy-Refresh-Fehler.

**Fix contract:** semantische Live-Regionen, Focus restoration, pending/error/timeout
states, keyboard traversal, reduced-motion/forced-colors coverage und keine
`aria-hidden`-Interaktionsknoten.

### P2/P3 — validation, recovery and adapter details

- Bekannte String-Settings dürfen keine beliebigen Werte in Snapshots übernehmen.
- Account-Recovery soll bei mehreren disconnected seats eine deterministische Recency-
  oder Room-Hint-Regel verwenden.
- `matchHistoryAdapter` muss sein Limit nach dem Mergen von Legacy- und Stored-Records
  anwenden.
- Doppelte Event-/Motion-Tokens müssen auf eine Quelle reduziert oder ausdrücklich als
  Projektion dokumentiert werden.

## 5. Balance audit (measure before tuning)

Numerische Balancewerte werden nicht automatisch geändert. Automatisch repariert werden
nur nachweisbare Regelverletzungen, Invarianten und doppelte Settlements. Die Balance-
Kampagne muss mindestens folgende Dimensionen getrennt ausweisen:

| Dimension | Metriken | Slices |
|---|---|---|
| Seat fairness | Win share, median placement, first-bankruptcy rate | seat 1–6, human/bot |
| Duration | Median/P90 rounds and minutes, stalled rate | Classic/After Hours/Custom, board variant |
| Solvency | bankruptcy timing, negative-cash duration, rescue success | bank/player debt, creditor present/absent |
| Property economy | monopoly rate, rent share, mortgage/build frequency | group, tile index, house limit |
| Auctions | participation, under-list wins, final price/asking ratio | player count, bot brain |
| Airport/utility | ownership, travel/use, rent contribution, win association | enabled/disabled, distance buckets |
| Market/casino | adoption, net P&L, forced liquidation, loss concentration | complexity, event state, bot/human |
| Global events | eligibility, warning-to-active, recovery, bankruptcy association | event ID, round band, severity |
| Bot quality | action legality, fallback rate, rescue choices, bankruptcies | AI/no-AI, personality, difficulty |
| Comebacks | deficit at halfway, eventual placement, recovery action | event/debt/auction context |

Campaign requirements:

1. Fixed seeds plus independent seeds; never mix deterministic fixtures with production
   telemetry.
2. Minimum sample-size suppression in the admin dashboard; no causal claims from a raw
   correlation.
3. Confidence intervals or bootstrap ranges for win shares and rates.
4. Report both bot-only and competitive human-involved matches.
5. Record rule revision, board variant, balance revision, and seed with every result.
6. Test at least 10,000 short deterministic games and a smaller long-run campaign before
   making a numeric tuning recommendation; the exact runtime budget is an execution
   decision, not a reason to invent results.

### Current balance hypotheses to verify

- Starting seat/order advantage.
- Airport ownership and any travel action association with wins.
- Event severity causing multi-player bankruptcy.
- Casino/market access creating runaway cash or merely adding variance.
- Bot personality/difficulty producing unintended dominance.
- House/hotel limits and mortgage recovery creating dead turns.
- Player-loan or equity defaults transferring too much value.

These are hypotheses, not conclusions. The analytics page must label them as association,
not causation.

## 6. Bankruptcy and end-game contract

### State machine

```text
SOLVENT → PAYMENT_OPEN → (RESCUE_ACTION)* → PAYMENT_SETTLED → TURN_CAN_END
                                 └────────→ BANKRUPT → SPECTATING → LEAVE_TABLE
```

- `PAYMENT_OPEN` may show a negative temporary balance, but the server keeps the unpaid
  amount and creditor authoritative.
- Rescue actions are validated against current holdings, cash, contracts, and request
  version.
- A creditor receives transferred assets only when solvent and the debt is owed to that
  creditor. Bank/freely surrendered assets become neutral.
- Houses, mortgages, equity shares, market positions, loans, sponsorships, and queued
  payments are settled once in a documented order.
- Bankrupt human tokens are not selectable, do not occupy turn order, and are visually
  absent from the board.
- Sidebar preserves the row while spectating, with grey icon and `SPECTATING`; a real
  leave removes presence and host/lobby capacity is recalculated.
- Endgame ranks all participants deterministically, including bankrupt players, and
  displays the winner only from eligible solvent connected seats.
- Rematch clears spectator/bankruptcy/presence state without mutating stored history.

### Required tests

- human debt settled at positive cash;
- human debt settled at exactly `$0`;
- no legal rescue → bankruptcy;
- creditor transfer and bank-neutral release;
- asset neutralization/ownership/equity/mortgage invariants;
- bot bankruptcy in deterministic and AI-fallback modes;
- bankrupt token/turn/sidebar projections;
- spectator leave and reconnect;
- endgame ranking and rematch reset;
- stale bankruptcy modal/request and duplicate request;
- disconnected or cross-room seat during an open payment.

## 7. Visual and interaction audit plan

The screenshot bundle is evidence, not decoration. It must be generated from deterministic
fixtures and inspected at native resolution.

### Required 1920×1080 surfaces

- Home and theme baseline;
- Room browse/create/join and lobby;
- normal game HUD;
- own deed modal;
- unowned property field modal;
- opponent deed modal;
- airport/plane modal;
- Chance/Treasure, Tax, Utility, Vacation and purchase flows;
- auction, trade, player-loan, bank-loan and sponsorship modals;
- Global Event warning, vote, active and recovery states;
- bankruptcy decision, bankrupt spectator, bot bankruptcy and end-game screens;
- Rules page after synchronization;
- Social, Rankings, Wallet/Items and admin provider/analytics surfaces where live.

Secondary evidence: iPad landscape and 390×844 for critical decision surfaces. Also run
keyboard focus, 200% zoom, reduced motion, forced colors and no-overflow checks.

### Visual acceptance

- Deed and field modals share the same shell and spacing system.
- No background art, token, fog, or animation crosses a text/control/focus layer.
- Required actions are immediately discoverable; forbidden actions are absent.
- Spectator status is readable without color alone.
- Closing a risky surface always explains the consequence before dismissal.
- No page scroll is introduced by a modal or screenshot fixture.

## 8. Asset and documentation cleanup

Before deleting an SVG or Markdown file, build a graph from HTML/JS/CSS imports, CSS
URLs, Playwright fixtures, tests, docs links, build scripts and deployment manifests.
Classify each candidate as `RUNTIME`, `TEST_FIXTURE`, `DESIGN_SOURCE`, `PROVENANCE_REQUIRED`,
or `DEAD`. Keep licenses, original sources, and historical audit evidence even when an
asset is no longer rendered. Move uncertain files to an explicitly named archive only
after checking links and tests.

The first deletion list must include:

- exact path;
- why it is not runtime-referenced;
- license/provenance assessment;
- test and deployment impact;
- recoverability (Git history or archive path);
- approval status.

No deletion is part of this planning pass.

## 9. Release gates

### Must pass before controlled beta

- full unit and audit suites on the final SHA;
- server and client lint, `git diff --check`, dependency audit;
- cross-room detach and degraded-snapshot regression;
- open-payment/negative-cash/bankruptcy/spectator/endgame/rematch tests;
- two-client reconnect and stale-request tests;
- deterministic 1920px screenshots inspected at native resolution;
- Rules and feature-status parity check;
- asset reference scan and attribution check;
- production environment, backup/restore and maintenance-drain smoke test.

### Additional gates before public account release

- approved effective legal copy and operator/contact facts;
- account deletion/export/session-revocation policy and implementation;
- password recovery/session lifetime policy;
- approved canonical origin and preview artwork;
- license notice/root third-party attribution;
- persistence adapter, rate-limit, proxy and load evidence for the intended player
  population;
- CodeScene and PR checks on the exact merge SHA.

## 10. Planned skill usage

| Workstream | Guidance |
|---|---|
| Discovery and decisions | `superpowers:brainstorming`, local `grill-me` protocol, `find-skills` |
| Debugging and correctness | `superpowers:systematic-debugging`, `tdd`, `qa-agent-testing`, `agentic-eval` |
| Architecture and release | `software-architecture-design`, `code-architecture-review`, `thermo-nuclear-code-quality-review`, `security-best-practices` |
| UI and UX | `frontend-design`, `frontend-design-review`, `frontend-design-ui-ux`, `design-taste-frontend`, `critique`, `impeccable`, `web-design-guidelines`, `game-ui-ux`, `mobile-responsiveness`, `accessibility` |
| Motion and assets | `animate`, `design-motion-principles`, `emilkowal-animations`, `improve-animations`, `review-animations`, `svg-design`, `pixel-art-sprites`, `Pixel Art Animator` |
| Analytics and balance | `kpi-dashboard-design`, `chart-visualization`, `llm-evaluation` where AI-bot quality is evaluated |

The local `grill-me` file is a wrapper for a `grilling` Skill-tool call that is not
exposed in this runtime. The one-question-at-a-time interview above is the equivalent
manual protocol.

## 11. Decision log from this interview

- Creditor transfer remains the default for a debt owed to a solvent player.
- Bank/friendly surrender releases assets to the bank.
- Negative cash is allowed only while an open payment is being resolved.
- `END TURN` requires no remaining payment and `cash >= 0`; exactly `$0` is valid.
- Risk-aware confirmation applies only to destructive/required decisions.
- Human bankruptcy enters read-only Spectator automatically.
- Sidebar spectator row is greyed and labelled `SPECTATING`.
- Field modals reuse the Deed-modal shell with context-specific actions.
- Uncertain docs/assets are archived or listed, not silently deleted.
- Numeric balance tuning waits for measured evidence and owner approval.

## 12. Audit conclusion

The project should proceed as a release-hardening program, not a broad redesign. The
highest-risk work is server lifecycle/idempotency and the explicit bankruptcy/spectator
contract. UI work should stay additive and use the existing Poorup shell. Balance work
should produce trustworthy evidence before any tuning. Documentation and asset cleanup
must follow the source graph, not the age of a file.

No application code was changed during the initial audit pass; the execution update below records the subsequent implementation slice.

## 13. Execution update — 2026-09-17

The first implementation slice is now present on the working branch:

- cross-room started-seat detach uses the disconnect expiry pipeline;
- account and season settlement dedupe no longer share the visible history windows;
- season mastery consumes per-match deltas and completed trades expose a participant count;
- legacy `bankruptMode=debt` is compatibility-normalized to elimination;
- human bankruptcies project `spectating`, hide board tokens, and render a read-only rail;
- snapshot action locks, global-event votes, auction actions, and economy refreshes expose
  pending/stale state;
- Rules copy and field popups reuse the Deed-modal language;
- deterministic 1920px screenshot fixtures cover Home, Rules, Airport, Global Event,
  Spectator, and End Game.

The full release gate remains open: complete test/lint/browser results, balance-campaign
evidence, asset/deletion review, and final CodeScene/PR checks still require a final
candidate SHA.

### Verification closeout — 2026-09-17

- `npm run test:full --silent` — passed (server, client, audit, and documentation suites).
- `npm run lint -- --quiet` and `npm run lint:client -- --quiet` — passed.
- `npx playwright test -c qa/playwright.config.js` — 391 passed, 47 planned skips, 0 failed
  across desktop, tablet, iPad landscape, and mobile projects.
- `node server/bot-simulation.test.js` with 10,000 fixed-seed games — 9,862 completed within
  2,000 steps, 138 reached the bound, and 0 invariant stalls. The aggregate report is a
  stability signal, not a tuning verdict: winner shares are heavily seat-0 weighted
  (0.9676), actual Global Event adoption was 0.6298, and 9,996 games recorded at least one
  bankruptcy. The earlier 2,500-game stability run also had 0 invariant stalls and 2,471
  completions; it used the same simulation bound. Numeric rule changes remain intentionally
  unapproved until a representative campaign and owner review exist.
- Each simulation record now carries a fixed seed, balance revision, ruleset revision,
  board variant, bot brain/difficulty, and bot-personality list; the reducer reports
  `completed`, `boundedGames`, and actual-action feature-adoption rates without retaining
  player or account identifiers.
- Impeccable mechanical detector — run once on the changed UI slice; 126 primary-pattern
  findings and 6 advisory notes were reported. These are review input, not evidence that
  all findings are defects; no blanket suppressions were added.
- CodeScene hosted delta — not executed successfully because `CS_ACCESS_TOKEN` is absent
  from the current process and PowerShell history. The local CLI is installed, so the
  hosted CodeScene/PR gate remains open until a token is supplied in the execution
  environment.

The release evidence is therefore complete for automated tests and visual fixtures, but
the branch is not declared release-ready until the CodeScene review, the bounded balance
runs (138 in the 10,000-game sample), and the explicit asset/deletion decision are closed.

### Fresh verification — 2026-09-17

The required long runner was repeated after the implementation slice with
`POORUP_BOT_BALANCE_COUNT=10000`. It produced 10,000 bounded simulations,
9,812 completions within 2,000 steps, 188 bounded games, and 0 invariant
stalls. Median duration was 27 rounds / 560 steps and P95 was 98 rounds /
1,328 steps. The current result is recorded in
`docs/audit/balance-campaign-2026-09-17.md`; it supersedes the earlier sample
numbers in this historical report but keeps the same measurement-only policy.

The manual CodeScene wrapper is now available at
`scripts/codescene-delta.ps1`. It was exercised without a token and failed
closed before invoking CodeScene. The hosted CodeScene gate remains open until
the owner supplies a token in the review environment.
