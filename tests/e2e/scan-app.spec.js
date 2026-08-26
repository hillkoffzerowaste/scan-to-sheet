// @ts-check
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';

/**
 * Contrast maths, shared by every readability test in this file.
 *
 * Playwright serialises each `evaluate` callback and runs it in the browser, so a helper
 * declared here in Node scope is NOT visible inside those callbacks. The maths therefore
 * lives in this source string and is handed to each callback as an argument.
 *
 * Why it exists at all: the previous per-test copies did `split(',').slice(0, 3)`, which
 * throws the alpha channel away and treats a translucent background as if it were opaque.
 * `.drive-mode-label` is painted with `--primary-soft` (rgba(5,133,129,0.1) in light) over
 * the surface behind it, so that shortcut reported 1.518:1 for a label that renders at
 * 5.992:1 in light and 7.976:1 in dark — a failure that was entirely the test's own.
 */
const CONTRAST_HELPERS = `
  function parseColor(value) {
    const text = String(value == null ? '' : value).trim().toLowerCase();
    if (text === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };

    const functional = text.match(/^rgba?\\(([^)]+)\\)$/);
    if (functional) {
      const parts = functional[1]
        .split(/[\\s,\\/]+/)
        .filter(Boolean)
        .map(function (part) { return Number.parseFloat(part); });
      if (parts.length < 3) return null;
      if (parts.slice(0, 3).some(function (part) { return !Number.isFinite(part); })) return null;
      const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
      return { rgb: parts.slice(0, 3), alpha: alpha };
    }

    if (text.charAt(0) === '#') {
      const hex = text.slice(1);
      const expanded = (hex.length === 3 || hex.length === 4)
        ? hex.split('').map(function (part) { return part + part; }).join('')
        : hex;
      if (expanded.length !== 6 && expanded.length !== 8) return null;
      const channels = [0, 2, 4].map(function (index) {
        return Number.parseInt(expanded.slice(index, index + 2), 16);
      });
      if (channels.some(function (part) { return Number.isNaN(part); })) return null;
      const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;
      return { rgb: channels, alpha: alpha };
    }

    return null;
  }

  function over(top, bottom) {
    return top.rgb.map(function (part, index) {
      return (part * top.alpha) + (bottom[index] * (1 - top.alpha));
    });
  }

  /**
   * Flatten every translucent background between the element and the first opaque layer
   * above it. Ends at the browser canvas (white) when nothing opaque is found, which is
   * what the browser itself paints — not at a value picked to make the assertion pass.
   */
  function backgroundBehind(element) {
    const layers = [];
    let node = element;
    while (node) {
      const parsed = parseColor(getComputedStyle(node).backgroundColor);
      if (parsed === null) return null;
      if (parsed.alpha > 0) layers.push(parsed);
      if (parsed.alpha === 1) break;
      node = node.parentElement;
    }
    let base = [255, 255, 255];
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      base = over(layers[index], base);
    }
    return base;
  }

  function luminance(rgb) {
    const linear = rgb.map(function (part) {
      const normalized = part / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });
    return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  }

  /**
   * Returns null whenever a colour cannot be resolved. Never returns a high number on
   * failure: a fallback like 21 would silently swallow a real contrast regression.
   */
  function contrastRatio(element, backgroundElement) {
    if (!element) return null;
    const background = backgroundBehind(backgroundElement || element);
    if (background === null) return null;
    const foreground = parseColor(getComputedStyle(element).color);
    if (foreground === null) return null;
    const text = foreground.alpha === 1 ? foreground.rgb : over(foreground, background);
    const textLuminance = luminance(text);
    const backgroundLuminance = luminance(background);
    return (Math.max(textLuminance, backgroundLuminance) + 0.05)
      / (Math.min(textLuminance, backgroundLuminance) + 0.05);
  }

  /**
   * ratioFor(root, selector) measures the element against whatever is painted behind it.
   * Passing backgroundSelector measures the text against that other element's background
   * instead, for text that sits on an ancestor's fill.
   */
  function ratioFor(root, selector, backgroundSelector) {
    const element = selector ? root.querySelector(selector) : root;
    const backgroundElement = backgroundSelector ? root.querySelector(backgroundSelector) : null;
    return contrastRatio(element, backgroundElement);
  }

  return { ratioFor: ratioFor };
`;

test.describe('Scan to Sheet — External tools', () => {
  test('does not expose the retired packing video workspace', async ({ page }) => {
    await page.goto(BASE_URL);

    await expect(page.getByTestId('packing-video-tab')).toHaveCount(0);
    await expect(page.getByText('บันทึกวิดีโอแพ็ค', { exact: true })).toHaveCount(0);
  });

  test('opens the delivery system from the sidebar in a new tab', async ({ page }) => {
    await page.goto(BASE_URL);

    const deliveryLink = page.getByTestId('delivery-system-link');
    await expect(deliveryLink).toHaveAccessibleName('ระบบส่งของ');
    await expect(deliveryLink).toHaveAttribute('href', 'https://repo-rho-livid.vercel.app/');
    await expect(deliveryLink).toHaveAttribute('target', '_blank');
    await expect(deliveryLink).toHaveAttribute('rel', /noopener/);
    await expect(deliveryLink).toHaveAttribute('rel', /noreferrer/);
    await expect(page.getByTestId('sales-tab')).toHaveCount(0);
  });

  test('opens the label checker from the sidebar in a new tab', async ({ page }) => {
    for (const width of [375, 1000, 1400]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(BASE_URL);

      const checkerLink = page.getByRole('link', { name: 'พิมพ์ใบเช็ค ใบปะหน้า' });
      await expect(checkerLink).toBeVisible();
      await expect(checkerLink).toHaveAttribute('href', 'https://barcode-checker-ashy.vercel.app/');
      await expect(checkerLink).toHaveAttribute('target', '_blank');
      await expect(checkerLink).toHaveAttribute('rel', /noopener/);
      await expect(checkerLink).toHaveAttribute('rel', /noreferrer/);

      const layout = await checkerLink.evaluate((link) => ({
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        textClipped: link.scrollWidth > link.clientWidth || link.scrollHeight > link.clientHeight,
      }));
      expect(layout, `sidebar link layout at ${width}px`).toEqual({ pageOverflow: 0, textClipped: false });
    }
  });
});

