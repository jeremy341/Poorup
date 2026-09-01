# Poorup Player, Profile, Achievement, and Social System Audit

Status: architecture and UX plan. This is the source of truth for the next social implementation wave.

## Executive decisions

1. **Players never leave the active lobby or round for social actions.** Profiles, friend requests, invitations, and match history open as nested overlays inside the existing shell.
2. **Profile and Social are different surfaces.** Profile owns identity, personal history, designs, and achievements. Social owns relationships, requests, invites, recent players, and public player cards.
3. **Mythical achievements are the only server-wide achievement notification.** All other achievement notifications remain owner-private unless explicitly shared to friends.
4. **The server is authoritative.** Public projections are derived from verified account and match records; clients never submit totals, unlocks, or relationship state.
5. **Keep the current modular monolith.** Add bounded modules inside the existing Node server before considering a separate social service.

## Reference patterns

Fortnite exposes profile, social, add-friend, recent-player, and party actions from its active sidebar rather than forcing players through a separate out-of-session flow. [Epic’s Fortnite sidebar documentation](https://dev.epicgames.com/documentation/en-us/fortnite/exploring-the-sidebar-and-game-menu-in-fortnite-creative)

Fortnite’s Career surface separates match statistics and history from the active lobby. [Fortnite statistics and Career](https://www.epicgames.com/help/c-34254770/c-33726977/a16599089)

Riot’s companion experience separates profile identity from social communication and match history. [Riot Mobile features](https://support-leagueoflegends.riotgames.com/hc/en-us/articles/4407680309395-Riot-Mobile-Features)

Epic Online Services describes the useful platform primitives as friend management, rich presence, invitations, unified overlays, player data, and trust/safety controls. [Epic Online Services accounts and social](https://onlineservices.epicgames.com/en-US/accounts-social)

## Current-state audit

### What already exists

| Area | Current behavior | Consequence |
|---|---|---|
| Identity | Profile editor, saved designs, guest alias, account session | Good foundation for self-profile; not a public player-card system |
| Achievements | 47 client-rendered definitions, local timestamp records, clickable detail modal | No server verification or cross-device sync yet |
| Match history | Account store keeps up to 50 compact results with date, result, ending cash, and property count | Missing participants, events, trades, auctions, loans, and shared-player history |
| Social | No friendship, block, report, invite, or recent-player store | No relationship lifecycle or notification inbox |
| Leaderboards | No server projection or ranking API | Profile stats cannot become trustworthy global rankings yet |
| In-game player list | Shows player rows and avatars | No player action sheet or profile lookup |
| Notifications | Socket system messages and local achievement announcer | No persistent notification model; no server-wide Mythical bus |
| Room state | Room summaries include internal room codes and player/game state | Public projections must be separated from room-authoritative state |

### Important logic gaps

- `AccountStore.recordGameResults()` currently records only compact personal results. It cannot reconstruct full match history or friend-to-friend history.
- Achievement unlocks can currently be triggered from client code and local storage. A user can alter that storage, so it cannot feed leaderboards or server-wide announcements.
- The current public account projection includes stats and history but has no field-level privacy policy.
- The game client’s player list is a renderer, not a social interaction seam. It needs a player-id action sheet that does not navigate away from the game.
- No relationship authorization exists yet. Every future read needs a public projection, friend projection, or self projection.
- Public-room discovery can use an internal room identifier, but the UI should not expose an invite code for a public room.
- There is no persistent notification queue for a player who is offline or outside a round.

## Data classification

### Public

- Display name
- Avatar and public design
- Public achievement names and rarity after unlock
- Wins, games, win rate after minimum-game threshold
- Public event badges
- Online presence, if enabled

### Room-visible

- Player presence in the current room
- In-round status
- Actions necessary for gameplay
- A generic Mythical unlock announcement

### Friends-only by default

- Shared match history
- Mutual friends
- Recent shared opponents
- Optional achievement feed items

### Private

- Email, account ids, session data
- Exact cash history
- Active loan terms and collateral
- Hidden achievement conditions
- Private chat
- Private room code

The server must build each projection explicitly. Do not serialize an account object and remove fields ad hoc in the browser.

## In-session shell architecture

The current `view-game` remains mounted while every social action is open.

```text
view-game
  ├─ board, chat, HUD, turn timer
  ├─ social trigger
  └─ overlay stack
      ├─ player action sheet
      ├─ public player card
      ├─ friend request confirmation
      ├─ room invitation confirmation
      └─ match history detail
```

Rules:

- Opening an overlay does not call `showView()`.
- Turn timer, dice state, pending purchase, auction, and chat scroll position remain unchanged.
- Closing a nested overlay returns focus to the control that opened it.
- A mobile action sheet becomes a bottom sheet; desktop can anchor it beside the player row.
- The overlay stack uses the existing `openSurface`/`closeSurface` focus and inert behavior.

## Player action sheet

Clicking another player’s avatar or row in the left rail opens:

- Avatar, display name, and presence text
- Mutual friends
- `VIEW PROFILE`
- `SEND FRIEND REQUEST`, `REQUEST SENT`, `FRIENDS`, or `REMOVE FRIEND`
- `INVITE TO ROOM`
- `MATCH HISTORY`
- `BLOCK`
- `REPORT`

Clicking your own row opens your self profile summary, not a friend request action.

If a player is blocked, replace social actions with `BLOCKED` and `UNBLOCK`. Never reveal that a different player reported them.

## Public player profile

The public profile is read-only and intentionally smaller than the owner profile.

Show:

- Display name and avatar
- Presence
- Public achievement count and unlocked public badges
- Wins, games, and qualified win rate
- Public event survival count
- Mutual friends
- Recent shared match summary

Hide:

- Email, username internals, and account ids
- Exact cash or property history
- Active bank loan or collateral
- Hidden Mythical conditions
- Private chat and room codes
- Any field disabled by the owner’s privacy settings

The public profile opens in the same overlay stack from the game, lobby, leaderboard, friend list, recent players, and match-history rows.

## Friend lifecycle

```text
NONE → REQUESTED → ACCEPTED
       ├→ DECLINED
       ├→ CANCELED
       └→ BLOCKED
```

Rules:

- Requests are keyed by account ids, never names.
- Duplicate requests are idempotent.
- A request can be accepted or declined from an inbox overlay.
- Blocking removes the friendship, cancels invitations, and hides search results.
- Guests can send a temporary in-room request prompt, but persistent friendships require an account.
- Request and invite rate limits are mandatory.

## Room invites

Invites are sent from the player action sheet without leaving the room.

The recipient sees:

```text
WAL INVITED YOU TO AFTER HOURS
4 SEATS · PUBLIC
[JOIN] [DECLINE]
```

Acceptance revalidates:

- Room existence
- Room visibility and authorization
- Capacity
- Game phase
- Invite expiration
- Block relationship

Public rooms use direct directory joining. Private rooms use an internal invite reference and only show a code when the user explicitly opens the private-room details.

## Match-history system

### Immutable match record

Create one record only when a server game completes:

```js
{
  gameId,
  completedAt,
  durationSeconds,
  roundCount,
  roomVisibility,
  participants: [{
    accountId,
    displayNameAtMatch,
    avatarAtMatch,
    finalPlacement,
    endingCash,
    propertyCount,
    completedGroups,
    auctionWins,
    rentCollected,
    bankLoanTaken,
    bankLoanDefaulted,
    achievementsUnlocked,
    globalEventsExperienced
  }],
  globalEvents,
  eventCombinations,
  tradesCompleted,
  auctionsCompleted
}
```

### Views

Self history:

- Full participants
- Placement and ending cash
- Properties, groups, loans, events, trades, and auctions
- Achievements unlocked in that match

Public player history:

- Date and result
- Placement
- Property count
- Public achievement badges
- Shared events

Friend history:

- Shared matches
- Head-to-head wins/losses
- Shared event combinations
- Trades completed together

### Retention

- Keep the latest 50 self matches in the existing account summary.
- Keep a compact indexed match record for ranking and friend queries.
- Guests get session-only history; accounts get durable history.
- Allow a player to hide friend/public match history.

## Achievement synchronization and announcements

The client may display progress, but the server verifies unlock evidence from authoritative game facts.

### Normal achievements

- Owner receives a toast, profile badge, and notification-center item.
- Friends receive an item only if the owner allows friend-feed sharing.
- No room-wide or server-wide broadcast.

### Mythical achievements

- Server verifies the unlock once.
- Every currently connected player across every room receives a generic server-wide announcement.
- The title remains hidden globally until the owner reveals it.
- Offline players do not receive a delayed global replay.
- Owner receives the full title and description in their private profile notification.

## Leaderboards

Leaderboards live in a top-level Rankings/Social hub, not inside the Profile editor.

Boards:

- Wins
- Qualified win rate
- Games played
- Achievement score
- Mythical count
- Event survival
- Auction wins
- Best comeback
- Parlor Patrol best score

Every board supports `ALL TIME`, `MONTH`, and `FRIENDS` scopes. Win rate requires at least five completed games. Scores come from server projections, not client totals.

## Server modules and seams

Keep the current modular monolith and add explicit modules:

```text
AccountStore       identity, authentication, self profile
MatchStore         immutable completed matches
AchievementStore   verified unlocks and notification receipts
SocialStore        friendships, blocks, privacy, requests
InviteStore        room invites and expiration
LeaderboardStore   rebuildable public ranking projections
NotificationBus    room/server-wide delivery and offline queue
```

Proposed read seams:

- `get-public-player-card`
- `get-self-profile`
- `get-friends`
- `get-friend-requests`
- `get-recent-players`
- `get-match-history`
- `get-leaderboard`
- `get-notifications`

Proposed write seams:

- `send-friend-request`
- `respond-friend-request`
- `remove-friend`
- `block-player`
- `report-player`
- `send-room-invite`
- `respond-room-invite`
- `mark-notification-read`

Every seam must validate account authorization, room membership where relevant, idempotency, and rate limits.

## Implementation sequence

1. Extract explicit public/self/friend projections from `AccountStore`.
2. Add immutable match records while preserving the current compact history UI.
3. Add server-verified achievements and private notification receipts.
4. Add `NotificationBus` with Mythical server-wide broadcast only.
5. Add the in-game player action sheet and public profile overlay.
6. Add friend requests, blocking, reporting, and recent players.
7. Add in-session room invites.
8. Add match-history overlays and shared-match views.
9. Add leaderboard projections and the top-level Social/Rankings hub.
10. Add privacy controls and abuse tooling before public rollout.

## Acceptance criteria

- A player can inspect another player, send a friend request, and close the overlay without leaving the round.
- A player can view shared match history without changing turn state or timer state.
- Public profile responses contain no private loan, email, room-code, or hidden-achievement fields.
- A normal achievement never creates a server-wide notification.
- A Mythical achievement creates exactly one generic server-wide notification per account unlock.
- Duplicate requests, invites, notifications, and unlock events are idempotent.
- Blocked players cannot search, invite, or message each other.
- Every displayed leaderboard value traces to a completed server match or verified achievement.
- Keyboard, touch, screen reader, narrow viewport, reconnect, offline, and full-room flows pass.

## Audit update: keep the player in the current shell

The no-navigation rule is now explicit for every entry point:

```text
active lobby or round
  → click player row/icon
  → action sheet overlay
  → public profile overlay
  → match history overlay
  → friend/invite confirmation
  → close
  → same board, same turn, same timer, same scroll position
```

The client must not call `showView('profile')`, `enterParlor()`, or `goHome()` for any of these actions. Those functions are reserved for the user’s own top-level navigation.

### Current code seams checked

- The current left-rail player rows render avatars and cash, but do not yet expose a player action sheet.
- The current `Profile` view is an identity editor and achievement collection, not a public profile projection.
- `AccountStore.recordGameResults()` stores only compact personal history, so a richer immutable match record is still required.
- Achievement records currently begin in browser storage; server verification and global Mythical notifications remain a separate backend slice.
- No `SocialStore`, friend lifecycle, invitation lifecycle, or privacy projection exists yet.
- No leaderboard projection or public-player lookup endpoint exists yet.

These are implementation gaps, not reasons to move social actions out of the game shell.

## Overlay contract

Every social overlay should carry the same context contract:

```js
{
  source: 'game-player-row' | 'lobby-player-row' | 'leaderboard' | 'friend-list',
  returnFocusId,
  roomId: currentRoomId || null,
  turnSnapshot: { currentPlayerId, roundNumber, timerDeadline }
}
```

When the overlay closes, the client asserts that the turn snapshot was not mutated by the social action. If a server update arrives while an overlay is open, the overlay refreshes its projection without closing or navigating.

## Notification scope correction

The notification bus has three distinct scopes:

1. **Owner:** all achievement unlocks, friend requests, invite outcomes, and private history updates.
2. **Friends:** optional normal-achievement feed items and presence changes.
3. **Server-wide:** only the generic Mythical achievement announcement, one time per verified unlock.

Room membership is not a substitute for server-wide delivery. A Mythical event must be published to all currently connected rooms through the server notification bus, while keeping its title hidden.

## Reference-derived UX rules

- Use an in-session sidebar/action sheet for social discovery and recent players, following Fortnite’s active-session pattern.
- Keep profile identity separate from social relationships and match history, following Riot’s pattern.
- Treat presence, invitations, friend management, and trust/safety as first-class primitives, following Epic Online Services.
- Keep public player cards intentionally smaller than the owner profile.

## Next implementation gates

Before adding leaderboard polish or social animations, the following gates must pass:

- Public/self/friend projections are field-level allowlists.
- Friend request and invite writes are idempotent and rate-limited.
- Player action sheet opens and closes without changing turn state.
- Match records are immutable and created only on completed games.
- Achievement unlocks are server-verified.
- Mythical announcements publish exactly once server-wide.
- Blocked players cannot search, invite, or message each other.
