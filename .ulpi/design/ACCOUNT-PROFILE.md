# Poorup Optional Account + Profile Surface

## Design read

Keep the homepage as the account-free entry point. The profile view is the
identity desk: a player can stay a guest, or attach a durable username,
display name, pixel face, color, and server-recorded game history.

Direction: **After-hours identity desk** — terminal utility, warm gold
structure, dark teal surfaces, and one focused account decision at a time.
DFII: **14/15**.

## Reference DNA

- RichUp keeps play and room entry primary, with profiles as a secondary
  identity layer.
- RichUp profiles expose reputation/statistics, inventory, and game history;
  Poorup starts with truthful games/wins/win-rate values and leaves inventory,
  friends, and blocks for a later bounded feature.
- Account creation remains optional so Poorup's no-account promise survives.

## States and flows

1. Guest opens Profile from the existing home identity chip.
2. A guest sets a required homepage alias before creating, joining, or using
   Quick Table; signed-in users use their account display name automatically.
3. Guest can continue editing a local profile, create an account, or sign in.
4. Create requires a unique 3–16 character username, display name, and an
   8–72 character password. Sign in requires username and password.
5. Success stores a session token locally, binds the account to future room
   joins, and shows server-backed statistics.
6. Profile saves update the local face library and the account profile when
   signed in. Logout returns to guest mode without deleting local designs.
7. Expired sessions fail closed and return to guest mode with an actionable
   message.

## Component rules

- Account panel: one guest/signed-in state, concise identity summary, and
  three factual stat cells (games, wins, win rate).
- Auth dialog: native labelled inputs, create/sign-in tabs, inline errors,
  focus trapping, Escape, restoration, inert background, and no password
  echoing in chat or logs.
- Identity editor: existing display name, color, and 8×8 face editor remain
  the visual source of truth. Username is stable and read-only after account
  creation.
- The homepage layout and primary entry actions do not change.

## Runtime boundary

`server/accountStore.js` owns account persistence, password hashing, sessions,
profile updates, and stats. `server/server.js` owns Socket.IO presentation and
room binding. `server/gameLogic.js` stores only the non-secret account ID on a
player. Guests continue through the existing client-ID path.

## Accessibility and motion

- Native controls, visible focus, `autocomplete` hints, labelled dialogs,
  polite status and assertive error announcements.
- Account dialog uses the shared surface controller; background content is
  inert while it is open.
- No new decorative motion. Existing stepped panel transitions and reduced
  motion rules remain authoritative.

## Deferred scope

OAuth providers, email verification, password reset, friends, blocks,
inventory/cosmetics, and public profile URLs require separate product and
privacy decisions. They are not implied by this local account MVP.
