# Poorup Match History and In-Session Social UX

Status: design proposal.

## Product rule

Players must never leave the current lobby or round to inspect another player, send a friend request, or review shared match history. Every social action is an overlay on the active shell.

This follows the session-first patterns used by Fortnite’s sidebar, which exposes social, add-friend, recent-player, and party actions from the current lobby/game context, and Riot’s separation of profile, social, and match-history surfaces.

References:

- [Fortnite sidebar and game menu](https://dev.epicgames.com/documentation/en-us/fortnite/exploring-the-sidebar-and-game-menu-in-fortnite-creative)
- [Fortnite statistics and career history](https://www.epicgames.com/help/c-34254770/c-33726977/a16599089)
- [Riot Mobile profile and match history](https://support-leagueoflegends.riotgames.com/hc/en-us/articles/4407680309395-Riot-Mobile-Features)

## Match record contents

Store one immutable, server-generated record when a completed game ends:

```js
matchHistory: {
  gameId,
  completedAt,
  durationSeconds,
  roundCount,
  roomVisibility,
  playerCount,
  participants: [{
    accountId,
    displayNameAtMatch,
    avatarAtMatch,
    finalPlacement,
    endingCash,
    propertyCount,
    completedGroups,
    winsAuction,
    rentCollected,
    loanTaken,
    loanDefaulted,
    achievementsUnlocked,
    globalEventsExperienced,
    mythicalUnlocked
  }],
  globalEvents,
  eventCombinations,
  tradesCompleted,
  auctionsCompleted
}
```

The record should not store private chat, room codes, exact turn-by-turn cash, hidden card order, or private account identifiers in public responses.

## What a player can see

### Own history

The owner can see:

- Full participant list.
- Final placement and ending cash.
- Property and group totals.
- Loans taken, repaid, or defaulted.
- Global events and combinations.
- Achievements unlocked during the match.
- Trades and auctions completed.

### Another player’s public history

Show only:

- Shared match date.
- Placement.
- Win/loss result.
- Property count.
- Public achievements.
- Shared event badges.

Hide exact ending cash, private loan details, unannounced Mythical titles, and private-room metadata unless the player has opted in.

## In-session flow

```text
Player icon
  → action sheet
      → View profile (overlay)
      → Send friend request (inline confirmation)
      → Invite to room (inline confirmation)
      → Match history (nested overlay)
```

Every nested overlay has a back/close action that returns to the previous overlay and restores focus to the initiating control. The board, chat scroll position, timer, and turn state remain untouched.

## Player action sheet

The action sheet should include:

- Avatar and display name.
- Presence: `IN THIS ROOM`, `IN ROUND`, `LOBBY`, `OFFLINE`.
- Mutual friends.
- `VIEW PROFILE`.
- `SEND FRIEND REQUEST`.
- `INVITE TO ROOM`.
- `MATCH HISTORY`.
- `BLOCK` and `REPORT`.

If the selected player is already a friend, replace the request action with `REMOVE FRIEND`. If a request is pending, show `REQUEST SENT` and allow cancellation.

## Match-history overlay

The overlay contains:

- Header: player name and “MATCH HISTORY”.
- Scope chips: `ALL`, `WITH ME`, `GLOBAL EVENTS`.
- Recent match rows with date, placement, participants, and result.
- Expandable match detail inside the overlay.
- Privacy note when details are intentionally omitted.

The overlay should be internally scrollable on small screens. Never push the main page or game board out of its current scroll position.

## Recent-player list

Keep the most recent 20 completed shared opponents per account. A recent player remains visible even if no friend request was sent. This supports the same “played with” discovery path as modern multiplayer lobbies without requiring users to remember a username.

Retention:

- Recent players: 30 days or 20 entries, whichever is smaller.
- Completed match records: account history policy, initially 90 days for guest-visible summaries and longer for account owners.
- User can clear their recent-player list.

## Friend request safety

- Exact username search is the primary path.
- In-room requests can be sent with one click from the action sheet.
- A request confirmation appears inline, not as a navigation.
- Duplicate requests are idempotent.
- Blocking cancels pending requests and hides the player.
- Rate limits protect both the recipient and the service.

## Notification behavior

- Normal friend request: recipient inbox/toast only.
- Room invite: recipient inbox/toast with `JOIN` and `DECLINE`.
- Mythical achievement unlock: server-wide generic announcement, as defined in the achievement plan.
- Normal achievement unlock: owner-only unless friend-feed sharing is enabled.

## Accessibility

- Player icons are native buttons with descriptive accessible names.
- Action sheets use a dialog label and a visible close button.
- Nested overlays restore focus in reverse order.
- Presence and privacy are communicated with text, not color alone.
- Async history loading uses a polite live region and a stable loading row.
- Keyboard users can reach every action without leaving the game shell.
- Touch targets meet the 24×24 minimum, with 44×44 preferred for primary actions.

## Architecture

Keep the authoritative match record in the existing server modular monolith. Build public projections for player cards and leaderboards. The client should request only the scope it is allowed to see.

Required read seams:

- `get-public-player-card`
- `get-match-history`
- `get-recent-players`
- `get-friends`

Required write seams:

- `send-friend-request`
- `respond-friend-request`
- `send-room-invite`
- `respond-room-invite`
- `block-player`
- `report-player`

## Verification

- Open every overlay during a player’s turn and confirm the timer and turn state do not change.
- Close nested overlays and confirm focus returns to the originating player icon.
- Verify private fields never appear in public history responses.
- Test blocked players, deleted accounts, expired rooms, full rooms, and disconnected recipients.
- Test the same player from the left rail, leaderboard, friend list, and recent-player list.
- Test keyboard, touch, narrow viewport, and screen-reader flows.
