import { test, expect } from '@playwright/test';
import { createCourierQrCommand, createPackerQrCommand } from '../../src/services/scanQrCommand.js';
import { auditRenderedContrast } from './visual-audit.js';

import { openSignedInApp } from './mock-app.js';

test('courier and Packer QR clicks select, keep the popup open and return focus without writing a scan', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSignedInApp(page);
  await page.locator('#scan-input').fill('PARTIAL');
  await page.locator('.workspace-qr-panel').getByRole('button', { name: 'เลือก Flash', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.popup-courier select')).toHaveValue('Flash');
  await expect(page.locator('#popup-scan-input')).toBeFocused();
  await expect(page.locator('#popup-scan-input')).toHaveValue('');

  const packers = page.locator('.popup-qr-packers');
  await packers.getByRole('button', { name: 'เลือก คนแพ็ค A', exact: true }).click();
  await expect(page.locator('.popup-packer select')).toHaveValue('คนแพ็ค A');
  await expect(packers.getByRole('button', { name: 'เลือก คนแพ็ค A', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#popup-scan-input')).toBeFocused();

  const nextPacker = packers.getByRole('button', { name: 'เลือก คนแพ็ค B', exact: true });
  await nextPacker.focus();
  await nextPacker.press('Space');
  await expect(page.locator('.popup-packer select')).toHaveValue('คนแพ็ค B');
  await expect(page.locator('#popup-scan-input')).toBeFocused();

  const couriers = page.locator('.popup-qr-couriers');
  const nextCourier = couriers.getByRole('button', { name: 'เลือก J&T', exact: true });
  await nextCourier.focus();
  await nextCourier.press('Enter');
  await expect(page.locator('.popup-courier select')).toHaveValue('J&T');
  await expect(page.locator('.popup-packer select')).toHaveValue('ยังไม่ระบุ');
  await expect(nextCourier).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('dialog')).toBeVisible();

  // Existing scanner payloads must continue to select the same controls after clicking.
  await page.locator('#popup-scan-input').fill(createPackerQrCommand('qr-a'));
  await page.locator('#popup-scan-input').press('Enter');
  await expect(page.locator('.popup-packer select')).toHaveValue('คนแพ็ค A');
  await page.locator('#popup-scan-input').fill(createCourierQrCommand('packer', 'Flash'));
  await page.locator('#popup-scan-input').press('Enter');
  await expect(page.locator('.popup-courier select')).toHaveValue('Flash');
  await expect(page.locator('.popup-packer select')).toHaveValue('ยังไม่ระบุ');
  await expect(page.locator('#popup-scan-input')).toBeFocused();
  expect(await page.evaluate(() => window.qrTestWrites)).toEqual([]);

  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.locator('.scan-popup-overlay').evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
  }
});

test('Admin workspace QR click opens the Admin scanner', async ({ page }) => {
  await openSignedInApp(page);
  await page.getByTestId('drive-tab').click();
  await page.locator('.workspace-qr-panel').getByRole('button', { name: 'เลือก Flash', exact: true }).click();
  await expect(page.locator('.scan-popup-sheet')).toHaveClass(/workflow-drive/);
  await expect(page.locator('.popup-courier select')).toHaveValue('Flash');
  await expect(page.locator('#popup-scan-input')).toBeFocused();
  expect(await page.evaluate(() => window.qrTestWrites)).toEqual([]);
});

test('signed-out QR cards remain scannable images but cannot change the workflow by clicking', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('packer-tab').click();
  const card = page.locator('.workspace-qr-panel .scan-qr-card').first();
  await expect(card).toBeDisabled();
  await expect(card.locator('img')).toBeVisible();
  expect(await card.locator('img').evaluate(img => img.naturalWidth)).toBe(512);
});

test('rendered QR controls and workflow text are readable in both themes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSignedInApp(page);
  await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) {
      await page.locator('.win-titlebar-btn').filter({ hasText: /โหมด/ }).click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const tab of ['packer', 'drive']) {
      await page.getByTestId(`${tab}-tab`).click();
      const audit = await page.evaluate(auditRenderedContrast);
      expect(audit.textFailures, `${theme}/${tab} text`).toEqual([]);
      expect(audit.controlFailures, `${theme}/${tab} QR borders`).toEqual([]);
      expect(audit.controlCount).toBeGreaterThan(0);
      for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByTestId('packer-tab').click();
    const scanBox = await page.locator('#scan-input').boundingBox();
    expect(scanBox.y).toBeLessThan(500);
    await page.screenshot({ path: testInfo.outputPath(`workspace-${theme}.png`) });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId('packer-tab').click();
    await page.locator('.workspace-qr-panel').getByRole('button', { name: 'เลือก Flash', exact: true }).click();
    const selected = page.locator('.popup-qr-packers').getByRole('button', { name: 'เลือก คนแพ็ค A', exact: true });
    await selected.click();
    await selected.focus();
    const audit = await page.evaluate(auditRenderedContrast);
    expect(audit.textFailures, `${theme}/popup text`).toEqual([]);
    expect(audit.controlFailures, `${theme}/popup QR borders`).toEqual([]);
    expect(await page.locator('.popup-qr-panel .scan-qr-card strong').evaluateAll(labels => labels.filter(label => label.scrollWidth > label.clientWidth).length)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`qr-popup-${theme}.png`) });
    await page.getByRole('button', { name: 'ปิดหน้าต่างสแกน', exact: true }).click();
  }
});
