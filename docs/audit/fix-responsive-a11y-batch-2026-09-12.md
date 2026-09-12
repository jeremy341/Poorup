# Responsive and accessibility fix batch — 2026-09-12

Status: implemented and verified. This report records the third parallel
implementation batch; it does not change gameplay or Socket.IO contracts.

## Changes

- Added page skip links, named main landmarks, page-level headings, and a
  browser `theme-color` while preserving the existing Poorup surface stack.
- Removed duplicate static connection/chair status markup. Dynamic status is
  kept in the existing live-region owners instead of rendering two copies.
- Raised shared modal close targets and landscape iPad navigation, audio, and
  chair controls to a 44px touch floor; the common mobile close floor remains
  40px where the compact surface cannot grow further.
- Gave mobile text inputs a 16px minimum to avoid browser zoom on focus and
  reflowed the portrait Rules intro and Home patrol readouts into reserved
  rows, without changing desktop composition.
- Added an overflow cue for the compact mobile navigation and allowed long
  global-event summaries to wrap rather than truncate.
- Replaced undefined legacy CSS aliases (`--ink-*`, `--font-mono`) with the
  current Poorup semantic text and numeric tokens.
- Updated touch profile painting to resolve the cell under the pointer, so a
  drag does not keep painting only the initial cell.
- Kept ambient motion behind the UI and paused the existing house drift with
  the established hidden/reduced-motion state; no new motion or layout system
  was introduced.

## Verification

- `node public/clientResponsiveA11y.test.js` — 12 passed, 0 failed.
- `npm run lint:client` — passed.
- Browser coverage is included in `qa/batch3-responsive-a11y.spec.js` for
  the responsive/a11y contracts; the full Playwright matrix remains a
  release-gate command run from the root pipeline.

## Deliberate scope

The optional user-facing `PAUSE AMBIENCE` control remains deferred. Existing
visibility, reduced-motion, forced-colors, and document-hidden pause hooks are
preserved; adding a new control would change the compact UI surface and is a
separate product slice.
