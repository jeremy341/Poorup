import { defineConfig } from '@playwright/test';
import process from 'node:process';
import { playwrightUse, supportedViewports } from './visual-capture/viewports.mjs';

export default defineConfig({
  testDir: './',
  timeout: 30_000,
  fullyParallel: true,
  // CI retries once so a one-off flake does not fail a whole release shard;
  // locally the default of zero keeps real failures loud.
  retries: process.env.POORUP_QA_RETRIES !== undefined ? Number(process.env.POORUP_QA_RETRIES) : (process.env.CI ? 1 : 0),
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.POORUP_QA_BASE_URL || 'http://127.0.0.1:8080',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: supportedViewports.map(profile => ({
    name: profile.id,
    use: playwrightUse(profile),
  })),
  webServer: process.env.POORUP_QA_BASE_URL ? undefined : {
    command: 'node server/server.js',
    cwd: '..',
    url: 'http://127.0.0.1:8080/',
    reuseExistingServer: true,
    timeout: 30_000,
    // Parallel browser workers open many sockets from one loopback address.
    // The production per-peer cap (default 5) is a DoS guard, not a fit for
    // that harness shape; unit tests cover the cap itself.
    env: { ...process.env, POORUP_SOCKET_MAX_PER_PEER: '1000' }
  }
});
