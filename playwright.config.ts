import { defineConfig, devices } from '@playwright/test';

const testPort = Number(process.env.PLAYWRIGHT_PORT ?? 4173);

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  // The visual suite starts real Phaser matches and waits for simulation phases.
  // Two parallel Chromium workers starve those rAF loops on slower machines, so
  // the existing 2x screenshot checks intermittently never reach `fighting`.
  // One worker is both deterministic and no slower for this suite.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.GAME_HARNESS ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : (process.env.CI ? 'github' : 'list'),
  use: { baseURL: `http://127.0.0.1:${testPort}`, trace: 'retain-on-failure', video: process.env.GAME_HARNESS ? 'retain-on-failure' : 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${testPort} --strictPort`,
    url: `http://127.0.0.1:${testPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    // Retro is the shipped default. The harness pins classic unless a run
    // overrides it, so the default suite still covers classic and the retro job
    // sets VITE_VISUAL_STYLE=retro.
    env: { VITE_VISUAL_STYLE: process.env.VITE_VISUAL_STYLE ?? 'classic' },
  },
});
