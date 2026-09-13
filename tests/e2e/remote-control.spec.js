import { test, expect } from '@playwright/test';
import { openRemoteApp } from './mock-app.js';
import { auditRenderedContrast } from './visual-audit.js';

const BOARDS = {
  packer: { courier: 'Flash', packer: 'คนแพ็ค A', origin: 'desktop' },
  drive: { courier: 'Shopee', packer: 'ยังไม่ระบุ', origin: 'desktop' },
};

test('the remote path loads its own tree instead of the desktop shell', async ({ page }) => {
  await openRemoteApp(page, { boards: BOARDS });
  await expect(page.locator('.enterprise-shell')).toHaveCount(0);
  await expect(page.locator('.win-titlebar')).toHaveCount(0);
  await expect(page.locator('.win-sidebar')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'รีโมทสแกน' })).toBeVisible();
});

test('choosing a courier sends one command from the remote', async ({ page }) => {
  await openRemoteApp(page, { boards: BOARDS });
  await page.getByRole('button', { name: 'J&T', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.remoteTestWrites.length)).toBe(1);
  const write = await page.evaluate(() => window.remoteTestWrites[0]);
  expect(write.courier).toBe('J&T');
  expect(write.packer).toBe('คนแพ็ค A');
  expect(write.origin).toBe('remote');
});

test('the echo of its own command produces no second write', async ({ page }) => {
  // This is the loop guard at integration level: without it the two sides write to each other
  // for as long as the app is open.
  await openRemoteApp(page, { boards: BOARDS });
  await page.getByRole('button', { name: 'J&T', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.remoteTestWrites.length)).toBe(1);
  await page.evaluate(() => window.remotePushBoard({ courier: 'J&T', packer: 'คนแพ็ค A', origin: 'remote' }));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.remoteTestWrites.length)).toBe(1);
});

test('a selection made at the desktop shows up on the remote', async ({ page }) => {
  await openRemoteApp(page, { boards: BOARDS });
  await page.evaluate(() => window.remotePushBoard({ courier: 'Shopee', packer: 'คนแพ็ค B', origin: 'desktop' }));
  await expect(page.locator('.remote-now-value')).toContainText('Shopee');
  await expect(page.locator('.remote-now-value')).toContainText('คนแพ็ค B');
  await expect(page.getByRole('button', { name: 'Shopee', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.remote-foot')).toContainText('เครื่องคอม');
});

test('every control is thumb sized and the page never scrolls sideways', async ({ page }) => {
  await openRemoteApp(page, { boards: BOARDS });
  const buttons = await page.locator('.remote-app button').all();
  expect(buttons.length).toBeGreaterThan(5);
  for (const button of buttons) {
    const box = await button.boundingBox();
    expect(box.height, await button.textContent()).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test('remote text and controls stay readable in both themes', async ({ page }) => {
  await openRemoteApp(page, { boards: BOARDS });
  // Measuring mid-transition reports colours that are not on screen in either theme.
  await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((next) => {
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
    }, theme);
    const result = await page.evaluate(auditRenderedContrast);
    expect(result.textCount, theme).toBeGreaterThan(10);
    expect(result.textFailures, `${theme}: text`).toEqual([]);
    expect(result.controlFailures, `${theme}: controls`).toEqual([]);
  }
});

test('the remote opens on the packing room and each mode drives its own board', async ({ page }) => {
  // The desktop shares one selectedCourier between Packer and Drive, so a shared board would
  // let the packing room retarget the courier under an Admin receiving parcels into Drive.
  await openRemoteApp(page, { boards: BOARDS });
  expect(await page.evaluate(() => window.remoteSubscribedTab)).toBe('packer');
  await expect(page.getByRole('tab', { name: 'ห้องแพ็ค' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.remote-now-value')).toContainText('Flash');

  await page.getByRole('tab', { name: 'ลง Drive' }).click();
  await expect.poll(() => page.evaluate(() => window.remoteSubscribedTab)).toBe('drive');
  await expect(page.locator('.remote-now-value')).toContainText('Shopee');

  await page.getByRole('button', { name: 'J&T', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.remoteTestWrites.length)).toBe(1);
  expect(await page.evaluate(() => window.remoteTestWrites[0].tab)).toBe('drive');
});

test('the Drive mode offers no packer at all', async ({ page }) => {
  await openRemoteApp(page, { boards: BOARDS });
  await expect(page.getByRole('heading', { name: 'คนแพ็ค' })).toBeVisible();
  await page.getByRole('tab', { name: 'ลง Drive' }).click();
  await expect(page.getByRole('heading', { name: 'คนแพ็ค' })).toHaveCount(0);
  await expect(page.locator('.remote-now-value')).not.toContainText('ยังไม่ระบุ');
});
