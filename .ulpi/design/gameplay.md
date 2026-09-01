# Gameplay Surface Brief

## Job and Audience

Players arrive ready to create or join a room, then spend most of the session reading the board and acting on the current turn. The interface must support fast scanning during a social game without resembling a generic dashboard.

## Outcome and Proof

- Entry requires only a nickname and, for joining, a room code.
- The current player, available action, cash, dice, and pending decisions remain visible.
- The working server-authoritative rules, reconnect flow, auction timer, chat, and board content are the proof.

## Selected Direction

Use the supplied system in `DESIGN.md`. The Figma master board is the focal moment. Left and right rails are attached to the game table rather than floating cards. A bottom command deck makes the next action unmistakable.

## Surface Structure

1. Landing portal: atmospheric tabletop crop, product promise, Create/Join mode, and one submit action.
2. Appearance step: centered first-run overlay with color names and symbols.
3. Lobby: players/chat left, board center, settings right, invite code top, start state bottom.
4. Active game: properties and trade context replace settings; bottom deck owns turn actions.
5. Purchase and auction: blocking decision dock attached to the board bottom edge.
6. Property, trade, and help: right-side sheets.
7. Winner: centered rare celebration with a direct return action.

## States

- Landing validation, creating, joining, invalid/expired room, and connection failure.
- Lobby waiting for players, host/non-host, ready/disconnected, settings locked.
- Turn waiting, active before roll, active after roll, doubles, jail, debt, purchase, auction, trade, bankruptcy, reconnect, and winner.
- Empty property/trade/chat states use useful copy rather than blank containers.

## Responsive Contract

- 1920x1080: both rails visible; the supplied 960x670 master artwork is fitted into the board frame without page scroll.
- 2560x1440: workspace expands across the desktop while the 40-space HTML/CSS board remains the focal center visual.
- Below 1000px: retain the existing stacked fallback without redesign expansion.

## Acceptance Criteria

- All existing socket actions and the legacy live tile indexes `0–39` behave identically between server and client.
- No horizontal overflow or clipped primary action at either target viewport.
- The UI is recognizable without its logo, passes the anti-slop gate, and keeps pixel treatments subordinate to legibility.
- Keyboard, focus, live-region, reduced-motion, zoom, and contrast checks pass.
