import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.GAME_HARNESS ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : (process.env.CI ? 'github' : 'list'),
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', video: process.env.GAME_HARNESS ? 'retain-on-failure' : 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
