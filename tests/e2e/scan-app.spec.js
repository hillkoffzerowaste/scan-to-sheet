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
    const marketplacePanel = page.locator('.marketplace-upload-panel');
    await marketplacePanel.locator('summary').click();
    const uploadButton = marketplacePanel.locator('.secondary-button');
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
    await page.getByTestId('reports-tab').click();
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

  test('can switch to reports tab without showing scan workspace', async ({ page }) => {
    const reportsTab = page.getByTestId('reports-tab');
    await reportsTab.click();
    await expect(reportsTab).toHaveClass(/active/);
    await expect(reportsTab).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.report-panel')).toBeVisible();
    await expect(page.locator('.workspace-grid')).toHaveCount(0);
    await expect(page.locator('.workflow-guide')).toHaveCount(0);
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

  test('keeps secondary tools collapsed and removes decorative motion', async ({ page }) => {
    await expect(page.locator('details.secondary-panel[open]')).toHaveCount(0);
    const visualOverhead = await page.locator('.enterprise-shell').evaluate((root) => {
      const elements = Array.from(root.querySelectorAll('*'));
      return {
        animations: elements.filter((el) => getComputedStyle(el).animationName !== 'none' && getComputedStyle(el).animationName !== '' && !el.classList.contains('spin')).length,
        transitions: elements.filter((el) => getComputedStyle(el).transitionDuration !== '0s').length,
        gradients: elements.filter((el) => getComputedStyle(el).backgroundImage.includes('gradient')).length,
        blur: elements.filter((el) => getComputedStyle(el).backdropFilter !== 'none').length,
      };
    });
    expect(visualOverhead).toEqual({ animations: 0, transitions: 0, gradients: 0, blur: 0 });
  });

  test('keeps active and disabled controls readable in dark theme', async ({ page }) => {
    await page.locator('.theme-toggle button:has-text("Dark")').click();

    const contrast = await page.locator('.enterprise-shell').evaluate((root) => {
      const channel = (value) => {
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        return match[1].split(',').slice(0, 3).map((part) => Number.parseFloat(part.trim()));
      };
      const toRgb = (value) => {
        const normalized = value.trim().toLowerCase();
        if (normalized.startsWith('rgb')) return channel(normalized);
        if (!normalized.startsWith('#')) return null;
        const hex = normalized.slice(1);
        const expanded = hex.length === 3 ? hex.split('').map((part) => `${part}${part}`).join('') : hex;
        if (expanded.length !== 6) return null;
        return [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16));
      };
      const luminance = (value) => {
        const rgb = toRgb(value);
        if (!rgb) return null;
        const linear = rgb.map((part) => {
          const normalized = part / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
      };
      const ratio = (element) => {
        const style = getComputedStyle(element);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        if (foreground === null || background === null) return null;
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      };
      return {
        activeTab: ratio(root.querySelector('.tab-button.active')),
        activeCourier: ratio(root.querySelector('.courier-button.active')),
        disabledControl: ratio(root.querySelector('button:disabled')),
      };
    });

    expect(contrast.activeTab).toBeGreaterThanOrEqual(4.5);
    expect(contrast.activeCourier).toBeGreaterThanOrEqual(4.5);
    expect(contrast.disabledControl).toBeGreaterThanOrEqual(4.5);
  });

  test('keeps semantic labels readable in both themes', async ({ page }) => {
    const inspect = async () => page.locator('.enterprise-shell').evaluate((root) => {
      const parse = (value) => {
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        return match[1].split(',').slice(0, 3).map((part) => Number.parseFloat(part.trim()));
      };
      const luminance = (value) => {
        const rgb = parse(value);
        if (!rgb) return null;
        const linear = rgb.map((part) => {
          const normalized = part / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
      };
      const ratio = (selector) => {
        const element = root.querySelector(selector);
        if (!element) return null;
        const style = getComputedStyle(element);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        if (foreground === null || background === null) return null;
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      };
      return {
        activeTab: ratio('.tab-button.active'),
        activeCourier: ratio('.courier-button.active'),
        driveLabel: ratio('.drive-mode-label'),
        statusBanner: ratio('.status-banner'),
      };
    });

    await page.locator('.theme-toggle button:has-text("Light")').click();
    await page.getByTestId('drive-tab').click();
    const light = await inspect();

    await page.locator('.theme-toggle button:has-text("Dark")').click();
    const dark = await inspect();

    for (const themeContrast of [light, dark]) {
      expect(themeContrast.activeTab).toBeGreaterThanOrEqual(4.5);
      expect(themeContrast.activeCourier).toBeGreaterThanOrEqual(4.5);
      expect(themeContrast.driveLabel).toBeGreaterThanOrEqual(4.5);
      expect(themeContrast.statusBanner).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('keeps marketplace file controls readable in light mode', async ({ page }) => {
    await page.locator('.theme-toggle button:has-text("Light")').click();
    await page.locator('.marketplace-upload-panel summary').click();

    const controls = await page.locator('.marketplace-upload-panel').evaluate((panel) => {
      const parse = (value) => {
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        return match[1].split(',').slice(0, 3).map((part) => Number.parseFloat(part.trim()));
      };
      const luminance = (value) => {
        const rgb = parse(value);
        if (!rgb) return null;
        const linear = rgb.map((part) => {
          const normalized = part / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
      };
      const ratio = (selector) => {
        const element = panel.querySelector(selector);
        if (!element) return null;
        const style = getComputedStyle(element);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        if (foreground === null || background === null) return null;
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      };
      return {
        platformSelect: ratio('.marketplace-filter select'),
        fileButton: ratio('.marketplace-upload-controls button'),
      };
    });

    expect(controls.platformSelect).toBeGreaterThanOrEqual(4.5);
    expect(controls.fileButton).toBeGreaterThanOrEqual(4.5);
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

    const tabLayout = await page.locator('.tab-bar').evaluate((tabBar) => {
      const buttons = Array.from(tabBar.querySelectorAll('.tab-button'));
      const boxes = buttons.map((button) => button.getBoundingClientRect());
      return {
        count: buttons.length,
        sameRow: boxes.every((box) => box.top === boxes[0]?.top),
        overflow: tabBar.scrollWidth > tabBar.clientWidth,
      };
    });
    expect(tabLayout).toEqual({ count: 3, sameRow: true, overflow: false });

    // Table should scroll horizontally
    const tableWrap = page.locator('.table-wrap').first();
    const overflowX = await tableWrap.evaluate((el) => window.getComputedStyle(el).overflowX);
    expect(overflowX).toBe('auto');
  });
});
