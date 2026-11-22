import { test, expect } from '@playwright/test';
import { openSignedInApp } from './mock-app.js';
import { auditRenderedContrast } from './visual-audit.js';

async function openPackerScanner(page) {
  await page.locator('.workspace-qr-panel').getByRole('button', { name: 'เลือก Flash', exact: true }).click();
  await page.locator('.popup-qr-packers').getByRole('button', { name: 'เลือก คนแพ็ค A', exact: true }).click();
}

test('two physical submissions persist distinct identities before writes and show one tracked order with duplicate totals', async ({ page }) => {
  await openSignedInApp(page, { physicalScans: true });
  await page.locator('.workspace-qr-panel').getByRole('button', { name: 'เลือก Flash', exact: true }).click();
  await page.locator('.popup-qr-packers').getByRole('button', { name: 'เลือก คนแพ็ค A', exact: true }).click();
  const input = page.locator('#popup-scan-input');
  for (let i = 0; i < 2; i += 1) {
    await input.fill('TH1234567890');
    await input.press('Enter');
    await expect.poll(() => page.evaluate(() => window.qrTestWrites.length)).toBe(i + 1);
  }
  const attempts = await page.evaluate(() => window.qrTestWrites.map(item => item.attempt));
  expect(attempts[0].id).not.toBe(attempts[1].id);
  expect(attempts[0]).toMatchObject({ actorUid: 'qr-test-user', role: 'packer', tracking: 'TH1234567890' });
  await expect(page.locator('.scan-count-summary').first()).toContainText('Packer 2');
  await expect(page.locator('.scan-count-summary').first()).toContainText('Packer ซ้ำ 1');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('scan-to-sheet:physical-scan-attempts:v1')).length)).toBe(0);
});

for (const failure of ['before', 'after']) {
  test(`reload retries the identical durable attempt after failure ${failure} commit without counting another scan`, async ({ page }) => {
    await page.addInitScript(() => {
      window.scanAudioStarts = 0;
      const original = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function (...args) { window.scanAudioStarts += 1; return original.apply(this, args); };
    });
    await openSignedInApp(page, { physicalScans: true });
    await openPackerScanner(page);
    await page.evaluate(value => { window.physicalScanFailure = value; }, failure);
    await page.locator('#popup-scan-input').fill('TH1234567890');
    await page.locator('#popup-scan-input').press('Enter');
    await expect.poll(() => page.evaluate(() => window.qrTestWrites.length)).toBe(1);
    await expect(page.locator('.scan-queue-status').first()).toContainText('รอยืนยัน');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('scan-to-sheet:physical-scan-attempts:v1'))[0]);
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.qrTestWrites.length)).toBe(1);
    const replay = await page.evaluate(() => window.qrTestWrites[0].attempt);
    expect(replay).toEqual(saved.context.attempt);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('scan-to-sheet:physical-scan-attempts:v1')).length)).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('physical-test-ledger')).packer)).toBe(1);
    expect(await page.evaluate(() => window.scanAudioStarts)).toBe(0);
  });
}

for (const [admin, packer] of [[1, 1], [2, 1], [1, 2]]) {
  test(`Tracking cell distinguishes Admin ${admin} and Packer ${packer} without claiming item quantity`, async ({ page }) => {
    await openSignedInApp(page, { physicalScans: true });
    await page.evaluate(({ admin, packer }) => localStorage.setItem('physical-test-ledger', JSON.stringify({ receipts: {}, admin, packer: packer - 1 })), { admin, packer });
    await openPackerScanner(page);
    await page.locator('#popup-scan-input').fill('TH1234567890');
    await page.locator('#popup-scan-input').press('Enter');
    const cell = page.locator('.scan-count-summary').first();
    await expect(cell).toContainText(`Admin ${admin} / Packer ${packer}`);
    await expect(cell).not.toContainText('เสี่ยงทำออเดอร์ซ้ำ');
    if (admin > 1) await expect(cell).toContainText('Admin ซ้ำ 1');
    if (packer > 1) await expect(cell).toContainText('Packer ซ้ำ 1');
    const packerCell = page.locator('[data-scan-role="packer"]').first();
    if (packer > 1) await expect(packerCell).toHaveClass(/scan-tracking-duplicate/);
    else await expect(packerCell).not.toHaveClass(/scan-tracking-duplicate/);
    await page.getByRole('dialog').getByRole('button', { name: 'ปิด', exact: true }).click();
    await page.getByTestId('drive-tab').click();
    const adminCell = page.locator('[data-scan-role="admin"]').first();
    await expect(adminCell).toContainText(`Admin ${admin}`);
    if (admin > 1) await expect(adminCell).toHaveClass(/scan-tracking-duplicate/);
    else await expect(adminCell).not.toHaveClass(/scan-tracking-duplicate/);
    if (packer > 1) await expect(page.locator('[data-scan-role="packer"]').first()).toHaveClass(/scan-tracking-duplicate/);
    else await expect(page.locator('[data-scan-role="packer"]').first()).not.toHaveClass(/scan-tracking-duplicate/);
  });
}

