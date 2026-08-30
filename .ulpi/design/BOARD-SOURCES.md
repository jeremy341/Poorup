# Poorup Board Sources

## Protected legacy copy

`public/assets/legacy-board-40.svg` is a byte-for-byte copy of the pre-refactor
`public/assets/playingfield-beige.svg` and is not used for the new visual artwork.

- SHA-256: `8BDA8E1C61DF178DF556FFCA9C8707AECFFC6E3E5DFD5AA601ECE8C5CD680C23`

`public/assets/legacy-board-40-user-source.svg` preserves the user-pasted 1180×1180
SVG source for comparison. Its SHA-256 is:

- `4429EB29145711A8AB7217B5681AF3847C56B30E639F7008F2E4A3A0BEB35227`

## Runtime board

The current visual center is `public/assets/poorup_board_1to1_figma_master.svg`,
the supplied 960×670 Figma master used by the reference composition.

- SHA-256: `9F2E54F832B023411634AAAEB99E1DF2D9DF70C273EC4E2913BE461BEFEDECED`

`public/assets/poorup_board_40-source.svg` is the supplied
`poorup_base_equal_tile_sizes_chatgpt.svg` asset copied byte-for-byte. The runtime
`public/assets/poorup_board_40.svg` is now the same supplied artwork byte-for-byte;
its internal per-side transforms already expand the 40-space perimeter into the
960×960 square. The legacy board contributes names only. Runtime SHA-256:

- `41EA2F234392DC67878F38CA65945A96FDBF12CBE224FB47D881899F365B9382`

Source SHA-256:

- `41EA2F234392DC67878F38CA65945A96FDBF12CBE224FB47D881899F365B9382`

The protected legacy copy must never be overwritten by generation or formatting steps.

## Current plain-client snapshot

The `23;26` delivery uses the archive's HTML/CSS/JavaScript board composition at
runtime (`public/index.html`, `public/main.js`, `public/styles.css`). The SVGs above
are intentionally retained as protected visual references and are not deleted by
frontend refreshes.
