import { test, expect } from '@playwright/test';
import { openSignedInApp } from './mock-app.js';
import { auditRenderedContrast } from './visual-audit.js';

async function setTheme(page, theme) {
  await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
  if (await page.locator('html').getAttribute('data-theme') !== theme) {
    await page.locator('.win-titlebar button[title*="โหมด"]').click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function audit(page, label) {
  const result = await page.evaluate(auditRenderedContrast);
  expect(result.textCount, label).toBeGreaterThan(10);
  expect(result.textFailures, `${label}: text`).toEqual([]);
  expect(result.controlFailures, `${label}: controls`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), label).toBe(0);
  expect(await page.locator('.win-main').evaluate(el => el.scrollWidth - el.clientWidth), `${label}: main overflow`).toBe(0);
}

test('dashboard is the default workspace and signed-out users see an empty state', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('dashboard-tab')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.win-app-name')).toHaveText('HILLKOFF WMS');
  await expect(page.locator('#dashboard-title')).toHaveText('ศูนย์ควบคุมงาน');
  await expect(page.locator('.wms-dashboard-login-state')).toContainText('เข้าสู่ระบบเพื่อดูข้อมูลจริง');
  await expect(page.getByTestId('google-sign-in')).toBeVisible();
});

test('dashboard uses the signed-in data surface and navigates to both workspaces', async ({ page }) => {
  await openSignedInApp(page, { startTab: 'dashboard' });
  await expect(page.locator('.wms-kpi-grid')).toBeVisible();
  await expect(page.locator('.wms-empty-state')).toContainText('ยังไม่มีรายการในขอบเขตนี้');

  await page.getByTestId('packer-tab').click();
  await expect(page.locator('.workspace-page-title')).toContainText('Packer');
  await page.getByTestId('drive-tab').click();
  await expect(page.locator('.workspace-page-title')).toContainText('Admin');
  await page.getByTestId('dashboard-tab').click();
  await expect(page.locator('#dashboard-title')).toHaveText('ศูนย์ควบคุมงาน');
  expect(await page.evaluate(() => window.qrTestWrites)).toEqual([]);
});

test('single app bar, labeled collapsed navigation and global commands keep their destinations', async ({ page }) => {
  await openSignedInApp(page);
  await expect(page.locator('.win-menubar')).toHaveCount(0);
  expect((await page.locator('.win-titlebar').boundingBox()).height).toBe(56);
  expect((await page.locator('.win-sidebar').boundingBox()).width).toBe(224);
  await page.getByRole('button', { name: 'ยุบเมนู', exact: true }).click();
  expect((await page.locator('.win-sidebar').boundingBox()).width).toBe(64);
  await expect(page.getByTestId('packer-tab')).toHaveAccessibleName('แพ็กสินค้า (Packer)');
  await expect(page.getByTestId('delivery-system-link')).toHaveAccessibleName('ระบบส่งของ');
  await page.getByTestId('reports-tab').click();
  const summary = page.locator('.app-tools-menu summary');
  const popover = page.locator('.app-tools-popover');
  await summary.focus();
  await summary.press('Enter');
  await expect(popover).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(summary).toBeFocused();
  await summary.click();
  await popover.getByRole('button', { name: 'ตรวจออเดอร์ที่หาย', exact: true }).click();
  await expect(page.getByTestId('drive-tab')).toHaveAttribute('aria-current', 'page');
  await expect(popover).toBeHidden();
  await expect(page.locator('.workspace-page-title')).toContainText('Admin');
  await summary.click();
  await page.locator('.workspace-page-title').click();
  await expect(popover).toBeHidden();
  await summary.click();
  await popover.getByRole('button', { name: 'รีเฟรชข้อมูลวันนี้' }).click();
  await expect(popover).toBeHidden();
  expect(await page.evaluate(() => window.qrTestWrites)).toEqual([]);
});

