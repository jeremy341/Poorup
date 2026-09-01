# Poorup Friends and Player Social System

Status: design proposal.

## Product decision

Friends and player interactions belong in a top-level `SOCIAL` hub, not inside the profile editor. The profile remains the identity page; the social hub owns relationships, invitations, and public player cards.

Recommended information architecture:

```text
SOCIAL
  ├─ Friends
  ├─ Requests
  ├─ Room Invites
  └─ Find Players
```

The same public player card is reachable from Rankings, Friends, room player rows, and the in-game player list.

This follows the useful pattern in Fortnite’s sidebar: social, add-friend, and recent-player actions are exposed from the active session rather than forcing a player to exit to a separate menu. Fortnite’s official documentation describes friend invites, recent players, friend suggestions, and social controls in that sidebar. [Fortnite sidebar documentation](https://dev.epicgames.com/documentation/en-us/fortnite/exploring-the-sidebar-and-game-menu-in-fortnite-creative)

League’s companion experience also separates personal profile information from social communication and match history. Poorup should use the same separation: profile for identity, a social hub for relationships, and match history for public game records. [Riot Mobile features](https://support-leagueoflegends.riotgames.com/hc/en-us/articles/4407680309395-Riot-Mobile-Features)

## In-game player interaction

Clicking a player icon in the left rail opens a compact player action sheet with:

- Display name and avatar
- Online status
- Mutual friends
- `VIEW PLAYER`
- `ADD FRIEND` or `FRIENDS`
- `INVITE TO ROOM`
- `VIEW MATCH HISTORY`
- `BLOCK` and `REPORT`

The action sheet is an overlay inside the current game view. It must never navigate away from the room, reset the board, or close the player’s turn context.

Do not show private cash, hidden achievements, private room codes, or account metadata in this surface.

The action sheet should be a native, keyboard-accessible control surface. On desktop it can anchor beside the player row; on mobile it becomes a bottom sheet.

## Friend lifecycle

```text
NONE → REQUESTED → ACCEPTED
       ↘ DECLINED
       ↘ BLOCKED
```

Rules:

- A friend request is idempotent.
- Duplicate requests collapse into one pending request.
- Either player can remove a friendship.
- Blocking immediately removes the friendship and cancels pending invitations.
- A declined request can be sent again after a cooldown.
- Guest players can use in-room actions, but persistent friendships require an account.

## Room invitations

`INVITE TO ROOM` should work in two contexts:

1. Current private room: send a direct invitation to an accepted friend.
2. Public room: send a join notification that opens the room directory entry.

Private-room invitations must not expose the room code in public feeds. The server delivers a signed invitation containing an internal room reference; the UI presents `JOIN ROOM` or `DECLINE`.

Invitation rules:

- Only room members with permission can invite.
- Room capacity and game phase are checked at acceptance time.
- Expired, full, or already-started rooms show a clear failure message.
- No automatic join on notification click.
- Rate-limit invitations per sender and recipient.

## Match history

The public match-history view shows aggregate, non-sensitive records:

- Games played together
- Wins and losses against each other
- Recent shared games, with date and result
- Shared global events experienced
- Trades completed together

It must not show:

- Private chat
- Exact cash balances
- Hidden achievement conditions
- Room codes
- Unlisted participants’ private stats

Players can hide match history with a privacy preference. Friends-only history is the default; public history is opt-in.

Match history should be opened as an in-place panel or dialog from the action sheet. Returning closes only that overlay and restores focus to the player row. A separate route may exist later for deep history, but the first release must work entirely inside the current lobby/game shell.

## Social hub UI

### Friends list

Rows include:

- Avatar
- Display name
- Online, in lobby, in game, or offline state
- Mutual-friend count
- `VIEW` and overflow actions

### Requests

- Incoming requests with `ACCEPT`, `DECLINE`, and `BLOCK`.
- Outgoing requests with `CANCEL`.
- Empty state with exact-username search.

### Room invites

- Pending invitations with room name, public/private state, seats, and expiration.
- `JOIN` validates the room again before entering.

### Find players

- Exact username search first.
- Ranking and recent-opponent entry points second.
- Search results show only public display data.

### In-session social drawer

The game shell gets a persistent social trigger in the player rail. It opens a non-destructive drawer with:

- Friends currently online.
- Players in this room.
- Recent players from the last completed games.
- Pending requests and room invites.

The drawer uses the same focus-stack behavior as existing Poorup overlays. It does not change turn state, pause timers, or navigate to Profile.

## Data model

```js
friendship: {
  id,
  requesterId,
  addresseeId,
  status,              // requested | accepted | declined | blocked
  createdAt,
  updatedAt
}

roomInvite: {
  id,
  roomId,
  senderId,
  recipientId,
  status,              // pending | accepted | declined | expired | canceled
  expiresAt,
  createdAt
}
```

Never use display names as relationship keys. Use account ids and enforce authorization on every read and write.

## Server events

Proposed events:

- `send-friend-request`
- `respond-friend-request`
- `remove-friend`
- `block-player`
- `send-room-invite`
- `respond-room-invite`
- `get-public-player-card`
- `get-match-history`

Every handler returns an idempotency-safe result and broadcasts only to authorized recipients.

## Notifications

Use one notification center for:

- Owner achievement unlocks, with server-wide announcements reserved for Mythical achievements
- Friend requests
- Accepted/declined requests
- Room invitations
- Room capacity or expiration updates

Notifications are non-blocking and support:

- In-game toast
- Lobby toast
- Home/profile unread badge
- Offline queue for signed-in users

Sensitive content is never placed in a browser push payload by default.

## Privacy and safety

Settings:

- Who can send friend requests: Everyone / Friends of friends / Nobody
- Who can invite me: Friends / Friends of friends / Nobody
- Match history: Friends / Nobody / Public
- Achievement announcements: Room only / Friends / Private

Safety controls:

- Block and report are always available from the player card.
- Blocking hides the player from search and cancels invitations.
- Reports create a moderation record without revealing the reporter.
- Rate-limit search, requests, invites, and notifications.
- Never expose email addresses or stable account ids to clients.

## Architecture

Keep the first version in the existing server modular monolith:

- `SocialStore` owns friendships, blocks, invitations, and privacy preferences.
- `AccountStore` remains the source for identity and completed-game history.
- `RoomManager` only verifies room membership and capacity.
- Socket handlers authorize and call the stores; clients render responses.

Do not introduce a separate social service until relationship volume or independent ownership requires it.

## Rollout

1. Add public player cards and in-game action sheet with read-only stats.
2. Add friend requests, accept/decline, and blocking.
3. Add direct room invitations.
4. Add friends-only match history.
5. Add notification center and offline delivery.
6. Add Rankings integration and mutual-friend context.

## Verification

- Duplicate request and invite tests.
- Blocked-user visibility tests.
- Room-full and room-started acceptance races.
- Permission tests for every player-card and history field.
- Reconnect and offline notification tests.
- Keyboard, touch, focus, and screen-reader flows for the action sheet.
- Abuse tests for request and invitation rate limits.
