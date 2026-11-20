# Bot-campaign parity baseline

`bench/` holds a fixed record of what the deterministic bot simulation produces,
so a change (or a port of the game engine to another runtime) can be checked
for identical behavior. It is not part of `npm test` or CI.

| File | Role |
| --- | --- |
| `baseline/campaign-baseline.mjs` | Runs the seeded bot campaign and writes the two JSON files below. It mirrors the loop in `server/bot-simulation.test.js`: seed `index * 1009 + 7`, three no-AI bot seats, $1500 starting cash, a 2000-step cap. |
| `baseline/node-results.json` | **The parity oracle.** One entry per game (60 games, indexes 1 to 60): seed, step count, whether it ended, stalls and each seat's final net worth. Every field is deterministic, so a correct build reproduces it exactly. |
| `baseline/node-baseline.json` | A timing record of the same 60-game run (games per second, per-game percentiles). It is specific to the machine and Node version named inside it (the Rust-port experiment's reference point) and is informational only; never compare against it for correctness. |
| `fixtures/capture.mjs`, `fixtures/tap-hooks.mjs` | A recorder for differential-test fixtures: it wraps the pure game-rule and bot-policy functions during seeded games and writes their arguments and results as `<module>/<function>.jsonl.gz`. The generated `.gz` files are deliberately not committed; regenerate them when needed with `node bench/fixtures/capture.mjs [seeds] [perSeedCap] [startIndex]`. |

## Run the parity check

Always write to a scratch directory. The script's default output folder is
`bench/baseline`, which would overwrite the oracle.

```bash
OUT=$(mktemp -d)
node bench/baseline/campaign-baseline.mjs 5 1 "$OUT"    # games, first index, output dir
```

Compare the fresh results with the oracle, matching by game index (the timing
file will differ and should):

```bash
node -e "
const fs = require('fs');
const fresh = JSON.parse(fs.readFileSync(process.argv[1] + '/node-results.json', 'utf8'));
const oracle = new Map(JSON.parse(fs.readFileSync('bench/baseline/node-results.json', 'utf8')).map(r => [r.index, r]));
const bad = fresh.filter(r => JSON.stringify(r) !== JSON.stringify(oracle.get(r.index)));
console.log(bad.length ? 'MISMATCH in games ' + bad.map(r => r.index).join(', ') : 'parity OK (' + fresh.length + ' games)');
process.exit(bad.length ? 1 : 0);" "$OUT"
```

Five games take a few seconds; the full 60 take about a minute or more
(`campaign-baseline.mjs 60 1 <dir>`). The oracle was produced by the current bot
and game rules: if you intentionally change bot behavior or game balance, the
oracle is expected to differ. Regenerate it in that same change, with the full
60 games and the default output folder, and say so in the commit.

The scripts import `server/botAdvisor.js` and `server/bot-policy-tournament.js`;
if those move, update the import paths in `campaign-baseline.mjs` and the module
list in `fixtures/capture.mjs`.
