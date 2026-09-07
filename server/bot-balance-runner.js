// Longer opt-in balance campaign. The normal regression suite keeps the
// bounded 1,000-game gate; this command raises the sample without duplicating
// the simulation harness or changing gameplay rules.
import { spawnSync } from 'child_process';

const count = Math.max(1_001, Math.floor(Number(process.env.POORUP_BOT_BALANCE_COUNT) || 2_500));
const result = spawnSync(process.execPath, ['server/bot-simulation.test.js'], {
  env: { ...process.env, POORUP_BOT_SIMULATION_COUNT: String(count) },
  stdio: 'inherit'
});
if (result.error) {
  console.error(result.error);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
