# Obsolete artifact review — 2026-09-17

## Evidence method

Runtime theme references were traced from `public/clientThemeData.js`,
`public/clientThemeRender.js`, `qa/theme.spec.js`, and the current asset audit.
The candidate paths below had no runtime reference; their only matches were
historical plan/audit prose describing a superseded six-world naming scheme.
The current runtime worlds remain `original`, `spring`, `summer`, `autumn`,
`winter`, and `light`.

## Approved removal set

### Stale legal/music plans and specs

These documents describe surfaces that were explicitly removed from the current
runtime (the visible music box and the old legal shell). They are not linked by
CI, code, or the current feature-status manifest:

- `docs/superpowers/plans/2026-09-14-legal-document-shell.md`
- `docs/superpowers/specs/2026-09-14-legal-document-shell-design.md`
- `docs/superpowers/plans/2026-09-14-music-box-reference-implementation.md`
- `docs/superpowers/specs/2026-09-14-music-box-reference-design.md` *(removed)*
- `docs/superpowers/plans/2026-09-14-theme-music-player.md` *(removed)*
- `docs/superpowers/specs/2026-09-14-theme-music-player-design.md`

### Unreferenced legacy theme artwork

The following complete asset directories are not loaded by the active theme
registry. They contain 30 historical SVGs in total:

- `public/assets/themes/midnight-ledger/`
- `public/assets/themes/clearline-day/`
- `public/assets/themes/bloom-district/`
- `public/assets/themes/golden-hour-exchange/`
- `public/assets/themes/rainy-copper-town/`
- `public/assets/themes/warm-window-snow-city/`

## Preserved intentionally

- All six active runtime theme directories and their props.
- `docs/audit/**`, `docs/decisions/**`, release runbooks, licenses, and
  provenance records.
- The partial `2026-09-16` bot/background-motion plan because its bot fallback
  and hidden-tab motion sections remain relevant.
- The 2026-09-10 theme plan as historical provenance for the current registry.
- `public/assets/board-icons/index.html` and its referenced vault artwork,
  because it is an explicit asset gallery rather than dead runtime code.

Removal is limited to the exact paths above; no wildcard or recursive cleanup is
performed outside those directories.

## Execution result

The 30 SVG files in the six legacy directories were removed after a final
runtime-reference check. The directories themselves are left as empty
filesystem placeholders (Git does not track empty directories). The six stale
Markdown candidates were split safely: the two unchanged music documents above
were removed; the four remaining legal/music documents carry uncommitted user
edits and remain recoverable deletion candidates until those changes are
explicitly backed up and approved.