test('camera stationary frames do not create attempts and a removed then presented barcode creates one new attempt', async ({ page }) => {
  await openSignedInApp(page, { physicalScans: true, cameraCallbacks: true });
  await openPackerScanner(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'กล้อง', exact: true }).click();
  await dialog.getByRole('button', { name: 'เปิดกล้อง', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.cameraDetected)).toBe('function');
  await page.evaluate(async () => {
    window.cameraTestNow = Date.now();
    Date.now = () => window.cameraTestNow;
    await window.cameraDetected('TH1234567890');
  });
  await expect.poll(() => page.evaluate(() => window.qrTestWrites.length)).toBe(1);
  await page.evaluate(async () => {
    window.cameraTestNow += 10000;
    await window.cameraDetected('TH1234567890');
    await window.cameraDetected('TH1234567890');
  });
  expect(await page.evaluate(() => window.qrTestWrites.length)).toBe(1);
  await page.evaluate(async () => {
    window.cameraTestNow += 3000;
    window.cameraMissed();
    await window.cameraDetected('TH1234567890');
  });
  await expect.poll(() => page.evaluate(() => window.qrTestWrites.length)).toBe(2);
  expect(await page.evaluate(() => window.qrTestWrites.map(item => item.attempt.source))).toEqual(['camera', 'camera']);
});

test('two scans by both roles show the Thai risk warning and keep the table readable in both themes', async ({ page }) => {
  await openSignedInApp(page, { physicalScans: true });
  await page.evaluate(() => localStorage.setItem('physical-test-ledger', JSON.stringify({ receipts: {}, admin: 2, packer: 1 })));
  await openPackerScanner(page);
  await page.locator('#popup-scan-input').fill('TH1234567890');
  await page.locator('#popup-scan-input').press('Enter');
  const cell = page.locator('.scan-tracking-duplicate').first();
  await expect(cell).toContainText('Admin 2 / Packer 2');
  await expect(cell).toContainText('Admin ซ้ำ 1');
  await expect(cell).toContainText('เสี่ยงทำออเดอร์ซ้ำ ต้องตรวจสอบ');
  await page.getByRole('dialog').getByRole('button', { name: 'ปิด', exact: true }).click();
  await cell.scrollIntoViewIfNeeded();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await page.addStyleTag({ content: '*{transition:none !important;animation:none !important}' });
    const contrast = await page.evaluate(auditRenderedContrast);
    expect(contrast.textFailures).toEqual([]);
    expect(contrast.controlFailures).toEqual([]);
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    }
    await page.screenshot({ path: `test-results/.codex-tmp-physical-scans-${theme}.png`, fullPage: true });
  }
});

test('retries a failed durable scan after reconnect without reload or replay sound', async ({ page }) => {
  await page.addInitScript(() => {
    window.scanAudioStarts = 0;
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (...args) { window.scanAudioStarts += 1; return original.apply(this, args); };
  });
  await openSignedInApp(page, { physicalScans: true });
  await openPackerScanner(page);
  await page.evaluate(() => { window.physicalScanFailure = 'before'; });
  await page.locator('#popup-scan-input').fill('TH1234567890');
  await page.locator('#popup-scan-input').press('Enter');
  await expect(page.locator('.scan-queue-status').first()).toContainText('รอยืนยัน');
  const attempt = await page.evaluate(() => window.qrTestWrites[0].attempt);
  const sounds = await page.evaluate(() => window.scanAudioStarts);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.qrTestWrites.length)).toBe(1);
  await page.evaluate(() => { window.physicalScanFailure = null; });
  await expect.poll(() => page.evaluate(() => window.qrTestWrites.length)).toBe(2);
  expect(await page.evaluate(() => window.qrTestWrites[1].attempt)).toEqual(attempt);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('scan-to-sheet:physical-scan-attempts:v1')).length)).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('physical-test-ledger')).packer)).toBe(1);
  expect(await page.evaluate(() => window.scanAudioStarts)).toBe(sounds);
});
