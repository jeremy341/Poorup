# Poorup UX simplification proposal

14 October 2026. Planning only; no website behavior changes.

> **Status, 20 October 2026: rejected. Do not implement this plan as written.**
>
> The consolidation was built in one pass (property inspector, Deals workspace, lobby grouping, profile, Holdings wallet, game-over
> standings) and then rolled back at the owner's request, surface by surface. The only piece that stayed is the **Back to table** bar on
> the in-game Rankings and Social copies (`public/clientSocialSurfaces.js`, `public/ux-surfaces.css`, commit `935583c`). Everything else
> in the table below is the shipped design again: separate tile inspector and deed manager, the existing trade builder / offer /
> deal-detail / financing windows, the existing lobby settings and appearance step, the Wallet & Items modal, and the current game-over
> overlay.
>
> **Why it was rejected is not recorded.** The owner asked for the removals without saying whether the scope, the look or the changed
> behaviour was the problem. Until that is known, do not re-propose a consolidation of these surfaces. If UX work is wanted again, ask
> first, then keep it to one surface, keep the current visual language, and show before/after captures before any code lands.
>
> The inventory below (26 registered dialog surfaces, which are game-only, what is off by default) is still an accurate description of
> the code and is kept as reference. The proposal table, interaction rules, implementation order and acceptance scenarios are kept as a
> record of what was tried, not as the direction.

| Proposed surface | Outcome |
| --- | --- |
| One property inspector | Rolled back |
| One Deals workspace | Rolled back |
| Clearer lobby (grouping, skipped appearance step) | Rolled back |
| Holdings wallet, credit inside debt rescue | Rolled back |
| Profile hierarchy pass | Rolled back |
| Game-over standings view | Rolled back |
| Rankings / Social with a return to the table | **Kept** (`935583c`) |
| Market/casino/flight workspaces, card catalog in Rules, player/achievement detail, pending-task status | Never built |

The chosen direction is to keep all gameplay depth and simplify its presentation. Preserve the current rules, feature availability, saved preferences, theme language, shared header, and original return arrow. The target is a game that gives each task one clear place and keeps ordinary information available without interrupting play.

## Findings from the current checkout

The shared surface controller registers **26 dialog surfaces**, of which **17 are restricted to game contexts**. Settings menus, the panel menu, and the activity drawer are additional surfaces. This is an inventory of implementations, not a count of interruptions per match or proof that every registered surface is regularly encountered.

The normal purchase choice already uses the inline board HUD. Property inspection and property management have separate windows: the inspector closes before the manager opens, so that particular flow is sequential rather than stacked. The shared controller can retain multiple open surfaces for other flows. Rankings and Social have both full-page and in-game modal presentations.

Casino, market, flights, account upgrades, and global events are already off in the room-settings defaults. The lobby still exposes their configuration alongside the main rules. The proposal preserves every selected and default value, including bank-credit settings; progressive disclosure changes visibility, not the table contract.

Current lobby and representative property, management, trade, wallet, and market surfaces were captured at 1280×800, 768×1024, and 375×812. The dialog examples use the repository's seeded QA fixture. They show layout and context obstruction, not usage analytics or complete gameplay validation. No evidence here establishes which feature players use least.

