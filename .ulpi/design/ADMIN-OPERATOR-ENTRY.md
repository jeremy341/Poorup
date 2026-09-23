# Admin operator entry (Account & Preferences)

## Design read

Reading this as: Operate-mode identity desk control for allow-listed operators,
with Poorup's locked late-night arcade language, not a public marketing CTA.

Direction: **After-hours operator desk strip** inside Account & Preferences.
DFII: **13/15**.

## Placement

Signed-in Account panel only, below Data Rights. Hidden for guests and
non-admin accounts. One secondary `btn-dark` control: **OPEN OPERATOR CONSOLE**.

## Behavior

- Visible when owner session payload includes `isAdmin: true`.
- Navigates to `/admin/analytics` (existing path-gated console).
- Server remain authoritative; UI flag is convenience only.

## Visual bind to DESIGN.md

- Deep panel surface, square corners, gold left rule, `ADMIN` micro badge.
- Existing Pixelify / mono stacks; no new fonts or purple accents.
- Motion: 120ms ease-out hover/press; press uses `scale(0.97)` + 1px settle.
- Reduced motion collapses transform feedback.

## Accessibility

Native button, 44px min height, visible focus via shared `.btn-dark`, labelled
section heading, no decorative animation required for comprehension.
