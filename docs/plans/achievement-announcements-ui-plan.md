# Poorup Achievement Announcements and Collection UI

Status: design proposal for the next achievement UI slice.

## Unlock announcement behavior

When a player unlocks an achievement, the server creates one verified unlock event. Ordinary achievements remain private to the owner; only Mythical achievements are announced globally.

### Mythical server channel

Only a Mythical unlock is broadcast server-wide to every currently connected player across every room, including players currently in a round, lobby, or spectator state:

```text
WAL unlocked a MYTHICAL ACHIEVEMENT
```

The Mythical title remains hidden from everyone except the owner until the owner intentionally reveals it. The server sees only the player name and `MYTHICAL ACHIEVEMENT`.

No global room notification is sent for Common, Uncommon, Rare, Epic, or Legendary achievements.

### Owner and social channel

The owner receives a persistent profile notification for every achievement, even when they are not currently in a round. Friends may receive a feed item if the owner’s privacy setting allows achievement sharing. This is separate from the Mythical room-wide announcement.

Required delivery states:

- Mythical in active round: server-wide announcement, owner toast, and event log entry.
- Ordinary achievement in active round: owner toast and private event log entry only.
- Mythical in lobby: server-wide announcement plus owner toast and lobby log entry.
- Ordinary achievement in lobby: owner toast and private lobby log entry only.
- On home/profile: owner toast plus unread profile badge, never a global room alert.
- Offline: owner notification is queued for the next account login; no global alert is replayed.

Server-wide delivery is limited to one announcement per verified Mythical unlock per account. It is not sent as an external push notification and does not reveal the hidden title.

The client never decides whether an unlock is valid. It renders a server-signed achievement event.

## Achievement event contract

```js
{
  id,
  playerId,
  playerDisplayName,
  rarity,
  secret: true,
  titleVisible: false,
  unlockedAt,
  gameId,
  eventSequence,
  evidenceHash
}
```

The event must be idempotent. Reconnects or duplicate socket delivery cannot produce duplicate toasts or duplicate unlock records.

## Mythical announcement treatment

Mythical unlocks receive a short glitch treatment:

- Cyan/magenta channel offset on the icon.
- One scanline flicker, under 300 ms.
- No screen shake and no blocking modal.
- Reduced-motion mode uses a static chromatic icon and text announcement.
- A short text-only announcement remains available to screen readers.

## Rarity targets

These are target percentages of active accounts that should eventually unlock an achievement, measured after the system has enough account history. They are balancing targets, not random draw probabilities.

| Rarity | Target unlock rate | Meaning |
|---|---:|---|
| Common | 50–70% | Most active players reach these naturally |
| Uncommon | 25–45% | Requires deliberate play |
| Rare | 8–20% | Strong timing, skill, or table conditions |
| Epic | 2–8% | Difficult multi-step or event mastery |
| Legendary | 0.5–2% | Exceptional or highly coordinated play |
| Mythical | 0.05–0.5% | Server-wide moment, intended to feel almost impossible |

Mythical achievements should be individually monitored. If one exceeds a 0.5% unlock rate, its condition is no longer mythical; if it stays below 0.01% after a large sample, add a clue or adjust the condition rather than relying on pure obscurity.

## The 41st Tile icon

The icon should be a literal pixelated `41`, not an abstract tile mark.

Design requirements:

- 32×32 pixel grid.
- Block-built `4` and `1` glyphs with a broken tile border.
- Cyan and magenta offset layers behind the cream foreground glyph.
- One missing pixel cluster where the tile boundary should be.
- No anti-aliasing, blur, or gradients.
- The accessible name remains `The 41st Tile`; the icon is decorative beside the text.

## Achievement collection layout

The profile achievement collection becomes a bounded internal scroll surface so the page itself does not become an endless scroll.

```text
Profile page
  └─ Achievement panel (bounded height)
      ├─ Header and progress
      ├─ One filter bar: category chips on the left, rarity/date controls on the right
      └─ Internal achievement grid scroll
```

Requirements:

- The panel has `max-height` based on the viewport and `overflow: auto`.
- The page body does not scroll while the pointer or keyboard focus is inside the grid.
- The grid has `min-height: 0` so flex layouts do not force page overflow.
- Keyboard focus uses `scroll-margin-block` to keep the focused card visible.
- On small screens, the grid becomes one or two columns inside the same bounded panel.
- A visible scrollbar is allowed, but the panel also supports wheel, touch, Page Up/Down, Home, and End.

## Unified filter bar

The category filters and metadata filters belong in the same horizontal bar.

Left side:

- All
- Tablecraft
- Global Events
- Social
- Secrets
- Patrol

Right side:

- When earned: All dates, last 7 days, last 30 days, newest, oldest
- Rarity: All, Common, Uncommon, Rare, Epic, Legendary, Mythical

Responsive behavior:

- Desktop: category chips left, compact labeled selects right.
- Tablet: controls wrap but remain one bar.
- Mobile: category row scrolls horizontally and metadata controls stay below it inside the same bar.

Do not rely on color alone for rarity. Keep the rarity word and a visible border/accent.

## Card states

- Locked visible achievement: muted icon, readable title, short clue.
- Locked secret: dimmed title, clue, and hidden condition.
- Unlocked: full-color icon, rarity accent, date available in the modal.
- Mythical: chromatic glitch icon, even when locked, with lower opacity.

Cards remain native buttons and open the detail dialog. No inline expansion returns.

## Accessibility and motion

- Every card has an accessible label containing title/status and “Open details.”
- Filters use native buttons and selects.
- The bounded grid is announced as `Achievement collection, 47 items`.
- New unlocks use an `aria-live="polite"` region.
- Toasts do not steal focus.
- Modal close restores focus to the originating card.
- Reduced motion removes flicker and keeps the announcement readable.

## Verification

- Unlock while in a round, lobby, home, and disconnected/reconnected state.
- Verify one announcement per unlock event.
- Verify Mythical titles remain hidden for other players.
- Verify the 41 glyph is crisp at 1× and 2×.
- Verify the page does not grow with 47 cards.
- Verify wheel, touch, keyboard, and screen-reader navigation inside the bounded grid.
