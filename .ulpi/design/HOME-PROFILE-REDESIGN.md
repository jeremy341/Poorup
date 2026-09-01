# Poorup Home + Profile Desktop Redesign

Status: plan locked for implementation review  
Scope: home surface, profile surface, and account/profile presentation only  
Out of scope: lobby, board, gameplay HUD, Socket.IO game events, and room rules

## Job and audience

Poorup is entered during game night by friends who want to start or resume a
table quickly. The home surface must answer two questions immediately: “How do
I get into a room?” and “Who am I bringing to the table?” The profile surface
is the identity desk for a guest or account holder who wants to manage their
display name, pixel face, token color, saved designs, and truthful game record.

## Evidence and baseline

The current implementation was inspected in the local browser at exact desktop
viewports. There is no document overflow at either size, but the composition is
not using the available space intentionally.

| Surface | 1920 x 1080 | 2560 x 1440 | Finding |
| --- | --- | --- | --- |
| Home stage | 1892 x 933 | 2212 x 1293 | Stage fills the viewport, while useful content remains clustered near the top-left. |
| Home entry column | 1030px grid track, roughly 480px of actual content | 1214px grid track, roughly 480px of actual content | A large empty gap is created by a wide track and narrow child controls. |
| Home mini-board | 360 x 360 | 360 x 360 | Visual signature is capped and does not scale with the desktop stage. |
| Profile main | 1100px | 1100px | Large unused side margins; the editor reads like a small centered form instead of a profile destination. |

The homepage also presents several equal-weight entry choices in one cluster:
Create Room, Browse Rooms, Quick Table, Profiles, and Join. The profile route
currently stacks account, designs, identity, and face editing vertically. This
is functionally complete but lacks a summary, wayfinding, and a truthful stats
context.

## Reference synthesis

