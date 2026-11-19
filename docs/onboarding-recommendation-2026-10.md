# Onboarding recommendation (October 2026)

## Short answer

Yes, Poorup needs onboarding, but a small version. Do not build a long tour.
The problem is not that the rules are hidden. The rules page has 21 chapters,
and most new players never open it. They sit down at a table with a lobby of
switches and their first purchase prompt arrives before they know what a deed
or a color group is.

Recommended order:

1. Contextual tips at the first decision of each kind (buy, auction, card, debt).
2. A skippable guided first game with a fixed Standard setup.
3. Keep the rules page as the reference, and link to it from the tips.

Do not add a modal tour that runs on every visit.

## Why this shape

- The server already tells the player the next legal action. Tips can ride on
  those same prompts, so the tip appears exactly when the player must decide.
  Nothing new needs to be modeled.
- Most confusion comes from a handful of moments: the first purchase prompt,
  the first auction, the first card, and the first time money runs short. A
  tip at each moment covers more than a general tour.
- Optional systems (player finance, casino, market, bank accounts, global
  events) are the main source of complexity. A first-game mode should keep
  them off, which the Standard preset already does.
- A tour repeated on every visit is annoying for returning players and rarely
  read. A tip shown once per kind of decision, then dismissed for good, is
  cheaper and easier to test.

## Proposed structure

### 1. Contextual tips (ship first)

- One short tip per decision kind, shown the first time the player meets it:
  - Purchase: "Buy this deed to collect rent when others land here. Pass to send it to auction."
  - Auction: "Each bid resets a 5-second timer. The highest bid when it runs out wins."
  - Card: "Surprise and Treasure cards take effect at once. Read the result in the log."
  - Debt: "You can't end your turn while you owe money. Sell, mortgage, or trade to pay."
- Each tip has a "Got it" button and a link to the matching rules chapter
  (`openRulesSurface` already takes a section id).
- Stored per player, in the account profile, not in browser storage alone, so the
  tips do not return on another device.
- Tips never block the action. They sit beside the decision.

### 2. Guided first game (ship second)

- Offered once, from the lobby, as "Learn to play" with a Skip button.
- Fixed setup: Standard 40, two to four players, bots fill the rest, every
  optional system off, Auction on, Trading on.
- The guide highlights, in order: roll, land, buy, rent, build, end turn. Each
  step waits for the player's real action. It does not fake turns.
- At the end it shows the three things that decide a game: rent from groups,
  building evenly, and not running out of cash.

### 3. Lobby clarity (small, ship with step 2)

- Show a one-line summary of the active rules at the top of the lobby, such as
  "Standard: classic game, no optional systems", so the host sees what the
  switches mean before changing them.

## What not to build

- A full-screen tour on the first visit only. It is skipped and then forgotten.
- Explaining every optional system during onboarding. Teach the classic game
  first. Optional systems get their own rules chapter and a lobby tooltip.
- New server state for each tip beyond a set of seen kinds per player.

## How to know it worked

Measure, do not guess:

- Share of new players who finish round 3 (a fair proxy for staying past the
  confusing start).
- Share who open a rules chapter in their first game, and which chapter.
- Share of first-game purchases that are passed without a decision (a sign
  they did not understand what a purchase means).
- Share of bankruptcies in a player's first three games.

Compare before and after each step. If the tips do not move the first-game
numbers, stop before building the guided game.

## Open questions for the owner

- Should the guided game count toward stats and achievements, or stay separate?
- Is a "reset tips" control needed in settings for testers?
- Does the lobby summary need a translation plan, or is English enough for now?
