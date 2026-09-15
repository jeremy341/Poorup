# Poorup Legal Document Shell — Design Specification

**Status:** Approved direction, implementation may proceed as a clearly labelled draft

**Goal:** Replace the placeholder legal pages with a coherent, accessible document system that keeps the Poorup chrome while making every policy readable at desktop, iPad landscape, and mobile widths.

## Non-negotiable constraints

- Preserve the existing Poorup visual language: Pixelify/Jersey/Silkscreen typography, dark teal surfaces, gold rules, square geometry, scanlines, and focus treatment.
- Do not change the Home, lobby, game board, HUD, rails, navigation, gameplay, Socket.IO contracts, or economy.
- Legal pages remain same-origin and work with JavaScript disabled.
- The current footer ticker rhythm remains intact.
- No fabricated operator name, postal address, email address, retention period, legal basis, jurisdiction, age threshold, processor, or licensing claim.
- Until the owner supplies those facts, every policy page must show `DRAFT — NOT EFFECTIVE` and an explicit fact-review notice.
- No external legal copy is copied. References inform information architecture only.

## Information architecture

### Legal hub — `/legal`

The hub is a directory, not a wall of text. It contains:

- title, scope summary, draft status, version slot, and last-updated slot;
- document cards for Terms, Privacy, Acceptable Use, Support, Licenses, Accessibility, Storage/Telemetry, and AI/Bot Disclosure;
- a short “what belongs where” explanation;
- a contact block whose values remain visibly pending until supplied;
- links that preserve the existing `/privacy`, `/terms`, `/support`, `/licenses`, and `/acceptable-use` routes.

### Policy pages

Each page uses the same document contract:

1. document kicker and title;
2. draft/effective status, version, last updated;
3. plain-language summary;
4. in-page “On this page” navigation;
5. numbered sections with stable anchors;
6. related-document links;
7. return-to-parlor link.

### Required content sections

#### Terms

- Agreement and scope
- Eligibility and age gate (fact slot)
- Guest play and accounts
- How a round works and server authority
- Fictional currency and no cash value
- No real-money gambling or cash-out
- User content, chat, avatars, and names
- Bots and optional external AI
- Fair play and prohibited interference
- Availability, maintenance, and unfinished features
- Suspension and termination
- Intellectual-property permissions
- Disclaimers and liability (counsel slot)
- Changes and notice
- Governing law and disputes (jurisdiction slot)
- Contact

#### Privacy

- Controller/operator identity (fact slot)
- Scope and definitions
- Account, guest, gameplay, social, technical, support, telemetry, and AI data categories
- Sources and purposes
- Legal bases (fact slot)
- Public profiles, rankings, and match-history visibility
- Analytics aggregation, pseudonymisation, and k-anonymity suppression
- Hosting, Socket.IO, analytics, and AI processors
- Retention and deletion (fact slot)
- International transfers (fact slot)
- Security
- Access, correction, deletion, export, objection, and restriction requests
- Children and age handling
- Changes and contact/complaints

#### Acceptable Use

- Cheating, tampering, automation outside supported bots, scraping, and exploit disclosure
- Harassment, hate, threats, impersonation, spam, and illegal content
- Reporting, moderation, suspension, and appeal
- Security-reporting path

#### Support

- How to report a gameplay bug
- How to report a security issue without publishing an exploit
- Account recovery and session problems
- Data requests and privacy contact
- Service status and maintenance communication
- Accessibility feedback

#### Licenses

- Runtime fonts
- Audio and music
- SVG/pixel-art assets
- Open-source dependencies
- Attribution and source links
- Unknown or unapproved provenance must be labelled before release

#### Accessibility

- Supported keyboard and screen-reader patterns
- Focus and skip-link behavior
- Reduced motion and forced-colors behavior
- Contrast and touch-target commitments
- Known limitations and feedback contact

#### Storage/Telemetry and AI disclosure

These remain separate notices so the Privacy page stays understandable:

- Cookies versus `localStorage`/`sessionStorage`;
- theme, audio, guest-session, and gameplay-preference storage;
- aggregate telemetry and suppression rules;
- external AI provider, data sent, retention/training posture, and fallback behavior.

## Layout contract

### Shared shell

- `.legal-shell` is a column flex container with the existing Poorup header height and ticker footer.
- The header uses the Poorup mark, a static `LEGAL DESK` breadcrumb, and a single `BACK TO PARLOR` link. It does not show fake online state, player identity, audio toggles, or game actions.
- The footer reuses the existing ticker classes and legal links.

### Desktop and iPad landscape

- Hero metadata sits above the document body.
- The document body is a two-column spread: a 220–280px outline and a readable article column capped at roughly 72ch.
- The outline is sticky within the document viewport and highlights the current anchor without animated layout changes.
- The article scrolls vertically; no horizontal page overflow is permitted.
- All interactive controls are at least 44px high.

### Mobile

- The outline becomes a native `<details>` disclosure labelled `ON THIS PAGE`.
- The document uses normal page scrolling so browser find, text zoom, and assistive technology remain predictable.
- Headings and callouts wrap without truncation; no legal content is hidden behind hover.

### Visual treatment

- Use existing `.panel`, `.noise`, `.section-title`, `.t-label`, `.t-body`, and token roles.
- Use one draft-warning panel, not warning color on every paragraph.
- Tables are reserved for facts, rights, data categories, or version history.
- No glass, gradients, giant marketing cards, emoji, or decorative SVG controls.

## Accessibility and motion

- One `h1` per page, ordered `h2`/`h3` sections, and a skip link to the article.
- `aria-current="page"` for the active footer route and `aria-expanded` on the mobile outline.
- Anchor navigation focuses the section heading and uses `scroll-margin-top`.
- Escape is not required for a static document; link activation is keyboard-native.
- Page entry uses only a short opacity/translate transition and is disabled under reduced motion.
- Print styles remove scanlines, draft chrome, and navigation clutter while keeping all text.

## Reference DNA

- GitHub presents a short, plain-language summary before detailed terms and definitions.
- Vercel exposes a legal index with many distinct policies and visible update dates.
- Mozilla states scope, effective date, data sources, and minimisation in direct language.
- GOV.UK orders privacy content around controller, data, purposes, sharing, retention, rights, complaints, and changes.

These are structural references only; no wording is copied.

## Acceptance criteria

- Every route renders the shared shell with JavaScript disabled.
- Every page has complete draft copy for the sections above, with no `COPY INJECTION` tokens remaining.
- The draft state is unmistakable and cannot be mistaken for effective legal advice.
- `/acceptable-use` remains backward-compatible while exposing a real document section.
- Desktop 1920×1080, iPad landscape, and 390×844 have no horizontal overflow or clipped text.
- Keyboard, skip links, section anchors, 200% zoom, forced colors, reduced motion, and print output are covered by tests.
