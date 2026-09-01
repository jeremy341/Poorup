# Poorup Board Sources

## Protected legacy copy

`public/assets/legacy-board-40.svg` was copied byte-for-byte from the pre-refactor
`playingfield-beige.svg` and is not used for the new visual artwork.

- SHA-256: `8BDA8E1C61DF178DF556FFCA9C8707AECFFC6E3E5DFD5AA601ECE8C5CD680C23`

`public/assets/legacy-board-40-user-source.svg` preserves the user-pasted 1180×1180
SVG source for comparison. Its SHA-256 is:

- `4429EB29145711A8AB7217B5681AF3847C56B30E639F7008F2E4A3A0BEB35227`

## Removed board references

The former generated, master, tilted, and source board SVGs were removed during
the asset cleanup. They were not runtime dependencies: the live HTML/CSS
renderer owns the 40-space board geometry and legacy names.

Removed files:

- `public/assets/playingfield-beige.svg`
- `public/assets/poorup_board_1to1_figma_master.svg`
- `public/assets/poorup_board_40.svg`
- `public/assets/poorup_board_40-source.svg`
- `public/assets/poorup_board_exact_tilted.svg`
- `.ulpi/design/supplied/poorup_base_equal_tile_sizes_chatgpt.svg`

The protected legacy copy must never be overwritten by generation or formatting steps.

## Current plain-client snapshot

The current delivery uses the archive's HTML/CSS/JavaScript board composition at
runtime (`public/index.html`, `public/main.js`, `public/styles.css`) with all 40
legacy spaces mapped into the 11×11 perimeter grid. Only the two protected legacy
copies above remain on disk for rollback and comparison.
