/* global process */
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playwrightUse, selectViewports } from './viewports.mjs';

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(configDirectory, '../..');
const selectedProfiles = selectViewports({ viewport: process.env.POORUP_CAPTURE_VIEWPORT || undefined });

export default defineConfig({
  testDir: path.join(repositoryRoot, 'qa'),
  testMatch: [
    'poorup.spec.js',
    'release-surfaces.spec.js',
    'ipad-pro-modals.spec.js',
    'in-game-ux.spec.js',
    'admin-analytics-visual.spec.js',
    'client-market-ui.spec.js',
    'player-card-responsive.spec.js',
    'sponsored-purchase-presentation.spec.js',
  ],
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8080',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: selectedProfiles.map(profile => ({
    name: profile.id,
    use: playwrightUse(profile),
  })),
  webServer: {
    command: 'node server/server.js',
    cwd: repositoryRoot,
    url: 'http://127.0.0.1:8080/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
