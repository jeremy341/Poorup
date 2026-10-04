# Poorup visual capture gallery design

**Status:** Approved by user for implementation
**Date:** 2026-10-03
**Scope:** Screenshot automation and a local visual gallery. This spec authorizes no product UI changes or implementation.

## Current state

Playwright configuration currently includes 1920×1080, 1366×768, 1280×720, generic 1024×768, mobile 390×844, iPad Mini landscape, and iPad Pro 11 landscape projects. Visual captures are distributed across `qa/in-game-ux.spec.js`, `qa/ipad-pro-modals.spec.js`, `qa/release-surfaces.spec.js`, and other QA specs. The in-game UX capture targets the two small desktop projects plus two iPad projects; the 37-image modal gallery targets only iPad Pro 11; release-surface evidence is pinned to 1920×1080. Output folders and capture inventories are not centrally indexed.

## Goal

Provide one repeatable command that captures Poorup's user-visible pages, lobby/game states, unique modal families, and drawers at the supported desktop and iPad landscape viewport profiles. Produce a browsable local gallery and machine-readable manifest so missing captures are visible and the complete set can be shared for review.

## Supported capture policy

### Desktop

The supported desktop floor is **1440×900**. The default capture matrix excludes **1366×768** and **1280×720**. The `1366×786` value mentioned earlier is treated as a typo for the repository's current 1366×768 profile, as confirmed by the user.

Recommended desktop profiles:

- 1440×900
- 1536×900
- 1600×900
- 1920×1080
- 2560×1440
- 3840×2160 4K (16:9)

The 3440×1440 ultrawide profile was retired from the supported matrix on 2026-10-04. Historical captures remain archived; future runs do not treat that profile as supported.

The registry defines guaranteed targets, not every possible desktop-window size. A command-line viewport override supports one-off dimensions without adding them to the supported matrix.

### iPad

Capture landscape iPad layouts across distinct CSS viewport shapes. Exclude phone and portrait-iPad profiles from the gallery. Start with the existing Playwright landscape profiles and add representative Air and large-iPad profiles:

- 944×656
- 1024×768
- 1080×810
- 1180×820 (additional Air-sized profile)
- 1194×834
- 1366×1024 (additional large-iPad profile; tablet profile, independent of the excluded small-desktop targets)

Profiles sharing viewport, device scale, touch, and hover characteristics may share one screenshot target; the manifest records the device aliases represented by that target. Device emulation values remain centralized so they can be adjusted after visual review.

## Capture coverage

The catalog includes the user-facing top-level views: Home, room browser/create/join, waiting lobby/setup, Profile, Rankings, Social, Rules, Admin Analytics, and Game. Page entries include representative populated, empty, and error/loading states where those states materially change the layout. Lobby/account overlays include the room browser, account/sign-in, achievement detail, ranking/social overlays, and confirmation surfaces.

In-game entries include the board at rest and each selectable board variant, the dice-total announcement, the event log drawer, and each unique modal family. Tile inspectors use one property example plus separate airport, electric-company, water-company, tax, card, and corner examples. Other captures cover purchase/auction, card reveal and gallery, trade offer/builder/details, deed management, financing and emergency credit, wallet tabs, Market Desk Overview and Trade-ticket views, Casino Desk, player card, funding request and active gift/equity offers, bankruptcy/retirement, confirmation, global events, and game over. Repeated tiles that use the same renderer share one representative capture.

Each catalog entry has a stable ID, group, fixture/setup function, expected visible surface, viewport policy, and expected output path. A capture is considered missing if its setup fails, its expected surface never opens, or its screenshot cannot be written.

## Runner and output

Add an opt-in Playwright visual-capture config and a data-driven catalog under `qa/visual-capture/`. Reuse the existing Playwright dependency and app modules; do not add a visual-testing service or runtime dependency for the first version.

Recommended commands:

```text
npm run capture:ui
npm run capture:ui -- --group=game
npm run capture:ui -- --viewport=1920x1080 --group=rankings
npm run capture:ui -- --list
```

The default command captures the full supported landscape matrix. Group and viewport filters support smaller runs. `--list` prints the planned matrix and capture count without starting a browser.

Write output under an ignored, dated `qa-artifacts/visual-captures/<run-id>/` directory. Generate:

- `index.html`, grouped by viewport and surface, with thumbnails linking to full-size images;
- `manifest.json`, recording surface ID, viewport, device alias, browser, run time, source revision/dirty state, fixture ID, screenshot path, and pass/fail status;
- an optional ZIP of that run for handoff.

Screenshots use viewport-sized captures for app/game surfaces so fixed HUDs, dialogs, and drawers match the actual screen. Full-page captures are reserved for explicitly document-like content. The gallery is local output; external email or messaging delivery is out of scope.

## Fixture safety and determinism

Use seeded synthetic names, room data, assets, and economic/game values. Prefer client fixture adapters with no-op action handlers for screenshots; do not submit purchases, trades, funding, or other game actions. Where app startup requires a live room, use an isolated disposable test room and clean up its contexts. Do not use personal account data, production credentials, or production rooms.

Keep the screenshot command opt-in and separate from ordinary unit/browser-test runs. Existing nonvisual checks may remain useful outside the supported capture matrix, but the gallery manifest must only label the specified desktop and landscape-iPad profiles as supported targets. Do not commit generated screenshots.

## Quality checks

For each capture, verify that the expected surface is visible, the screenshot exists, the modal/drawer stays within the viewport, and the document does not scroll unexpectedly. Check keyboard focus on dialog entry and representative keyboard navigation. Run representative 200% zoom-equivalent viewport checks for long dialogs and page surfaces. Fail the gallery run when an expected catalog entry is missing or duplicated.

Before accepting the runner, verify the complete manifest count against catalog × viewport coverage, inspect representative screenshots from every layout tier, and confirm that the default output contains no phone, portrait-iPad, 1366×768, or 1280×720 capture targets.

## Proposed implementation units

- `qa/visual-capture/viewports.mjs`: named desktop and iPad landscape profiles plus custom viewport parsing.
- `qa/visual-capture/catalog.mjs`: stable surface/state inventory.
- `qa/visual-capture/fixtures.mjs`: deterministic state setup and teardown.
- `qa/visual-capture/capture.spec.js`: Playwright matrix execution and capture assertions.
- `qa/visual-capture/gallery.mjs`: manifest and HTML gallery generation.
- `qa/visual-capture/playwright.config.js`: capture-only projects, isolated from standard test projects.
- `package.json`: opt-in `capture:ui` command.

## Non-goals

- Redesigning UI or changing responsive behavior in this work.
- Capturing phones or portrait iPads.
- Treating 1366×768 or 1280×720 as supported desktop layouts.
- Pixel-diff baselines, hosted visual review, or automatic external delivery.
- Capturing every game data combination or every individual property deed where the same renderer is reused.

## Approved review decisions

1. Use the proposed desktop profile list with a 1440×900 floor.
2. Include 1180×820 and 1366×1024 as additional iPad landscape profiles.
3. Include Admin Analytics with the public and game surfaces.
