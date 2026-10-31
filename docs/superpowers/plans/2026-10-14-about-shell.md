# About Shell Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline. Steps use checkbox syntax for tracking.

**Goal:** Make About a themed, public information view inside Poorup's existing shell.

**Architecture:** Share static content through a browser/server-safe renderer. Add a view to the existing app controller and render it into the index shell for `/about`. Reuse existing navigation, identity, theme, and audio owners.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Express, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-about-shell-design.md`

## Global Constraints

- No document/body scrolling; reading content scrolls internally.
- Preserve all eight FAQs, existing game explanations, and metadata policy.
- Preserve dirty work and immutable `docs/ops/protected`.
- No invented project history or credits; no commit/push/publication.

## Review Focus

- Opening About while connected to a table preserves client identity and room connection.
- Back/Forward and direct `/about` loading choose the correct view and return destination.
- Theme and audio controls stay owned by their existing controllers.
- Without JavaScript, the public content, FAQ, and Play/Rules links remain usable.
- Mobile, reduced motion, forced colors, and 200% reflow keep content and controls reachable.

### Task 1: Shared content and public shell

Files: create `public/clientAboutContent.js`, `public/about.css`; modify `server/aboutPage.js`, `server/about-page.test.js`, and `public/index.html`.

Interface: `renderAboutContent()` returns safe static markup; `ABOUT_FAQ` stays available to the server. The shell contains `#view-about` and `#about-page-content`.

- [x] Add failing server/browser tests for shell content, direct route, and no-JS reading.
- [x] Implement the shared renderer and server shell insertion, retaining metadata/FAQ policy.
- [x] Add the themed, responsive reading layout and native section/FAQ navigation.
- [x] Verify server About and metadata tests.

### Task 2: In-app navigation and controls

Files: create `public/clientAboutUi.js`, `qa/about.spec.js`; modify `public/main.js`, `public/clientAudioControls.js`, `public/clientThemeRender.js`, `public/clientDocumentMeta.js`.

Interfaces: `configureAboutUi({ showView, openHomeTab, openTopSurface })`, `openAboutSurface({ history = true })`, `syncAboutNavigation(view)`, and `bindAboutUi()` reuse the existing view and navigation functions and controls.

- [x] Add failing browser tests for same-document entry, history/return, themes, audio, and room continuity.
- [x] Wire the About view and secondary links into the existing app lifecycle.
- [x] Extend the existing audio proxy and theme view lists; add the About document title.
- [x] Run focused browser checks, relevant unit tests, lint, responsive captures, and one final focused review.

## Execution ledger

Ruling: Execute now in the existing checkout — the user explicitly requested implementation of the accepted direction. Keep changes uncommitted and patch shared dirty files narrowly.

Ruling: Match the app shell's no-cache HTML policy for `/about` — the route now serves the live application template rather than a separate cached article.

Ruling: Restore focus on return, falling back to the menu trigger or active view when the original entry is hidden — the failing keyboard return assertion showed that view restoration alone left focus inactive.

Completed: added secondary About entries in Home Settings, the other global headers, and the table menu. Opening About retains the current document and existing state owners.

Verification: all 12 About browser checks passed at 1920 × 1080 and 1194 × 834. The two same-document checks also passed after adding music proxy assertions. The room check used a real local public lobby, retained its seat/client/socket, and cleaned up through the normal Leave Room confirmation; it did not run a full match.

Verification: server About, server metadata, and client document metadata tests passed. Focused ESLint and scoped git diff --check completed without errors. The final read-only review and follow-up found no actionable regressions.

Verification: 14 Chromium captures covered all six themes, 2560 × 1440, 1366 × 768, three landscape iPad widths, phone, a 960 CSS-pixel reflow viewport, and forced colors, with reduced motion. Every capture reported no page errors, document overflow, or horizontal reader overflow. These are browser emulations, not physical-device or Safari tests.

Runtime: the normal local server is running on port 8080. /healthz and /about returned 200; /about returned no-cache HTML, the shell, server-rendered information, and all eight FAQs. Changes remain uncommitted.
