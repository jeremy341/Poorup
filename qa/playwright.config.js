import { defineConfig, devices } from '@playwright/test';
import process from 'node:process';

export default defineConfig({
  testDir: './',
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.POORUP_QA_BASE_URL || 'http://127.0.0.1:8080',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'desktop-1920', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
    { name: 'desktop-1366', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'tablet-1024', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } },
    // Keep the mobile viewport on Chromium so CI only needs one browser
    // binary; the layout and keyboard contract are viewport-dependent.
    { name: 'mobile-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false } },
    { name: 'ipad-mini-landscape', use: { ...devices['iPad Mini landscape'], browserName: 'chromium' } },
    { name: 'ipad-pro-11-landscape', use: { ...devices['iPad Pro 11 landscape'], browserName: 'chromium' } }
  ],
  webServer: process.env.POORUP_QA_BASE_URL ? undefined : {
    command: 'node server/server.js',
    cwd: '..',
    url: 'http://127.0.0.1:8080/',
    reuseExistingServer: true,
    timeout: 30_000
  }
});
