// Coverage runner: executes the in-memory suites as child processes so one
// c8 pass collects them all (public/ stays out of scope by design until R0).
import { spawnSync } from 'child_process';

const suites = ['server/gameLogic.test.js', 'server/applyCard.test.js', 'server/rent.test.js', 'server/persistence.test.js', 'server/leaderboard.test.js', 'server/game-results.test.js', 'server/property-actions.test.js', 'server/contracts-market.test.js', 'server/botLogic.test.js', 'server/global-events.test.js', 'server/trades.test.js', 'server/roomSetup.test.js'];
let failed = 0;
for (const suite of suites) {
  const run = spawnSync(process.execPath, [suite], { stdio: 'inherit' });
  if (run.status !== 0) failed += 1;
}
process.exitCode = failed ? 1 : 0;