test.describe('Scan to Sheet — Packer Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('renders app shell and title', async ({ page }) => {
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('.title-badge')).toContainText('Scan to Sheet');
    await expect(page.locator('.title-badge')).toContainText('HILLKOFF');
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
    // Barcode gun mode is the default (DEFAULT_SCAN_METHOD === 'manual'), because the
    // packers work with a gun and the camera is the exception. Assert both buttons, not
    // just the active one: a control that marks *every* option active would otherwise pass.
    const manualBtn = page.locator('.scan-tool-panel button:has-text("เครื่องยิง/พิมพ์")');
    const cameraBtn = page.locator('.scan-tool-panel button:has-text("กล้องมือถือ")');
    await expect(manualBtn).toHaveClass(/active/);
    await expect(cameraBtn).not.toHaveClass(/active/);

    // Switching to camera must move the active state, not add a second active button.
    await cameraBtn.click();
    await expect(cameraBtn).toHaveClass(/active/);
    await expect(manualBtn).not.toHaveClass(/active/);

    // And switching back must work too, so the test still covers the control both ways.
    await manualBtn.click();
    await expect(manualBtn).toHaveClass(/active/);
    await expect(cameraBtn).not.toHaveClass(/active/);
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

    const contrast = await page.locator('.enterprise-shell').evaluate((root, helpers) => {
      const { ratioFor } = new Function(helpers)();
      return {
        activeTab: ratioFor(root, '.tab-button.active'),
        activeCourier: ratioFor(root, '.courier-button.active'),
        disabledControl: ratioFor(root, 'button:disabled'),
      };
    }, CONTRAST_HELPERS);

    expect(contrast.activeTab).toBeGreaterThanOrEqual(4.5);
    expect(contrast.activeCourier).toBeGreaterThanOrEqual(4.5);
    expect(contrast.disabledControl).toBeGreaterThanOrEqual(4.5);
  });

  test('keeps semantic labels readable in both themes', async ({ page }) => {
    const inspect = async () => page.locator('.enterprise-shell').evaluate((root, helpers) => {
      const { ratioFor } = new Function(helpers)();
      return {
        activeTab: ratioFor(root, '.tab-button.active'),
        activeCourier: ratioFor(root, '.courier-button.active'),
        driveLabel: ratioFor(root, '.drive-mode-label'),
        statusBanner: ratioFor(root, '.status-banner'),
        topbarTitle: ratioFor(root, '.topbar h1', '.topbar'),
      };
    }, CONTRAST_HELPERS);

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
      expect(themeContrast.topbarTitle).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('keeps marketplace file controls readable in light mode', async ({ page }) => {
    await page.locator('.theme-toggle button:has-text("Light")').click();
    await page.locator('.marketplace-upload-panel summary').click();

    const controls = await page.locator('.marketplace-upload-panel').evaluate((panel, helpers) => {
      const { ratioFor } = new Function(helpers)();
      return {
        platformSelect: ratioFor(panel, '.marketplace-filter select'),
        fileButton: ratioFor(panel, '.marketplace-upload-controls button'),
      };
    }, CONTRAST_HELPERS);

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
        rows: new Set(boxes.map((box) => Math.round(box.top))).size,
        smallestWidth: Math.min(...boxes.map((box) => box.width)),
        smallestHeight: Math.min(...boxes.map((box) => box.height)),
        overflow: tabBar.scrollWidth > tabBar.clientWidth,
      };
    });
    expect(tabLayout.count).toBeGreaterThan(0);
    expect(tabLayout.rows).toBeGreaterThan(0);
    expect(tabLayout.smallestWidth).toBeGreaterThanOrEqual(44);
    expect(tabLayout.smallestHeight).toBeGreaterThanOrEqual(44);
    expect(tabLayout.overflow).toBe(false);

    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(pageOverflow).toBe(false);

    // Table should scroll horizontally
    const tableWrap = page.locator('.table-wrap').first();
    const overflowX = await tableWrap.evaluate((el) => window.getComputedStyle(el).overflowX);
    expect(overflowX).toBe('auto');
  });
});

test.describe('Scan to Sheet — Brand standards', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('exposes operational quality controls without adding scan actions', async ({ page }) => {
    const standardsPanel = page.locator('.standards-panel');
    await expect(standardsPanel).toBeVisible();
    await expect(standardsPanel.locator('.secondary-panel-label')).toContainText('Quality controls');
    await standardsPanel.locator('summary').click();
    await expect(standardsPanel.locator('.standards-item')).toHaveCount(4);
    await expect(standardsPanel.locator('.standards-item').first()).toContainText('Traceability');
  });
});
