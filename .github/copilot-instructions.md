# Poorup — Copilot Code Review Instructions

## Ground truth
- Vanilla ESM JavaScript. No TypeScript, no frontend framework, no build step.
  `public/index.html`, `public/styles.css`, `public/main.js` ship as-is.
- Server: Node >= 22, Express + Socket.IO (`server/server.js` handlers,
  `server/gameLogic.js` rules engine, `accountStore/achievementStore/matchStore/
  socialStore/botAdvisor`). State is in-memory Maps — there is NO database.
- Client `public/main.js` (~8.4k lines) is a single-file SPA. `:root` in
  `styles.css` holds all design tokens; raw hex outside `:root` is a violation.
- Conventions: double quotes in JS, minimal diffs, no new dependencies without
  an explicit decision.
- Tests: `npm test` (custom node:assert contract harness in
  `server/gameLogic.test.js`, ~64% coverage under `npm run coverage`).
  Server-side only; no client tests exist.
- Lint: ESLint flat config scoped to `server/` only (`npm run lint`).
  `public/` is deliberately unlinted legacy for now.

## Review priorities (bugs first, taste last)
1. Game-state correctness: `gameLogic.js` is the single source of truth; the
   client only renders. Flag any client mutation the server doesn't revalidate.
2. Realtime/race hazards: Socket.IO handler ordering, reconnect paths
   (`restore-session`, seat re-join, host reassignment), timer leaks
   (room GC, turn timers, Night Shift), mid-action disconnects.
3. Trust boundaries: room codes, nicknames, chat, appearance payloads are
   untrusted. Reject malformed/oversized input server-side; never trust client
   phase/turn claims.
4. Persistence consistency: `server/data/` JSON stores — torn writes,
   ID collisions, fallback-path drift, and saved-data shape changes that
   break previously stored records (backward compatibility of serialized
   state is load-bearing).
5. Null/undefined: deep chains on snapshot/player/room objects; optional
   access added silently where a guard is missing.
6. Error handling: rejected acks must surface to the user (toast layer
   exists — route new failure paths through it, don't add silent `return`s).
7. Performance: per-frame work in `public/main.js`, listeners added without
   removal, per-tick DOM rebuilds (renderers should diff by attribute).
8. Duplication: leave-cleanup and room-lookup logic was historically
   copy-pasted 3x with drift — flag new copies instead of tolerating them.

## Do NOT
- Suggest rewrites, re-architecting, or new frameworks. This repo is
  deliberately dependency-free.
- Flag style/naming/formatting that a linter would catch — out of scope, noise.
- Demand UI/visual changes unless the PR is explicitly UI-related; the
  design system in `:root` + `supplied/poorup_design_system.md` is locked.
- Abstract for abstraction's sake; a second call site is not yet a pattern.
- "Clean up" working behavior, dead-looking branches that document intent,
  or legacy `!state.live` branches outside the PR's scope.
- Propose changes to `server/data/`, `.ulpi/`, `supplied/`, or asset files.

## Output expectations
- Only comment where there is a defect or material risk. Silence on clean
  diffs is correct.
- For each finding: file:line, concrete failure scenario (inputs -> wrong
  state), severity, smallest safe fix. Prefer one patchable suggestion over
  prose.
- Verify a claim by reading the surrounding function before flagging;
  do not pattern-match on snippets in isolation.
