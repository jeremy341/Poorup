# Parlor Patrol review asset pack

All visual SVGs in this directory are original Poorup artwork. No external
aircraft or explosion sprites are imported.

These assets now power the optional Home-screen Parlor Patrol microgame. They
remain isolated from the Socket.IO game state and are only active on Home. A
fly-by starts after about 4 seconds, then short cooldowns keep later passes
active without turning the skyline into a constant stream.

`Ctrl+P` starts Night Shift from Home. It keeps the moving skyline visible while
the ordinary Home controls become hidden and inert. The transparent arcade layer
runs infinite 60-second waves with an independent score, countdown, and
three-heart life system. Hostile helicopters, drones, and airplanes that leave
the screen cost a heart; beacons are optional bonus targets. Escape or
`EXIT MODE` ends it without changing rooms, accounts, or the normal patrol
score.

## Pixel SVGs

- `helicopter-16-frames.svg`: 16 overlaid 128×64 frames, 100 ms per frame, stepped rotor poses, alternating red/blue beacon, facing right.
- `helicopter-left-16-frames.svg`: mirrored facing-left wrapper used for right-to-left flights from the right edge.
- `helicopter-crash-12-frames.svg`: 12 original burning/rotating frames retained for reference; the active Night Shift helicopter hit now uses the Home impact/smoke system at the click location.
- `drone-8-frames.svg`: compact secondary target introduced in later waves.
- `drone-explosion-10-frames.svg`: 10 original 112×112 red/orange frames for an immediate drone detonation.
- `airplane-10-frames.svg`: 10 original 112×64 frames for a fast later-wave aircraft.
- `airplane-explosion-10-frames.svg`: 10 original 128×112 red/orange frames for an immediate airplane detonation.
- `beacon-6-frames.svg`: falling signal bonus target.
- `spiral-trail-8-frames.svg`: original stepped ring frames retained for future experiments; not used by the active hit path.
- `debris-6-frames.svg`: original impact shard frames.
- `contrail-6-frames.svg`: original short aircraft trail frames.
- `heart.svg`: one red pixel life icon used by the Night Shift HUD.
- `impact-8-frames.svg`: 8 overlaid 64×64 frames, 80 ms per frame, gold flash into teal smoke.
- `smoke-6-frames.svg`: 6 overlaid 80×64 frames, 120 ms per frame, stepped teal smoke trail.
- `crosshair.svg`: 32×32 static pixel reticle used as the optional skyline target and Poorup pointer cursor.

Palette is intentionally limited to Poorup tokens: `#030C10`, `#071314`, `#123D4B`, `#286EA1`, `#3E7D7B`, `#D74438`, `#CFA75F`, and `#F0D9AC`. All SVGs use `shape-rendering="crispEdges"`, transparent backgrounds, stable frame IDs, and reduced-motion fallbacks.

## Sound file

The helicopter uses one CC0 hit sound. All other downloaded UI and ambience
effects were removed at the player's request.

| File | Intended use | Source and license |
| --- | --- | --- |
| `pixel-hit-pack-cc0.wav` | hit confirmation | [8-Bit Sound Effect Pack Vol. 001](https://opengameart.org/content/8-bit-sound-effect-pack-vol-001), Deva/@Shades, CC0 |

SHA-256 checksums for the downloaded files:

```text
pixel-hit-pack-cc0.wav 9CBC24BF6233147DC8818AF4FA37D7C6AB6E4475D4C8409AAAA7E2CBF640B41A
```

`Pondering the Cosmos` remains the separate home soundtrack candidate documented in `../README.md`. It is also CC0 and has not been changed by this asset pack.
