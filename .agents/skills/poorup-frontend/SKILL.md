---
name: poorup-frontend
description: Use when changing Poorup frontend UI, themes, charts, music, responsive layouts, motion, pixel or SVG assets, accessibility, or visual polish.
---

# Poorup Frontend

## Overview

Use this skill to make small, high-craft changes to Poorup's vanilla frontend. Keep the pixel-parlor design, gameplay contracts, server authority, and no-document-scroll rule intact.

## Read project and set scope

1. Inspect `git status`, the exact diff, `AGENTS.md`, `PRODUCT.md`, `.ulpi/design/DESIGN.md`, and `.ulpi/design/LAYOUT-INVARIANTS.md`. If a file is absent, state that and use the nearest repository context. Preserve dirty work and record an allowed-path list.
2. Inspect the rendered incumbent surface, its HTML/CSS/JS, state owner, event seam, tests, and existing assets before edits. If no populated browser capture or runnable app is available, use existing screenshot artifacts and source contracts; label conclusions as source-only and visual verification as unverified.
3. Keep Poorup's after-hours pixel-parlor language, tokens, typography, geometry, game behavior, and server authority.

## Route skills by need

- Use `frontend-design-ui-ux` for a new or substantially changed flow needing a written UX/UI spec; `frontend-design` and `design-taste-frontend` for visual direction.
- Use `impeccable`, `critique`, and `frontend-design-review` for one focused craft/accessibility review, not repeated redesigns.
- Use `game-ui-ux` and `mobile-responsiveness` for game surfaces and viewport behavior; `accessibility` and `web-design-guidelines` for keyboard, contrast, zoom, and assistive technology.
- Use `animate`, `emilkowal-animations`, or `design-motion-principles` only when motion is part of the request; inspect existing motion with `review-animations`.
- Use `svg-design`, `pixel-art-sprites`, and `Pixel Art Animator` only when vector or sprite assets change.
- Use `tdd`, `systematic-debugging`, and `verification-before-completion` for behavior changes. Avoid loading overlapping skills that repeat the same review.

## Implement and verify

- Prefer existing components, CSS tokens, DOM contracts, events, and one canonical state/controller owner. Do not add duplicate controllers or unrelated redesigns.
- Never introduce document/body scrolling. Put overflow inside a deliberate, keyboard-accessible surface or internal tab; keep focus visible and show an overflow cue where needed.
- Cover loading, empty, error, disabled, retry, hidden-view, teardown, reduced-motion, forced-colors, and 200% zoom states as applicable.
- Sanitize stored/query values with own-property allowlists. For audio, preserve approved local track IDs, the user's disabled state, and at most two audio nodes during crossfade.
- Capture and inspect screenshots at 1920×1080 first; then 1366×768, 1024×768, iPad landscape, and 390×844. Check no page overflow and exercise keyboard paths.
- Run changed-path tests and browser contracts, then relevant suites and lint. State exactly what ran; never infer visual success from source inspection alone.
- Review the final diff against the path allowlist and report unresolved evidence gaps.

## Browser and chart surfaces

For admin analytics, favor truthful small multiples grouped by unit, actual denominators, clear labels, internal overflow, and an accessible data table at zoom/forced colors. Keep the current chart engine when it supports the required data shapes; fix composition and semantics before proposing a library swap. Do not add gradients, 3D, or fabricated trends.

## Review gate


Use one design lead, one implementation owner, and only focused specialist reviews.



## Bundled resources
Create shared scripts, references, or visual assets only when they will be reused; keep one-off implementation code in the product files.

Keep this skill concise. Add a referenced resource only when it materially improves repeatability.
