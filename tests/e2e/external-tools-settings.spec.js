import { test, expect } from '@playwright/test';
import { openSignedInApp } from './mock-app.js';

test.describe.configure({ timeout: 60000 });

test('Firebase Admin can open and maintain the external tools settings page', async ({ page }) => {
  await openSignedInApp(page, { staffAdmin: true });

  await expect(page.getByTestId('external-tools-settings-tab')).toBeVisible();
  await page.getByTestId('external-tools-settings-tab').click();
  await expect(page.getByTestId('external-tools-settings')).toBeVisible();

  const group = page.getByTestId('external-tools-group-external-tools');
  await page.getByLabel('ขนาดตัวอักษร sidebar').selectOption('large');
  const colorPicker = group.getByLabel('สีแถบ').nth(1);
  await expect(colorPicker.locator('option')).toHaveCount(10);
  await colorPicker.selectOption('cyan');
  await group.getByLabel('ชื่อหมวด 1').fill('ระบบที่ใช้งานประจำ');
  await group.getByRole('button', { name: 'เพิ่มลิงก์' }).click();
  await group.getByLabel('ชื่อเครื่องมือ 7').fill('คู่มือหน้างาน');
  await group.getByLabel('ลิงก์ URL').last().fill('https://manual.example.com/');
  await page.getByTestId('external-tools-save').click();

  await expect(page.getByRole('heading', { name: 'ระบบที่ใช้งานประจำ' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'คู่มือหน้างาน' })).toHaveAttribute('href', 'https://manual.example.com/');
  const externalLink = page.getByTestId('wrong-delivery-link');
  await expect(externalLink).toHaveClass(/external-accent-cyan/);
  const linkStyle = await externalLink.evaluate((link) => {
    const style = getComputedStyle(link);
    return {
      background: style.backgroundColor,
      borderLeftWidth: style.borderLeftWidth,
      borderTopColor: style.borderTopColor,
      borderBottomColor: style.borderBottomColor,
      fontSize: style.fontSize,
    };
  });
  expect(linkStyle.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(linkStyle.borderLeftWidth).toBe('4px');
  expect(linkStyle.borderTopColor).not.toBe(linkStyle.borderBottomColor);
  expect(linkStyle.fontSize).toBe('16px');
  const writes = await page.evaluate(() => window.externalToolsWrites);
  expect(writes).toHaveLength(1);
  expect(writes[0].sidebarTextSize).toBe('large');
  expect(writes[0].groups[0].links.find((link) => link.id === 'wrong-delivery').accentColor).toBe('cyan');
});

test('non-Admin staff can use external tools but cannot see the settings page', async ({ page }) => {
  await openSignedInApp(page, { staffAdmin: false });

  await expect(page.getByTestId('delivery-system-link')).toBeVisible();
  await expect(page.getByTestId('external-tools-settings-tab')).toHaveCount(0);
  await expect(page.getByTestId('external-tools-settings')).toHaveCount(0);
});
