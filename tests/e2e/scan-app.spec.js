// @ts-check
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';

test.describe('Scan to Sheet — Packer Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('renders app shell and title', async ({ page }) => {
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('.title-badge')).toContainText('Scan to Sheet');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('shows Login with Google when not signed in', async ({ page }) => {
    const loginBtn = page.locator('.top-connect-box .secondary-button');
    await expect(loginBtn).toBeVisible();
  });

  test('shows marketplace upload button and protects it until Firebase login', async ({ page }) => {
    const uploadButton = page.locator('.marketplace-upload-panel .secondary-button');
    await expect(uploadButton).toBeVisible();
    await expect(uploadButton).toContainText('เลือกไฟล์ออเดอร์');
    await expect(uploadButton).toBeDisabled();
  });

  test('renders courier list', async ({ page }) => {
    const couriers = page.locator('.courier-button');
    await expect(couriers.first()).toBeVisible();
    // There should be at least 6 couriers
    const count = await couriers.count();
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test('packer tab is active by default', async ({ page }) => {
    const packerTab = page.getByTestId('packer-tab');
    await expect(packerTab).toHaveClass(/active/);
  });

  test('scan input is disabled until login', async ({ page }) => {
    await page.locator('.scan-tool-panel button:has-text("เครื่องยิง/พิมพ์")').click();
    const input = page.locator('#scan-input');
    await expect(input).toBeDisabled();
  });

  test('can select a courier', async ({ page }) => {
    const shopeeBtn = page.locator('.courier-button:has-text("Shopee")').first();
    await expect(shopeeBtn).toBeVisible();
    await expect(shopeeBtn).toHaveClass(/active/);
  });

  test('scan method segmented control works', async ({ page }) => {
    // Camera mode is default
    const cameraBtn = page.locator('.scan-tool-panel button:has-text("กล้องมือถือ")');
    await expect(cameraBtn).toHaveClass(/active/);

    // Switch to manual
    const manualBtn = page.locator('.scan-tool-panel button:has-text("เครื่องยิง/พิมพ์")');
    await manualBtn.click();
    await expect(manualBtn).toHaveClass(/active/);
  });

  test('report panel renders', async ({ page }) => {
    const reportPanel = page.locator('.report-panel');
    await expect(reportPanel).toBeVisible();
    await expect(reportPanel.locator('h2')).toContainText('รายงานสแกน');
  });
});

test.describe('Scan to Sheet — Drive Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('can switch to drive tab', async ({ page }) => {
    const driveTab = page.getByTestId('drive-tab');
    await driveTab.click();
    await expect(driveTab).toHaveClass(/active/);
    await expect(page.locator('.drive-mode-label')).toBeVisible();
  });

  test('missing order check panel visible in drive tab', async ({ page }) => {
    const driveTab = page.getByTestId('drive-tab');
    await driveTab.click();
    await expect(page.locator('.missing-check-panel')).toBeVisible();
    await expect(page.locator('.missing-check-panel h3')).toContainText('จับคู่ Admin');
  });

  test('threshold minutes selector has options', async ({ page }) => {
    const driveTab = page.getByTestId('drive-tab');
    await driveTab.click();
    const select = page.locator('.missing-check-controls select');
    await expect(select).toBeVisible();
    const options = await select.locator('option').allTextContents();
    expect(options).toContain('15 นาที');
    expect(options).toContain('30 นาที');
    expect(options).toContain('1 ชั่วโมง');
  });
});

test.describe('Scan to Sheet — Theme & Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('theme toggle switches dark/light', async ({ page }) => {
    const darkBtn = page.locator('.theme-toggle button:has-text("Dark")');
    await darkBtn.click();

    // Check that data-theme changed
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // Switch back to light
    const lightBtn = page.locator('.theme-toggle button:has-text("Light")');
    await lightBtn.click();
    await expect(html).toHaveAttribute('data-theme', 'light');
  });

  test('search panel is visible in packer tab', async ({ page }) => {
    await expect(page.locator('.search-panel')).toBeVisible();
    await expect(page.locator('.search-panel h3')).toContainText('ค้นหาเลขพัสดุ');
  });

  test('recent rows header is visible', async ({ page }) => {
    await expect(page.locator('.recent-header h3').first()).toContainText('รายการล่าสุด');
  });

  test('table wrap has horizontal scroll', async ({ page }) => {
    const tableWrap = page.locator('.table-wrap').first();
    const overflowX = await tableWrap.evaluate((el) => window.getComputedStyle(el).overflowX);
    expect(overflowX).toBe('auto');
  });
});

test.describe('Scan to Sheet — Status Banner', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('shows initial status banner', async ({ page }) => {
    const banner = page.locator('.status-banner');
    await expect(banner).toBeVisible();
  });
});

test.describe('Scan to Sheet — Mobile Responsiveness', () => {
  test('app is usable on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE_URL);

    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('h1')).toBeVisible();

    // Table should scroll horizontally
    const tableWrap = page.locator('.table-wrap').first();
    const overflowX = await tableWrap.evaluate((el) => window.getComputedStyle(el).overflowX);
    expect(overflowX).toBe('auto');
  });
});
