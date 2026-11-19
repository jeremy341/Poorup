# Font credits and licences

These six font files are served from this directory (`/assets/fonts/...`). All
four families are released under the SIL Open Font License 1.1 (OFL 1.1). What
is recorded below was read from the `name` table inside each shipped file
(copyright line, version, licence URL). Anything not found in the files is
marked as such, not guessed.

## Required follow-up: ship the licence text — DONE

The OFL requires that the licence text and each family's copyright notice
travel with the fonts when they are redistributed. **Each family's licence
file now ships in this directory**, fetched verbatim from the canonical
`google/fonts` upstream:

- `OFL-ibm-plex-mono.txt` — Copyright © 2017 IBM Corp. **with Reserved Font
  Name "Plex"** (the only family here that reserves a name; the family is
  shipped under its original name, so the reservation is satisfied).
- `OFL-jersey15.txt` — Copyright 2023 The Soft Type Project Authors
  (https://github.com/scfried/soft-type-jersey). No Reserved Font Name.
- `OFL-pixelify-sans.txt` — Copyright 2021 The Pixelify Sans Project Authors
  (https://github.com/eifetx/Pixelify-Sans). No Reserved Font Name.
- `OFL-silkscreen.txt` — Copyright 2001 The Silkscreen Project Authors
  (https://github.com/googlefonts/silkscreen). No Reserved Font Name; the
  canonical googlefonts release distributes Silkscreen under OFL 1.1, which
  covers the copy shipped here.

The Reserved Font Name check flagged earlier is resolved by those files:
IBM Plex Mono reserves "Plex" (satisfied, name unchanged); the other three
families declare none.

## Families

| Family | Files | Version (from file) | Copyright line (verbatim from file) | Designer / author | Licence | Upstream |
| --- | --- | --- | --- | --- | --- | --- |
| IBM Plex Mono | `ibm-plex-mono-500.woff2` (Medium), `ibm-plex-mono-600.woff2` (SemiBold) | 2.3 | Copyright 2017 IBM Corp. All rights reserved. | IBM (the Plex typeface family, designed with Bold Monday) | SIL OFL 1.1. The file's licence URL field is `http://scripts.sil.org/OFL`. | https://github.com/IBM/plex |
| Jersey 15 | `jersey15-regular.woff2` | 1.001 | Copyright 2023 The Soft Type Project Authors (https://github.com/scfried/soft-type-jersey) | Sarah Cadigan-Fried (designer field in the file) | SIL OFL 1.1. The file's licence description says "SIL Open Font License, Version 1.1" and points to https://openfontlicense.org | https://github.com/scfried/soft-type-jersey, https://fonts.google.com/specimen/Jersey+15 |
| Pixelify Sans | `pixelify-sans-400.woff2` (Regular), `pixelify-sans-700.woff2` (Bold) | 1.000 | Copyright 2021 The Pixelify Sans Project Authors (https://github.com/eifetx/Pixelify-Sans) | The file names only "The Pixelify Sans Project Authors" and the repository `eifetx/Pixelify-Sans`. The individual designer name is not in the file. Believed to be Stefie Justprince (not verified here). | SIL OFL 1.1. The file's licence URL field is `https://scripts.sil.org/OFL`. | https://github.com/eifetx/Pixelify-Sans, https://fonts.google.com/specimen/Pixelify+Sans |
| Silkscreen | `silkscreen-regular.ttf` | 1.001 | Copyright 2001 The Silkscreen Project Authors (https://github.com/googlefonts/silkscreen) | Not named in the file. Silkscreen was originally made by Jason Kottke (believed, from the upstream project history; not verified here). | OFL 1.1 per the file's licence URL field (`https://scripts.sil.org/OFL`). The file carries no licence description text. | https://github.com/googlefonts/silkscreen, https://fonts.google.com/specimen/Silkscreen |

## Confidence

- **Licence is OFL 1.1: high for all four families.** Each file's licence URL
  (and, for Jersey 15, its licence description) names the OFL. This is the
  file's own statement, but it is a pointer, not the licence text.
- **Copyright lines and versions: high.** Copied from the files.
- **Designer names: Jersey 15 high (in the file). IBM Plex Mono medium
  (family credit from memory, not in the file). Pixelify Sans and Silkscreen
  low to medium (from memory, not in the files).** Confirm against the upstream
  repositories before publishing a named credit.
- **Reserved Font Names: resolved.** IBM Plex Mono's upstream OFL declares
  "Plex" as its Reserved Font Name (the family ships unrenamed, satisfying
  it); Pixelify Sans, Jersey 15 and Silkscreen declare none in their
  upstream `OFL.txt` files, which now ship beside the font files.
- **Silkscreen: resolved.** The canonical googlefonts release distributes
  Silkscreen under OFL 1.1 with no Reserved Font Name, and its licence text
  ships here — the pre-OFL-history concern is settled by the upstream
  release the copy is taken from.
