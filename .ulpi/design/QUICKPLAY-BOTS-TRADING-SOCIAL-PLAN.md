# Quick Play, Solo Bots, Trade Value, and Friends Plan

Status: planning only. No gameplay source changes are authorized by this
document.

## Scope decisions

- **Quick Table is Auto-Join.** It is not a separate game mode. It searches for
  a public, non-full lobby and joins it; if none is available, it creates a new
  public lobby.
- **Solo Dev Mode uses the same server rules.** Bots are real server-side
  participants driven through the existing game engine, not client-only fake
  players.
- **Trade totals are a decision aid.** The UI shows cash, deed face value, and
  optional building liquidation value for each side. The server remains the
  authority for legality and execution.
- **Friends are account-backed.** Guests can play and share a room link, but
  persistent friend requests and presence require an account.
- **Homepage color is already accepted.** Do not redesign the homepage palette
  in this workstream.
- **Large centered dice feedback remains queued.** Reserve the event contract
  and visual slot now, but implement it after Quick Play and bots stabilize.

## 1. Quick Table auto-join

### User flow

1. Player presses `QUICK TABLE`.
2. Client requires a guest alias for guests or uses the account display name.
3. Client requests the public-room directory with an `open` filter.
4. Rooms are ranked by available seats, lobby state, and freshness.
5. Client attempts to join one candidate using the existing `join-room` event.
6. If the room fills or disappears during the race, retry the next candidate.
7. If no candidate succeeds, create one public room with default settings.
8. Show a concise status: `FINDING A TABLE`, `JOINED`, or `HOSTING A NEW TABLE`.
9. Preserve an explicit cancel action before the player enters setup.

### Server requirements

- `list-rooms` returns only public, active, non-full rooms with authoritative
  seat counts and a stable `updatedAt`/sequence value.
- `join-room` must remain race-safe: seat validation and insertion happen in one
  server operation; a full-room response is retryable, not fatal.
- Never expose private-room codes through Quick Table.
- Never silently move a player from an existing active room.

## 2. Server-authoritative bots and Solo Dev Mode

### Modes

- **Solo Dev:** create a private local-development session with one human and
  three CPU players.
- **Fill with Bots:** optional host action in a lobby to fill remaining seats.
- **Quick Table:** never inserts bots into a public room unless the player
  explicitly selects Solo Dev; it only auto-joins or hosts.

### Bot architecture

- Add a `BotPlayer` identity with stable server IDs, a display name, color, and
  deterministic decision seed.
- Bots live inside `gameLogic.js`, not the browser client.
- Bot turns call the same validated actions as humans: roll, buy/pass, bid/pass,
  build/sell, trade response, jail payment, and bankruptcy handling.
- Use a server scheduler per room with one cancellable timer. Never use a client
  interval to advance a bot turn.
- Broadcast bot actions through the existing room-state/feed events so every
  client sees the same result.
- Bots cannot receive friend requests, count as online friends, or create
  duplicate reconnect sessions.
- Disconnecting the human in Solo Dev pauses safely and allows reconnecting;
  bot timers are cleared when the room is destroyed.

### Bot decision guardrails

- Make decisions deterministic under a seed for reproducible debugging.
- Add bounded thinking delays for readability, not random wait loops.
- Validate every action server-side and re-check state after each delay.
- Prevent bots from trading with themselves, bidding after auction close, or
  acting after bankruptcy.

## 3. Trade total-value summary

Replace the current deed-count-only summary with two explicit totals:

- **YOU SEND:** cash + deed face value + building resale value.
- **YOU RECEIVE:** cash + deed face value + building resale value.

Rules:

- Face value uses the authoritative current deed price.
- Houses/hotels use the server’s configured resale value, shown separately so
  players understand the calculation.
- Mortgage status and unavailable deeds are excluded or clearly marked.
- The net difference is shown as `NET +$X` / `NET -$X`, never as a claim that a
  trade is objectively fair.
- The summary updates on every deed, cash, and recipient change without
  rebuilding the modal or stealing focus.
- The server recalculates/validates the same values before accepting a trade.

## 4. Friends and social surface

### Profile tab

Add a `FRIENDS` tab alongside Overview, Statistics, Designs, History, and
Account:

- Friend count and online count.
- Search by stable username, never by guest alias.
- Pending incoming and outgoing requests.
- Accept, decline, remove, and block actions.
- `INVITE TO ROOM` for friends currently online.
- Copyable room invite for offline friends without exposing private settings.
- Honest empty states for no account, no friends, and no online friends.

### Account/server model

- Store normalized friend edges and request status in `accountStore.js`.
- Enforce one request per pair, idempotent accept/remove, and block precedence.
- Add optional Socket.IO events for request, accept, remove, block, and presence
  updates.
- Presence is coarse (`online`, `in lobby`, `in game`, `offline`), never precise
  location or activity telemetry.
- Guests retain local profile designs but cannot create persistent relationships.

### Privacy and accessibility

- Account controls explain what becomes persistent.
- No username enumeration through error messages.
- Native buttons, labelled tabs, focus restoration, live request status, and
  keyboard-safe menus.
- Color never carries the only meaning for online, pending, blocked, or invited.

## 5. Reserved centered dice result

Keep the future event contract compatible with the existing roll result:

- `dice-result` payload: player, die A, die B, total, and turn sequence.
- A single centered board announcement appears for roughly 700–900ms, then
  collapses into the normal HUD/feed.
- Do not animate the board layout or duplicate the result in chat repeatedly.
- Respect reduced motion with a static centered result and live announcement.

## Skill workflow

Use the applicable skills in this order:

1. `frontend-design-ui-ux`, `frontend-design`, `design-taste-frontend`, and
   both `impeccable` variants for information architecture and anti-slop UI.
2. `game-ui-ux` for lobby/solo state stacks, matchmaking feedback, bot turn
   status, and dice-result anchoring.
3. `code-architecture-review` and `software-architecture-design` for keeping
   bot orchestration, social persistence, and trade valuation out of the view
   layer.
4. `systematic-debugging` and `tdd` for race-safe joins, deterministic bot
   turns, and trade total calculations.
5. `accessibility` and `web-design-guidelines` for keyboard, focus, privacy
   copy, live regions, contrast, and empty states.
6. `copywriting` for Quick Table statuses, bot labels, friend requests, and
   trade fairness language.
7. `animate`, `emilkowal-animations`, `improve-animations`, and
   `review-animations` for restrained matchmaking feedback and the reserved
   dice announcement.
8. Browser verification at desktop target sizes plus a two-tab multiplayer,
   Quick Table, Solo Dev, trade, and friend-request smoke suite.

## Acceptance criteria

- Quick Table joins an available public room or hosts one without exposing
  private rooms and without race-condition errors.
- Solo Dev starts a real server-authoritative game with three bots.
- Bot actions are synchronized across tabs and stop cleanly on disconnect,
  bankruptcy, game over, and room cleanup.
- Trade totals update correctly for cash, deeds, houses, hotels, and mortgages.
- Friends can request, accept, remove, block, and invite from the profile tab;
  guests receive clear account-required messaging.
- Homepage color remains unchanged.
- Dice-result event contract is ready but its visual implementation remains a
  separately testable phase.
- `node --check`, `git diff --check`, no console errors, no duplicate live
  announcements, and no hidden state transitions remain.
