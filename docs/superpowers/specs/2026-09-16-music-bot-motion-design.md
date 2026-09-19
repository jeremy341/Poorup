# Music Dock, Bot Fallback, and Background Motion Design

**Status:** approved for implementation  
**Scope:** client music controls, bot provider availability, and decorative board-piece motion  
**Non-goals:** game-rule changes, new navigation, new frameworks, legal surfaces, or server-owned economy behavior

## Design authority

Poorup remains a compact pixel-parlor interface: existing fonts, tokens, shell, modal stack, safe-area rules, and board geometry remain authoritative. The global music dock stays one `aside[data-music-box]` outside all SPA views. Theme changes continue to select the theme default track and use the existing dual-audio crossfade.

## Music dock

The dock is a fixed, compact panel with four safe corner anchors. The move grip supports a press-and-hold drag preview and a keyboard menu alternative. Dragging uses pointer capture, an 8px activation threshold, transform-only preview motion, and release snapping. Position persistence stores only one of `top-left`, `top-right`, `bottom-left`, or `bottom-right` in `poorup.music.position.v1`.

The current controls remain: previous, play/pause, next, shuffle, repeat, vertical volume popover, progress meter, and theme-aware title/mode. A bounded track chooser may expose the approved manifest queue without introducing page navigation. Theme changes reset to the theme default, enable loop, clear shuffle, and crossfade; manual choices last until the next theme change. Audio playback itself is not paused by tab visibility changes. The UI reconciles from the media element's real `currentTime` after visibility changes.

All controls are native buttons or range inputs with accessible names, pressed states, focus restoration, Escape/outside dismissal, 44px coarse-pointer targets, safe-area insets, and no page scroll. The dock remains below modal scrims. Optional Media Session integration is progressive enhancement only.

## Bot modes and provider state

The public bot-brain choice is exactly `AI BOT` or `NO-AI BOT`. Existing `auto` values are accepted only as a compatibility alias for `ai`; new UI and snapshots do not expose `AUTO`. Personality and difficulty remain separate settings.

The single server advisor owns provider availability. A confirmed quota/credit response enters sticky `quota-exhausted` state until process restart or an explicit health reset. AI decisions then fall back to the deterministic advisor with `fallback: true`, `effectiveBrain: 'no-ai'`, and a redacted `fallbackReason`. Credentials and provider payloads never reach clients.

The provider publishes one versioned status event. Clients in rooms using AI bots show a top-center, theme-independent red banner:

> AI CREDITS EXHAUSTED · BOT IS NOW USING NO-AI MODE

The AI option remains visible but disabled and marked in red; NO-AI remains selectable. Forged attempts to choose AI while quota-exhausted receive a deterministic error. Transient network failures retain per-decision fallback without claiming credits are exhausted.

## Bot bankruptcy

The existing bot payment policy already tries legal liquidation, then emergency credit, then `declareBankruptcy`. Implementation must preserve that order and add seam tests for both deterministic and AI-fallback advisors. A bot declares bankruptcy only when resolving an unpaid obligation; voluntary solvent retirement remains a separate human action.

## Background board motion

The existing deferred `requestAnimationFrame` walk start plus chained timers can replay a full path after a hidden tab returns. The renderer will use an elapsed-time walk timeline: each walk stores its start clock, path, step duration, and destination. A delayed callback computes the current step directly. A `visibilitychange` reconciliation finishes completed walks or positions them at the correct in-between step. Newer snapshots cancel/rebase stale walks. Large jumps, first snapshots, rematches, and reduced motion snap directly.

Only transforms and the existing hop animation move. The server remains authoritative for positions; no gameplay state is added. If exact cross-client animation phase is later required, an optional movement sequence/timestamp can be added behind a separate decision record.

## Acceptance

- Music remains one global dock and has no duplicate controls.
- Four-corner drag and keyboard placement are equivalent and persisted safely.
- Theme changes crossfade to the correct default track.
- AI quota exhaustion produces one red global notice, disables AI selection, and keeps every bot progressing on deterministic logic.
- Both bot modes can complete a debt bankruptcy path without duplicate actions.
- Returning to a tab shows the current walk phase or destination, never a replay from step one.
- Existing server/client tests, lint, browser contracts, accessibility, reduced-motion, forced-colors, and 1920x1080 screenshots remain green.