The clearest visual issue is that a large trade or market dialog covers the board and makes its surrounding context unavailable while the player is making a decision. [NN/G's modal-dialog guidance](https://www.nngroup.com/articles/modal-nonmodal-dialog/) recommends reserving interruption for important tasks and avoiding dialogs that require information obscured behind them. The proposals below apply that principle to Poorup's existing flows.

## Proposed consolidation

| Before | After | Why |
| --- | --- | --- |
| Tile inspector followed by a separate deed manager | One property inspector with information and legal actions together | Inspect, build, sell, mortgage, and configure airport fees without closing and reopening windows |
| Trade builder, incoming-offer window, deal details, and financing builder | One Deals workspace with list, draft, review, and response states | Counter, accept, decline, withdraw, and revisit terms in a consistent place |
| Wallet/account/items modal plus separate credit and funding surfaces | Cash and items in Holdings; credit inside debt rescue; sponsorship inside the purchase task | Put each action beside the reason the player needs it, while preserving balances, upgrades, item actions, and financing rules |
| Market, casino, and flight desks as separate floating task windows | Explicit game workspaces for market/casino; contextual airport flight controls | Keep every mechanic, reveal configured tools when relevant, and avoid treating every tool as a blocking notice |
| Social and Rankings implemented as pages and game overlays | Reuse the existing pages with an explicit return to the table | Reduce duplicate navigation and presentation while retaining room membership and live updates |
| Player and achievement detail overlays | Contextual player details and expandable achievement detail in the relevant page | Ordinary browsing can remain lightweight |
| Mandatory appearance setup after room entry | Reuse the active identity; offer appearance changes within the entry flow | Enter directly when the saved identity is valid; handle nickname or appearance conflicts inline |
| All lobby settings presented together | Main table controls plus collapsed Advanced groups and dependent fields | Keep all configuration reachable while showing loan severity only with credit, and market complexity only with market access |
| Card catalog dialog and routine result dialogs | Catalog in Rules; resolved results in Activity with an optional reveal | Preserve card effects and any required choices without making informational content compete with the turn |
| Game-over overlay | A round-summary view retaining the current end-of-round actions | Give the conclusion a clear destination rather than another floating window |
| Closing a pending decision can open another confirmation | Persistent pending-task status and intentional minimize/return controls | Keep the unresolved decision obvious without repeatedly opening a second window; irreversible choices still get confirmation |

The first three priorities are **one property inspector**, **one Deals workspace**, and **a clearer lobby**. These address frequent interactions before changing less common tools.

## Interaction rules

- Desktop uses the existing right-side work area for one task at a time. A complex composer may expand it when space permits. Do not cram every form into a permanently visible rail or shrink the board until it becomes unreadable.
- Short or narrow screens use one focused workspace view with the existing return affordance, internal scrolling, and visible turn/status context. Avoid stacking several full-screen dialogs.
- Related details open inside the current task. A trade draft remains intact while the player consults a deed or balance.
- Incoming offers and optional notices appear in a queue or badge. Only genuinely required decisions demand immediate attention. Do not move the player's focus on every snapshot update.
- Keep at most one blocking dialog layer. Important confirmations can replace the current dialog content or sit above a nonmodal workspace, preserving the draft on cancellation.
- Keep focused dialogs where justified: authentication in a requested flow, irreversible confirmations, and an auction or special card decision that needs immediate input. Debt rescue may use a dedicated task workspace with all relevant asset actions available.
- Closing or minimizing a view must never imply buying, passing, bidding, accepting, declaring bankruptcy, or clearing a pending server decision.
- Keep disabled-by-rule features out of unrelated navigation. A configured feature that is temporarily unavailable should explain why beside its control.
- Preserve the header, original arrow styling and behavior, fonts, theme colors, and background motion. This proposal changes task structure and visibility, not the visual identity.

## Implementation order and gates

1. **Property inspector.** Map every action from `popup` and `deed-modal` into a single inspector. Prototype desktop and phone behavior before replacing the existing entry points. Include ordinary properties, airports, utilities, board modifiers, and legal-action explanations.
2. **Deals workspace.** Consolidate peer trades, contract composition, incoming offers, and detail/review states. Retain draft state, server validation, availability rules, counters, cancellation ownership, deadlines, and cash/deed reservation behavior. Use related detail within the workspace rather than opening another dialog.
3. **Lobby and entry.** Add progressive disclosure without changing defaults. Streamline valid identity entry and keep all host configuration reachable. Show dependent fields only when their feature is enabled.
4. **Holdings, rescue, advanced tools, and information.** Integrate cash/items, account upgrades, and debt-rescue actions. Keep sponsorship attached to the purchase it funds. Give market and casino a deliberate workspace; keep flight and fee controls attached to airports. Reuse Social/Rankings pages and put optional information in its proper destination. Preserve server restrictions, room/client identity, and a visible return to an ongoing table.
5. **Retire superseded surfaces.** Remove old wrappers, triggers, and controller branches only after the replacement supports their complete behavior and checks pass. Audit the remaining purchase-choice fallback and capture fixtures before declaring them unused. Do not delete account, match, or historical records as UI cleanup.

Each phase gets a populated preview and a focused interaction check before expanding scope. Reuse the existing state and action controllers, with one owner for workspace selection. Server state remains authoritative; no new client calculation of prices, debt, ownership, or availability.

## Acceptance scenarios

| Task | Expected result |
| --- | --- |
| Inspect an owned property and mortgage it | One inspector; no information-window-to-manager-window hop |
| Build or sell with a restriction | Existing legal rules preserved; the reason appears beside the action |
| Draft a trade, inspect a related deed, then counter an offer | Draft retained; the board/reference context remains available; one Deals flow |
| Resolve a payment using assets or available credit | Due amount and options remain clear; hiding the UI cannot resolve or abandon the server obligation |
| Enable a complex market or use casino/flight/account features | Complete current capability retained; irrelevant or disabled controls stay out of routine play |
| Configure a room and join with a saved appearance | All settings remain reachable; valid identity avoids a redundant mandatory step; conflicts remain explainable |
| Visit Social/Rankings during a round and return | Same client, seat, connection, and room state; the game does not silently pause |
| Use Back, Escape, keyboard focus, and 200% reflow | Predictable focus restoration, usable controls, internal scrolling, and no document overflow |

Use Standard and Metro boards, host and guest perspectives, both sides of trades/contracts, reconnects, validation failures, and delayed responses. Compare the number of context switches and unexpected blocking prompts in representative tasks. Success is fewer interruptions with complete functionality, rather than a lower count of hidden HTML dialog definitions.

## Evidence and review limits

- [Current surface registry and controller](C:/Users/jerem/Documents/GITHUB/Poorup/public/clientSurfaces.js)
- [Property inspection-to-management transition](C:/Users/jerem/Documents/GITHUB/Poorup/public/clientPopupUi.js:233)
- [Existing inline purchase path](C:/Users/jerem/Documents/GITHUB/Poorup/public/clientGameModalsUi.js:138)
- [Page/modal social routing](C:/Users/jerem/Documents/GITHUB/Poorup/public/clientSocialSurfaces.js)
- [Lobby configuration](C:/Users/jerem/Documents/GITHUB/Poorup/public/clientLobbyUi.js:512)
- [Room-setting defaults](C:/Users/jerem/Documents/GITHUB/Poorup/server/roomSettings.js)
- [Desktop trade capture](C:/Users/jerem/.codex/visualizations/2026/10/14/01a1390b-77f5-7581-9e27-400eb9252b58/ux-simplification/desktop-trade.png)
- [Portrait tablet market capture](C:/Users/jerem/.codex/visualizations/2026/10/14/01a1390b-77f5-7581-9e27-400eb9252b58/ux-simplification/tablet-market.png)
- [Phone property-manager capture](C:/Users/jerem/.codex/visualizations/2026/10/14/01a1390b-77f5-7581-9e27-400eb9252b58/ux-simplification/phone-property-manager.png)

Craft report: hierarchy, clarity, task composition, interruption cost, and reference context reviewed at a medium craft bar. Passed: a coherent pixel-parlor identity, an existing inline purchase pattern, and shared state/controller foundations. Changed: no website code or gameplay. Left alone: balance, adoption claims, asset redesign, and admin functionality. Verdict: preserve the depth and consolidate the ways players reach and complete tasks.
