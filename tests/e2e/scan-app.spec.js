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
    for (const width of [1280, 1440, 1920]) {
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
    await expect(page.locator('.win-shell')).toBeVisible();
    await expect(page.locator('.win-app-name')).toContainText('Scan to Sheet');
    await expect(page.locator('.win-app-name')).toContainText('HILLKOFF');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('shows Login with Google when not signed in', async ({ page }) => {
    const loginBtn = page.locator('.win-titlebar-btn', { hasText: /Login with Google|OAuth Client ID/ });
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

  test('shows every courier QR on the right workspace panel', async ({ page }) => {
    const couriers = page.locator('.courier-button');
    const qrPanel = page.locator('.workspace-qr-panel');
    await expect(qrPanel).toBeVisible();
    await expect(qrPanel).toContainText('QR ขนส่ง');
    await expect(qrPanel.locator('.scan-qr-card')).toHaveCount(await couriers.count());
    await expect(qrPanel.locator('.scan-qr-card img').first()).toBeVisible();
  });

  test('stores the chosen QR layout for this workstation', async ({ page }) => {
    const qrPanel = page.locator('.workspace-qr-panel');
    const layoutSelect = qrPanel.getByLabel('ขนาด QR หน้าแรก');
    await layoutSelect.selectOption('compact');
    await expect(qrPanel).toHaveClass(/qr-layout-compact/);
    await page.reload();
    await expect(page.locator('.workspace-qr-panel').getByLabel('ขนาด QR หน้าแรก')).toHaveValue('compact');
    await page.locator('.workspace-qr-panel').getByRole('button', { name: 'คืนค่า QR หน้าแรก' }).click();
    await expect(page.locator('.workspace-qr-panel').getByLabel('ขนาด QR หน้าแรก')).toHaveValue('standard');
  });

  test('fits the large QR popup grid inside a 1280px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const layout = await page.evaluate(() => {
      const popup = document.createElement('div');
      popup.className = 'scan-popup-overlay with-qr-panels qr-layout-large';
      popup.setAttribute('aria-hidden', 'true');
      popup.innerHTML = '<aside class="popup-qr-panel"></aside><div class="scan-popup-sheet"></div><aside class="popup-qr-panel"></aside>';
      document.body.append(popup);
      const dimensions = { client: popup.clientWidth, scroll: popup.scrollWidth };
      popup.remove();
      return dimensions;
    });
    expect(layout.scroll).toBeLessThanOrEqual(layout.client);
  });

  test('caps wide-screen courier QR workspace to fit four codes', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    const qrPanel = page.locator('.workspace-qr-panel');
    const qrBox = await qrPanel.boundingBox();
    expect(qrBox).not.toBeNull();
    expect(qrBox.width).toBeGreaterThanOrEqual(560);
    expect(qrBox.width).toBeLessThanOrEqual(576);
  });

  test('fits all courier QR codes without scrolling on desktop screens', async ({ page }) => {
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const qrPanel = page.locator('.workspace-qr-panel');
      await expect(qrPanel.locator('.scan-qr-card img').first()).toBeVisible();
      const columns = await qrPanel.locator('.scan-qr-grid').evaluate((grid) => (
        window.getComputedStyle(grid).gridTemplateColumns.split(' ').length
      ));
      const heights = await qrPanel.evaluate((panel) => ({
        client: panel.clientHeight,
        scroll: panel.scrollHeight,
      }));
      expect(columns, `QR column count at ${width}px`).toBe(4);
      expect(heights.scroll, `QR panel scrolls at ${width}px`).toBeLessThanOrEqual(heights.client);
    }
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

  test('shows every courier QR on the Admin workspace', async ({ page }) => {
    const driveTab = page.getByTestId('drive-tab');
    await driveTab.click();
    const couriers = page.locator('.courier-button');
    const qrPanel = page.locator('.workspace-qr-panel');
    await expect(qrPanel).toBeVisible();
    await expect(qrPanel.locator('.scan-qr-card')).toHaveCount(await couriers.count());
    await expect(qrPanel.locator('.scan-qr-card img').first()).toBeVisible();
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

/**
 * Colours are transitioned for interactive feedback, so a ratio read straight after a click
 * lands on an interpolated colour partway between the two states — white on a half-applied
 * teal measures 3.64 rather than the 4.728 the finished state gives. Wait for the running
 * transitions to finish, and only those: the loading spinner never finishes.
 */
const settleTransitions = (page) => page.evaluate(() => Promise.all(
  document.getAnimations()
    .filter((animation) => animation instanceof CSSTransition)
    .map((animation) => animation.finished.catch(() => {})),
));

/**
 * The Windows shell replaced the two-button Light/Dark segmented control with a single
 * toggle in the title bar, so a test can no longer click "the Dark button" directly —
 * it has to check the current theme first and only click when a switch is actually needed.
 */
const setTheme = async (page, theme) => {
  const current = await page.locator('html').getAttribute('data-theme');
  if (current !== theme) {
    await page.locator('.win-titlebar-btn', { hasText: /โหมด(มืด|สว่าง)/ }).click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
};

test.describe('Scan to Sheet — Theme & Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('theme toggle switches dark/light', async ({ page }) => {
    await setTheme(page, 'dark');
    await setTheme(page, 'light');
  });

  test('applies the stored dark theme before React loads', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('scan-to-sheet-theme', 'dark'));
    // Vite re-requests the module as /src/main.jsx?t=<timestamp> after any full reload it
    // triggers (dependency re-optimisation, or an HMR update while another client is
    // connected to the same dev server). A glob without the query misses that second
    // request, React boots, and the assertion below fails intermittently.
    await page.route(/\/src\/main\.jsx(\?|$)/, (route) => route.abort());
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#root')).toBeEmpty();
  });

  /**
   * The design system permits transitions, but only as interactive feedback: a named set of
   * properties, short durations, and never `all` — which used to drag width and transform
   * along with the colours and made controls slide around on re-render. Decorative motion
   * (looping pulses, entrance slides), gradients and blur stay banned outright.
   *
   * This replaces an assertion of `transitions: 0`, which locked in a blanket ban that the
   * press/hover feedback in DESIGN.md §2 cannot satisfy.
   */
  test('keeps secondary tools collapsed and limits motion to interactive feedback', async ({ page }) => {
    await expect(page.locator('details.secondary-panel[open]')).toHaveCount(0);
    const visualOverhead = await page.locator('.enterprise-shell').evaluate((root) => {
      const ALLOWED_PROPERTIES = ['background-color', 'border-color', 'box-shadow', 'color', 'transform'];
      const MAX_DURATION_SECONDS = 0.2;
      const elements = Array.from(root.querySelectorAll('*'));
      const transitioning = elements.filter((el) => getComputedStyle(el).transitionDuration !== '0s');
      const describe = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '');
      return {
        animations: elements.filter((el) => getComputedStyle(el).animationName !== 'none' && getComputedStyle(el).animationName !== '' && !el.classList.contains('spin')).length,
        gradients: elements.filter((el) => getComputedStyle(el).backgroundImage.includes('gradient')).length,
        blur: elements.filter((el) => getComputedStyle(el).backdropFilter !== 'none').length,
        unnamedProperties: transitioning
          .filter((el) => getComputedStyle(el).transitionProperty.split(',').map((part) => part.trim())
            .some((property) => !ALLOWED_PROPERTIES.includes(property)))
          .map((el) => `${describe(el)} => ${getComputedStyle(el).transitionProperty}`),
        slowTransitions: transitioning
          .filter((el) => getComputedStyle(el).transitionDuration.split(',')
            .some((duration) => Number.parseFloat(duration) > MAX_DURATION_SECONDS))
          .map((el) => `${describe(el)} => ${getComputedStyle(el).transitionDuration}`),
      };
    });
    expect(visualOverhead).toEqual({
      animations: 0,
      gradients: 0,
      blur: 0,
      unnamedProperties: [],
      slowTransitions: [],
    });
  });

  test('keeps active and disabled controls readable in dark theme', async ({ page }) => {
    await setTheme(page, 'dark');
    await settleTransitions(page);

    const contrast = await page.locator('.enterprise-shell').evaluate((root, helpers) => {
      const { ratioFor } = new Function(helpers)();
      return {
        activeTab: ratioFor(root, '.win-nav-item.active'),
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
        activeTab: ratioFor(root, '.win-nav-item.active'),
        activeCourier: ratioFor(root, '.courier-button.active'),
        driveLabel: ratioFor(root, '.drive-mode-label'),
        statusBanner: ratioFor(root, '.status-banner'),
        topbarTitle: ratioFor(root, '.win-app-name', '.win-titlebar'),
      };
    }, CONTRAST_HELPERS);

    await setTheme(page, 'light');
    await page.getByTestId('drive-tab').click();
    await settleTransitions(page);
    const light = await inspect();

    await setTheme(page, 'dark');
    await settleTransitions(page);
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
    await setTheme(page, 'light');
    await page.locator('.marketplace-upload-panel summary').click();
    await settleTransitions(page);

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

/*
 * เดิมชุดนี้ชื่อ "Mobile Responsiveness" และตรวจที่ 375px กับแถบแท็บบนจอ
 * ระบบเปลี่ยนเป็น Windows Enterprise Shell ซึ่งเป็น desktop-only แล้ว (ดู DESIGN.md ข้อ 1)
 * จึงเปลี่ยนมาตรวจความกว้างจอเดสก์ท็อปที่ DESIGN.md กำหนดไว้แทน คือ 1280 / 1440 / 1920
 * สิ่งที่ต้องคุ้มครองยังเป็นเรื่องเดิม: เมนูต้องอ่านได้ครบ ตารางต้องเลื่อนในกล่องของตัวเอง
 * และหน้าต้องไม่มี overflow แนวนอน
 */
test.describe('Scan to Sheet — Desktop layout', () => {
  for (const width of [1280, 1440, 1920]) {
    test(`shell holds together at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(BASE_URL);

      await expect(page.locator('.win-shell')).toBeVisible();
      await expect(page.locator('h1')).toBeVisible();

      const layout = await page.locator('.win-shell').evaluate((shell) => {
        const items = Array.from(shell.querySelectorAll('.win-nav-item'));
        const main = shell.querySelector('.win-main');
        return {
          navCount: items.length,
          navClipped: items.some((item) => item.scrollWidth > item.clientWidth),
          mainWidth: Math.round(main.getBoundingClientRect().width),
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        };
      });

      expect(layout.navCount).toBeGreaterThan(0);
      expect(layout.navClipped, `sidebar label clipped at ${width}px`).toBe(false);
      expect(layout.mainWidth).toBeGreaterThan(600);
      expect(layout.pageOverflow, `page overflow at ${width}px`).toBe(0);
      expect(layout.bodyOverflow, `body overflow at ${width}px`).toBe(0);

      // ตารางที่กว้างเกินต้องเลื่อนในกล่องของตัวเอง ไม่ใช่ดัน body
      const overflowX = await page.locator('.table-wrap').first()
        .evaluate((el) => window.getComputedStyle(el).overflowX);
      expect(overflowX).toBe('auto');
    });
  }
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

/**
 * ชุดนี้ล็อกบั๊กที่เจอตอนไล่ตรวจเปลือก Windows หลังย้ายระบบดีไซน์
 * ทุกข้อเคยพังจริงบนหน้าจอ ไม่ใช่การกันไว้ล่วงหน้า
 */
test.describe('Scan to Sheet — Shell regressions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('skip link jumps past the navigation, not to the shell that contains it', async ({ page }) => {
    // เดิม #main ชี้ที่ div ที่ครอบทั้ง menu bar และ sidebar ไว้ กดแล้วจึงไม่ได้ข้ามอะไรเลย
    const target = await page.evaluate(() => {
      const href = document.querySelector('.skip-link').getAttribute('href');
      const el = document.querySelector(href);
      return {
        tag: el?.tagName,
        hasSidebar: !!el?.querySelector('.win-sidebar'),
        hasMenubar: !!el?.querySelector('.win-menubar'),
      };
    });
    expect(target).toEqual({ tag: 'MAIN', hasSidebar: false, hasMenubar: false });

    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    const landed = await page.evaluate(() => ({
      inSidebar: !!document.activeElement?.closest('.win-sidebar'),
      inMenubar: !!document.activeElement?.closest('.win-menubar'),
    }));
    expect(landed).toEqual({ inSidebar: false, inMenubar: false });
  });

  test('drive toolbar does not offer a search it cannot perform', async ({ page }) => {
    // พาเนล Lookup ถูกเรนเดอร์เฉพาะโหมด Packer ปุ่มค้นหาบนโหมด Drive จึงเคยกดแล้วเงียบ
    await page.getByTestId('packer-tab').click();
    await expect(page.locator('.search-panel')).toHaveCount(1);
    await expect(page.locator('.win-tool-search')).toHaveCount(1);

    await page.getByTestId('drive-tab').click();
    await expect(page.locator('.search-panel')).toHaveCount(0);
    await expect(page.locator('.win-tool-search')).toHaveCount(0);
  });

  test('menu closes when focus leaves the menu bar', async ({ page }) => {
    // เดิมปิดด้วย mousedown นอกแถบกับ Escape เท่านั้น กด Tab ออกไปแล้วเมนูยังกางค้างทับเนื้อหา
    await page.locator('.win-menu-title').first().click();
    await expect(page.locator('.win-menu-pop')).toHaveCount(1);
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('Tab');
    await expect(page.locator('.win-menu-pop')).toHaveCount(0);
  });

  test('every grid carries its own row count', async ({ page }) => {
    for (const [tab, expected] of [['packer', 1], ['drive', 1], ['reports', 4]]) {
      await page.getByTestId(`${tab}-tab`).click();
      const headers = page.locator('.recent-header');
      await expect(headers).toHaveCount(expected);
      await expect(headers.locator('.grid-count')).toHaveCount(expected);
    }
  });
});

test.describe('Scan to Sheet — Design tokens and type scale', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('every token the stylesheet references actually resolves', async ({ page }) => {
    // src/styles.css เคยพังสองครั้งจาก comment ที่ไม่ปิด ซึ่งกลืนบรรทัดประกาศ token ที่ตามมา
    // ผลคือ `border: 2px solid var(--line-strong)` กลายเป็นค่าที่ใช้ไม่ได้ ขอบเลยหายทั้งเส้น
    // โดยไม่มี error ให้เห็น เทสต์นี้จับที่ต้นเหตุ ไม่ใช่ที่อาการ
    const unresolved = await page.evaluate(() => {
      const names = new Set();
      const walk = (list) => {
        for (const rule of list) {
          if (rule.style) {
            for (const match of rule.style.cssText.matchAll(/var\((--[\w-]+)/g)) names.add(match[1]);
          }
          if (rule.cssRules) walk(rule.cssRules);
        }
      };
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        walk(rules);
      }
      const root = getComputedStyle(document.documentElement);
      return [...names].filter((name) => !root.getPropertyValue(name).trim()).sort();
    });
    expect(unresolved).toEqual([]);
  });

  test('no visible text renders below 12px in either theme', async ({ page }) => {
    // พยัญชนะไทยมีสระบนและล่าง ที่ 10–11px สระซ้อนกันจนอ่านไม่ออกบนจอออฟฟิศ
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme);
      for (const tab of ['packer', 'drive', 'reports']) {
        await page.getByTestId(`${tab}-tab`).click();
        await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
        const tooSmall = await page.evaluate(() => {
          const found = [];
          document.querySelectorAll('.win-shell *').forEach((el) => {
            const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!ownText) return;
            const box = el.getBoundingClientRect();
            if (box.width < 4 || box.height < 4) return;
            const size = parseFloat(getComputedStyle(el).fontSize);
            if (size < 12) found.push(`${el.className || el.tagName} ${size}px`);
          });
          return [...new Set(found)];
        });
        expect(tooSmall, `${theme}/${tab}`).toEqual([]);
      }
    }
  });
});
