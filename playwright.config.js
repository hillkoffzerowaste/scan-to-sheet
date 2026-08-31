// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : 2,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // project 'Mobile Chrome' (Pixel 5) ถูกถอดออกพร้อมกับการย้ายมาใช้ Windows Enterprise Shell
    // ซึ่งเป็น desktop-only — ความกว้างที่ต้องคุ้มครองย้ายไปอยู่ในชุด "Desktop layout"
    // ที่ตรวจ 1280 / 1440 / 1920 แทน (ดู DESIGN.md ข้อ 5)
  ],
  webServer: {
    command: '.\\node_modules\\.bin\\vite.cmd --host 0.0.0.0',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
