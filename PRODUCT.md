# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Friends who want to start a competitive property-trading board game in a browser without creating accounts or installing software. Players may host a room, join with a short code, chat, and resume after an interrupted connection.

## Product Purpose

Poorup makes a full real-time multiplayer board game immediately playable from a shared link or room code. Success means players understand how to enter a room, can always identify the current turn and next legal action, and can finish a game without losing shared state.

## Positioning

Poorup combines a complete server-authoritative property game with account-free room entry and reconnect support. The client is a focused game surface rather than a game catalog, social network, or downloadable tabletop simulator.

## Operating Context

- Played in a desktop browser during a remote or in-person game night.
- The host configures rules in the lobby and starts once at least 2 players are present.
- Players repeatedly scan the board, current-turn state, cash, owned properties, chat, and contextual decisions.
- The target presentation is large desktop at 1920x1080 and 2560x1440.

## Capabilities and Constraints

- Real-time rooms, host controls, chat, auctions, purchases, building, mortgaging, trading, bankruptcy, winning, and reconnect support. Public tables are discovered in the directory; private tables use a host-chosen six-character invite code.
- Optional accounts persist a stable username, display name, pixel identity, and server-recorded games/wins; guest play remains available without sign-in.
- Server-side game logic remains the source of truth and existing Socket.IO contracts remain stable.
- Frontend remains vanilla HTML, CSS, and JavaScript.
- Board presentation uses the supplied pixel-parlor visual language in a 40-space HTML/CSS renderer while live Socket.IO state remains server-authoritative.
- Smaller screens keep the existing functional fallback but are not part of this redesign's visual acceptance target.

## Brand Commitments

- Product name: Poorup.
- Voice: direct, playful, competitive, and concise. No invented claims, fake social proof, or mock statistics.
- Visual identity: After-hours Game Parlor, a dark neo-retro tabletop with selective pixel and screen-print character and modern readable controls.

## Evidence on Hand

- Working multiplayer implementation in `server/` with the plain client in `public/main.js`.
- The latest supplied archive adds a profile library, room tabs, sound toggle, card reveals, deed detail, auction pass UI, turn timer, and game-over surface; these remain available in the plain client.
- Existing board topology and content in the plain HTML/CSS board renderer; the protected legacy SVG copy is retained only for rollback.
- Current landing and game-shell accessibility improvements live in `public/index.html` and `public/styles.css`.
- No testimonials, usage numbers, customer logos, or external performance claims are available and none may be fabricated.

## Product Principles

1. The next legal action is always obvious.
2. The board is the game world and remains visually dominant.
3. Secondary information stays available without covering the active play area.
4. Real-time state changes are legible, accessible, and never decorative noise.
5. A player can enter a room without an account or unnecessary ceremony.

## Accessibility & Inclusion

Target WCAG 2.2 AA. All game actions must be keyboard reachable, status cannot depend on color alone, blocking decisions manage focus, motion has a reduced variant, and dynamic updates are announced without overwhelming assistive technology.