test('report modes pass the same dates to the service and keep the report tables', async ({ page }) => {
  await openSignedInApp(page);
  await page.getByTestId('reports-tab').click();
  const panel = page.locator('.report-panel');
  await expect(panel).toHaveJSProperty('tagName', 'SECTION');
  await panel.locator('input[type=date]').fill('2026-09-09');
  await panel.getByRole('button', { name: 'สร้างรายงาน', exact: true }).click();
  await expect(panel.locator('.report-badge')).toContainText('1 รายการ');
  await expect.poll(() => page.evaluate(() => window.reportTestDates)).toEqual(['2026-09-09']);
  await panel.getByRole('button', { name: 'ช่วงวันที่', exact: true }).click();
  await panel.locator('input[type=date]').nth(0).fill('2026-09-09');
  await panel.locator('input[type=date]').nth(1).fill('2026-09-10');
  await panel.getByRole('button', { name: 'สร้างรายงาน', exact: true }).click();
  await expect(panel.locator('.report-badge')).toContainText('2 รายการ');
  await expect(panel.locator('.report-table').first().locator('tbody tr')).toHaveCount(2);
  await panel.getByRole('button', { name: 'รายเดือน', exact: true }).click();
  await panel.locator('input[type=month]').fill('2026-08');
  await panel.getByRole('button', { name: 'สร้างรายงาน', exact: true }).click();
  await expect(panel.locator('.report-badge')).toContainText('31 รายการ');
  await expect(panel.locator('.report-table')).toHaveCount(4);
  expect(await page.evaluate(() => window.qrTestWrites)).toEqual([]);
});

test('staff permissions remain enforced in the redesigned directory', async ({ page }) => {
  await openSignedInApp(page, { staffAdmin: false });
  await page.getByTestId('staff-tab').click();
  await expect(page.locator('.staff-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'เพิ่มพนักงาน', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'พิมพ์ QR จุดสแกน' })).toHaveCount(0);
});

for (const theme of ['light', 'dark']) {
  test(`all workspaces, staff dialog and print region remain readable in ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(90000);
    await openSignedInApp(page);
    await setTheme(page, theme);
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 });
      for (const tab of ['dashboard', 'packer', 'drive', 'reports', 'staff']) {
        await page.getByTestId(`${tab}-tab`).click();
        if (tab === 'staff') await expect(page.locator('.staff-card')).toHaveCount(2);
        if (tab === 'reports') {
          await page.getByRole('button', { name: 'สร้างรายงาน', exact: true }).click();
          await expect(page.locator('.report-badge')).toContainText('1 รายการ');
        }
        await audit(page, `${theme}/${width}/${tab}`);
        const clipped = await page.locator('.win-nav-label, .segmented-control button span, .scan-qr-card strong').evaluateAll(nodes => nodes.filter(el => el.checkVisibility() && el.scrollWidth > el.clientWidth + 1).map(el => el.textContent));
        expect(clipped).toEqual([]);
        if (tab === 'packer') expect((await page.locator('#scan-input').boundingBox()).y).toBeLessThan(500);
        if (width === 1440) await page.screenshot({ path: testInfo.outputPath(`${tab}-${theme}.png`) });
      }
      await page.locator('.staff-section-tabs').getByRole('button', { name: 'หน้าที่ประจำวัน', exact: true }).click();
      await audit(page, `${theme}/${width}/schedule`);
    }
    await page.locator('.staff-section-tabs').getByRole('button', { name: 'แผนผังพนักงาน', exact: true }).click();
    await page.getByRole('button', { name: 'เพิ่มพนักงาน', exact: true }).click();
    await expect(page.locator('.staff-modal')).toBeVisible();
    await audit(page, `${theme}/staff-dialog`);
    await page.screenshot({ path: testInfo.outputPath(`staff-dialog-${theme}.png`) });
    await page.locator('.staff-modal header button').click();
    await page.getByRole('button', { name: 'พิมพ์ QR จุดสแกน' }).click();
    await expect(page.locator('.qr-print-card img').first()).toBeVisible();
    await audit(page, `${theme}/qr-print-dialog`);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.qr-print-sheet')).toBeVisible();
    await expect(page.locator('.qr-print-card img').first()).toBeInViewport();
    await expect(page.locator('.duty-print-sheet')).toBeHidden();
    await expect(page.locator('.qr-print-actions')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath(`qr-print-${theme}.png`), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    await page.getByRole('button', { name: 'ปิดหน้าพิมพ์ QR', exact: true }).click();
    await page.locator('.staff-section-tabs').getByRole('button', { name: 'หน้าที่ประจำวัน', exact: true }).click();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.duty-print-sheet')).toBeVisible();
    await expect(page.locator('.win-titlebar')).toBeHidden();
    await expect(page.locator('.duty-print-sheet .weekly-grid')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`schedule-print-${theme}.png`), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    expect(await page.evaluate(() => window.qrTestWrites)).toEqual([]);
  });
}

test('the root path still loads the desktop shell after the remote route was added', async ({ page }) => {
  // isRemoteRoute must not match "/" — a startsWith check would have taken the whole app away.
  await openSignedInApp(page);
  await expect(page.locator('.win-titlebar')).toHaveCount(1);
  await expect(page.locator('.remote-app')).toHaveCount(0);
});
