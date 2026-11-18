import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the main user journeys (e2e/*.spec.ts).
 *
 * The pages run for real; every /api call a test needs is stubbed in the browser
 * (see e2e/helpers.ts), so no test talks to Razorpay, Cloudinary, Redis or email.
 * The server still renders layouts from MongoDB, so a database must be reachable
 * (CI starts an empty one).
 *
 *   npm run test:e2e            reuses a server on E2E_BASE_URL (default :3100) or starts `npm run start`
 *   PW_CHANNEL=chrome npm run test:e2e   uses installed Chrome instead of Playwright's Chromium
 */
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    channel: process.env.PW_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || undefined } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: process.env.PW_CHANNEL || undefined }, testMatch: /public|order/ },
  ],
  webServer: {
    command: 'npm run start -- -p 3100',
    url: `${baseURL}/robots.txt`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
