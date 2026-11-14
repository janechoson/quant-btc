import { defineConfig } from '@playwright/test';
const port =
  Number(process.env.PW_PORT || process.env.VITE_PORT) || 5173;
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.ui.spec.ts',
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1672, height: 941 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
