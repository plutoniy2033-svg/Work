import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, '.env') });

const baseURL =
  process.env.CREATIO_BASE_URL?.replace(/\/$/, '') ||
  'https://creatio.corp.mango.ru';

/** По умолчанию встроенный Chromium в headless. Окно ОС — только PLAYWRIGHT_HEADED=1. */
function resolveHeadless(): boolean {
  return process.env.PLAYWRIGHT_HEADED !== '1';
}

export default defineConfig({
  testDir: path.join(__dirname, 'e2e'),
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  reporter: process.env.PW_RUNNER_SUBPROCESS
    ? [['json']]
    : [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
      ],
  globalSetup: path.join(__dirname, 'e2e', 'global-setup.ts'),
  use: {
    baseURL,
    headless: resolveHeadless(),
    trace: 'off',
    video: {
      mode: 'on',
      size: { width: 1280, height: 720 },
    },
    screenshot: process.env.PW_RUNNER_SUBPROCESS ? 'on' : 'only-on-failure',
    actionTimeout: 45_000,
    navigationTimeout: 90_000,
    ignoreHTTPSErrors: true,
    launchOptions: {
      args: [
        '--disable-blink-features=AutomationControlled',
        '--force-color-profile=srgb',
        '--run-all-compositor-stages-before-draw',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        ...(process.env.PW_CHANNEL === 'chrome' ? { channel: 'chrome' as const } : {}),
      },
    },
  ],
});