RichUp is useful as an information-architecture reference, not as a visual
source. Its public profile puts the identity header beside key reputation and
win-rate measures, then groups Statistics, Inventory, and Last games into
scannable sections. Its statistics article explains that profile history is a
way to understand games played, wins, and prior rules, while private-game
history is restricted to participants. See [RichUp profile](https://richup.io/profile/6261d8c961cbff8d9d63e718),
[user statistics](https://blog.richup.io/getting-to-know-user-statistics/), and
[game-history update](https://blog.richup.io/richup-v1-12/).

Poorup will borrow the sequence, not the purple palette, typography, or
commercial features:

- identity first: avatar, display name, stable username/account state;
- a compact stat rail with only server-backed values;
- tabbed detail instead of one long editor stack;
- explicit empty states for history, inventory, friends, or other data that do
  not exist yet.

RichUp also documents friends, invites, and blocks as a distinct social system.
That is useful future product evidence, but Poorup will not show fake friends or
inventory until those data contracts exist. See [friendships and blocks](https://blog.richup.io/richup-v1-15-friendships-and-blocks/).

## Selected direction: Terminal Parlor Ledger

The home and profile surfaces stay inside the established After-hours Game
Parlor world: canvas `#01070A`, teal board surfaces, warm gold structure,
Pixelify Sans display, IBM Plex Mono data, 2–3px radii, and restrained red
actions. The profile is a ledger, not a social feed. It should feel like a
player card pulled from the same tabletop system as the board.

Design quality bar:

- Distinctive but legible pixel-terminal character; no generic dashboard,
  glass cards, gradient text, pill-heavy navigation, or emoji controls.
- DFII target: 14/15. The signature is the “player card to table” transition:
  the identity header and stat rail visually echo the home open-chair and game
  player row without copying the game HUD.
- One authored transition only: switching a home/profile tab changes the active
  ledger pane with a short opacity/translate reveal. Controls themselves use
  immediate press feedback.

Homepage composition lock: **Parlor Desk**. The board is removed from the home
surface. The left field carries the Poorup statement and skyline atmosphere,
while one contained right-hand desk owns Create, Join, Quick Table, live status,
and the open-chair identity flow. The board remains the visual anchor inside the
live game. This is the selected board-free variation; the profile route and
game surfaces remain outside this composition change.

## Home information architecture

Keep the current home route and its account-free promise, but turn the stage
into a deliberate two-zone composition.

### Header

- Keep Poorup mark, connection state, identity chip, and sound control.
- Add a compact native navigation group: `PLAY`, `ROOMS`, `PROFILE`.
- `PLAY` is the default state. `ROOMS` opens the existing server-backed room
  directory in a home surface or drawer. `PROFILE` opens the profile view.
- Do not duplicate Create/Browse actions in both header and hero.

### Play tab

- Left zone: one headline, one factual subhead, required guest alias field when
  needed, and a single dominant `Create Room` action.
- Secondary action: `Join Existing Room` with code input and inline error state.
- Tertiary action: `Quick Table` stays available in the create path but is not
  styled as a peer to the primary action.
- Keep the open-chair identity summary, but move profile management behind the
  identity chip or a small `Edit identity` link so it does not compete with
  room entry.
- Right zone: scale the mini-board and skyline as a visual signature. It may
  grow from roughly 440px at 1920px to roughly 620px at 2560px, constrained by
  available height and the established board ratio.
- Keep the three factual product signals (account-free entry, real-time sync,
  40 spaces) but present them as a compact support line below the visual, not as
  three equal dashboard cards.

### Rooms tab

- Reuse the existing server-backed `list-rooms` flow and filters.
- Show authoritative room name, visibility, seat count, state, and join action.
- Empty state copy: `NO PUBLIC TABLES RIGHT NOW. HOST ONE OR ENTER A CODE.`
- Never render static rooms, fake counts, uptime, latency, or “local table”
  claims.
- Keep private room codes out of the public directory.

### Profile tab shortcut

The header shortcut navigates to `#view-profile` and restores the previous home
tab on return. It must not open a modal for the main profile task.

## Profile information architecture

Replace the current long stack with a profile shell that keeps all existing
features while making the profile readable at desktop scale.

### Profile header

Full-width within the desktop profile stage:

- pixel avatar / face preview;
- display name as the primary label;
- stable `@username` for signed-in accounts, or a clear `GUEST MODE` state;
- account action (`Create account`, `Sign in`, or `Sign out`);
- stat rail: `Games`, `Wins`, `Win rate`, and `Bankruptcies` only when the
  server supplies the value;
- joined date for accounts, sourced from `createdAt` and omitted for guests.

No invented karma, friends, inventory, streaks, or rank values. A zero is a
truthful zero; unavailable data gets an honest empty state.

### Tabs

Use native buttons with `role="tablist"`, `role="tab"`, `aria-selected`, and
`aria-controls`. Arrow keys, Home, and End move between tabs.

1. **Overview**
   - identity summary, account state, factual stats, and a concise “how this
     identity appears in a room” preview;
   - the primary `Edit player design` action leads to Designs.
2. **Player designs**
   - preserve the saved profile library, select/edit/delete actions, display
     name, token color, live preview, 8x8 face painter, ink palette, eraser,
     clear, and default-face controls;
   - editing remains inline in the tab, not in a blocking modal.
3. **History**
   - render completed games only when the account contract contains history;
   - show winner, finish date, player count, and duration when supplied;
   - show `NO COMPLETED ROUNDS YET. YOUR FIRST FINISH WILL APPEAR HERE.` when
     empty;
   - private game history is visible only to participants, matching the source
     product’s privacy rule.
4. **Account & preferences**
   - username, display-name sync state, sign-in/out, guest explanation, sound
     preference, and a clear session-expired recovery path;
   - password fields remain inside the existing auth dialog and never appear in
     the profile body or chat.

Friends, inventory, store, blocks, public profile URLs, OAuth, password reset,
and email verification stay deferred. They need separate product, privacy, and
backend decisions.

## Data and architecture boundary

- Keep Express, Socket.IO, the vanilla client, and all lobby/game event names
  unchanged.
- `server/accountStore.js` remains the owner of account identity, profile
  fields, sessions, stats, and optional completed-game summaries.
- If History is implemented, extend the existing game-result write path with a
  bounded, sanitized history array. Do not expose private-room history to users
  who were not participants. This is an account-data addition, not a game-rule
  change.
- `public/main.js` gets a small `profileViewState` (active tab, return route,
  edit mode) and pure render functions for header, tabs, overview, designs,
  history, and account. Existing profile IDs remain available as compatibility
  hooks until each panel is migrated.
- The room directory stays server-backed. Home tab state is client-only and
  must not be mistaken for game state.

## Motion and interaction contract

- Tab switch: 140–180ms ease-out, opacity plus a 6–10px transform only.
- Home stage entry: one short, already-visible reveal for the hero and mini-board;
  no staggered card cascade.
- Button press: 60–120ms stepped/ease-out feedback.
- No `transition: all`, layout-property animation, ungated hover travel,
  infinite decorative blinking, or keyboard-triggered travel.
- Under `prefers-reduced-motion`, remove travel, stagger, and decorative motion;
  preserve active-tab and pressed-state feedback.
- Profile edits update the preview immediately, then persist through the existing
  save path. Account state changes announce once through the shared system live
  region; chat remains separate.

## Accessibility and responsive contract

- Native controls for tabs, actions, swatches, profile cards, and forms.
- Visible `:focus-visible` treatment, 44px preferred targets, and color-
  independent selected/current states.
- Tab semantics and keyboard order remain logical at 200% zoom.
- Existing modal controller continues to own auth-dialog focus capture,
  Escape, restoration, and inert background handling.
- Home and profile content must have no horizontal overflow at 1920x1080 or
  2560x1440. Desktop layout is the target; the existing compact mobile fallback
  remains functional and is not redesigned here.
- Profile body copy stays within roughly 65–75ch. Stat numerals use tabular
  figures. Empty, loading, error, signed-out, signed-in, and session-expired
  states are all labelled.

## Implementation sequence

1. Add the tab/state contract and stable semantic hooks without changing the
   lobby or game DOM.
2. Refactor the home stage grid so the useful content and mini-board scale from
   available viewport width/height instead of leaving a narrow content island.
3. Build the profile shell header and tablist, then move existing account,
   library, identity, and face-editor markup into tab panels with compatibility
   IDs.
4. Add truthful overview stat formatting and the history empty state. Add
   bounded server history only if the current account response can support it
   without changing game protocol.
5. Wire keyboard tabs, focus restoration, live announcements, and reduced-motion
   behavior.
6. Run the mechanical detector and one batched visual correction pass, then a
   single confirmation pass at both required viewports.

## Acceptance criteria

- Home has one dominant Create action, one clear Join path, and Quick Table is
  visibly tertiary.
- Rooms and profile are discoverable as separate home destinations without
  duplicating primary actions.
- At 1920x1080 and 2560x1440, the home stage uses the viewport deliberately,
  the mini-board scales, and no large empty content island remains.
- Profile reads as a full desktop destination with identity header, factual
  stat rail, native tabs, and no unnecessary empty side margins.
- All existing profile features still work: guest mode, register, sign in,
  sign out, display-name save, color selection, face painting, clear/default,
  profile select/edit/delete, and account sync.
- No lobby or gameplay visuals, rules, indexes, events, or payloads change.
- No fake stats, fake rooms, fake latency, fake uptime, or unowned inventory is
  shown.
- `node --check`, `git diff --check`, keyboard/focus checks, reduced-motion,
  forced-colors, Axe, Impeccable, Web Interface Guidelines, critique, and
  frontend-review gates pass with no unresolved critical or major findings.

## Skill workflow

The implementation will use the local skills in this order:

1. `frontend-design-ui-ux` for this locked surface brief and information
   architecture.
2. `frontend-design`, `design-taste-frontend`, and both `impeccable` variants
   for the established anti-slop visual language and craft floor.
3. `game-ui-ux` for desktop scaling, state-stack boundaries, and event-driven
   profile/home updates without touching the game HUD.
4. `copywriting` and `cro` for factual, low-friction home entry and empty/error
   language.
5. `kpi-dashboard-design` for selecting a small, truthful, contextual stat
   rail instead of vanity metrics.
6. `pixel-art-sprites` for avatar and pixel rendering consistency.
7. `accessibility`, `mobile-responsiveness`, and `web-design-guidelines` for
   WCAG, zoom, forced-colors, and desktop breakpoint review.
8. `animate`, `emilkowal-animations`, `improve-animations`, and
   `review-animations` for the single authored transition, interruption, and
   reduced-motion audit.
9. `systematic-debugging`, `code-architecture-review`, and
   `software-architecture-design` for tracing home/profile state boundaries and
   keeping account data separate from authoritative game state.
10. `critique` and `frontend-design-review` for the final visual and trust pass.
11. `find-skills` was used to check the catalog. Search also surfaced external
   `ui-ux-pro-max`, `frontend-ui`, and `frontend-ui-animator` skills, but they
   were not installed because the local catalog already provides overlapping,
   higher-confidence guidance and the package manager cache has no network
   access in this environment.

## Verification matrix

For each viewport, capture Home Play, Home Rooms, Home Profile, Profile
Overview, Player designs, History empty, Account & preferences, auth dialog,
and all relevant error/session states.

| Check | 1920x1080 | 2560x1440 |
| --- | --- | --- |
| No horizontal/vertical overflow | required | required |
| Home stage uses available width/height | required | required |
| Mini-board preserves ratio and scales | required | required |
| Profile header/stat rail/tabs remain readable | required | required |
| Primary action and focus ring visible | required | required |
| 200% zoom and forced colors | required | required |
| Reduced motion and console clean | required | required |

Final browser review is one batched screenshot round plus one confirmation
round. The Impeccable detector runs once on the changed HTML/CSS targets after
implementation; its findings, Axe output, and the motion-review verdict are
attached to the final handoff.
