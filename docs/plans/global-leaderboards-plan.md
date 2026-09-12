# Poorup Global Leaderboards

Status: implemented all-time, seasonal, 30-day/monthly, and friends-only
projections plus rebuildable recent trends. Seasonal standings and reward claims
are live; balance/integrity tuning remains follow-up work.

> **Current status (2026-09-12).** The live Rankings surface supports four
> scopes — `ALL TIME`, `THIS SEASON`, `30 DAYS`, and `FRIENDS` — and the Season
> panel exposes claimable rewards for signed-in players. The current metric
> registry has 15 server-backed IDs, including wins, rate, games, achievement
> score, mythical, events, auctions, rent, casino, market, player loans,
> equity, loan discipline, and Patrol. Evidence:
> `public/clientSocialSurfaces.js:541-560,603-627,698-707`,
> `server/serverSocketSocial.js:171-209`, and
> `docs/audit/expansion-implementation.md:17-20`.

## Product decision

Leaderboards should move out of the Profile editor. Profile remains the player’s identity, designs, achievements, and personal history. Rankings become a top-level social surface, alongside rooms and profile.

Recommended destination:

```text
Parlor
  ├─ Rooms
  ├─ Rankings
  ├─ Friends
  └─ Profile
```

The current shell exposes `RANKINGS` and `SOCIAL` as top-level destinations;
Friends lives inside the Social hub rather than in the Profile editor. On
smaller screens they may continue to share the same Social shell with tabs.

## Ranking boards

### Core boards

- Wins
- Win rate
- Games played
- Achievement score
- Mythical achievements
- Global-event survival
- Bank-loan discipline
- Auction wins
- Rent collected
- Parlor Patrol score

### Secondary boards

- Most properties owned in a finished game
- Highest ending cash
- Best comeback
- Most complete groups
- Most successful trades
- Most event combinations survived

Do not rank raw lifetime cash or total rent without context. Those metrics reward time played rather than skill and are easy to inflate.

## Time scopes

Every board supports:

- All time
- This season
- This month
- Friends only

Season resets archive previous results rather than deleting them. The current
release ships all-time, 30-day/monthly, season, and friends-only views;
seasonal standings and reward claims are already live.

## Ranking rules

### Wins

Sort by verified wins, then win rate, then games played as a tie-breaker.

### Win rate

Require a minimum number of completed games, initially 5, before appearing in the global board.

### Achievement score

Use rarity-weighted points:

```text
Common 10 · Uncommon 25 · Rare 50 · Epic 100 · Legendary 250 · Mythical 1000
```

Secret and Mythical achievements contribute points only after server verification.

### Games played

Count completed server games only. Aborted, reset, preview, and spectator sessions do not count.

### Parlor Patrol

Keep the existing personal-best score separate from the global board. A global score requires a signed run result and anti-tamper validation.

## Data model

```js
playerStats: {
  accountId,
  gamesPlayed,
  wins,
  winRate,
  achievementScore,
  mythicalCount,
  eventSurvivals,
  loanDefaults,
  auctionWins,
  rentCollected,
  bestEndingCash,
  bestComeback,
  patrolBest,
  updatedAt
}
```

Leaderboard rows are projections, not a second source of truth. Rebuildable stats should be derived from completed game results and verified achievement records.

## UI design

### Rankings landing page

- Heading: `GLOBAL RANKINGS`
- Compact scope switcher: `ALL TIME`, `THIS SEASON`, `30 DAYS`, `FRIENDS`
- Board selector chips: `WINS`, `RATE`, `ACHIEVEMENTS`, `EVENTS`, `PATROL`
- Search by exact username or player id, never by private email
- Player rows with rank, avatar, display name, value, and trend indicator
- Current player row remains visible when scrolled

### Player row

```text
03  [avatar]  VESPER       42 WINS       VIEW PLAYER
```

Clicking a row opens a public player card, not a private profile dump.

### Public player card

Show only:

- Display name and avatar
- Public achievements
- Wins, games, win rate
- Public event badges
- Mutual friends
- `ADD FRIEND`
- `INVITE TO ROOM`

Hide:

- Email, account id, private match details, hidden achievement conditions, exact cash history, and room codes.

## Empty and edge states

- No account: show local personal stats and explain that global ranking requires an account.
- Fewer than five games: show `PLACEMENT PENDING` for win rate.
- No friends: show a direct `FIND PLAYERS` action.
- Network failure: preserve the last verified snapshot with a timestamp and mark it stale.
- Ties: show equal rank and a stable secondary sort.

## Anti-abuse and integrity

- Only completed server games count.
- Do not accept client-submitted totals.
- Rate-limit profile and ranking queries.
- Rebuild suspicious accounts from event and game ledgers.
- Flag impossible scores instead of silently deleting them.
- Provide a report/block action on public player cards.

## Performance and operations

The first implementation can use the existing account store with indexed in-memory projections. If the player base grows, move only the leaderboard projection to a durable store; game authority remains in the current server.

Cache public board pages briefly, but never cache a private friend list or pending invitation without authorization checks.

## Rollout

1. Add public stats projection from completed games.
2. Add a standalone Rankings view and board selectors.
3. Add achievement score and Mythical count.
4. Add monthly scope and friend-only scope.
5. **Shipped:** add trends, seasons, and reward claims after integrity data was
   proven; continue tuning from verified match records.

## Success metrics

- Public ranking page loads without affecting turn latency.
- No private fields appear in public player cards.
- Every displayed score can be traced to verified server records.
- Ranking refreshes are stable under reconnects and duplicate requests.
