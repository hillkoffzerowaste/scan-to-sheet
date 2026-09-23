import { test, expect } from '@playwright/test';
import { openSignedInApp } from './mock-app.js';

test.describe.configure({ timeout: 60000 });

test('Firebase Admin can open and maintain the external tools settings page', async ({ page }) => {
  await openSignedInApp(page, { staffAdmin: true });

  await expect(page.getByTestId('external-tools-settings-tab')).toBeVisible();
  await page.getByTestId('external-tools-settings-tab').click();
  await expect(page.getByTestId('external-tools-settings')).toBeVisible();

  const group = page.getByTestId('external-tools-group-external-tools');
  await group.getByLabel('ชื่อหมวด 1').fill('ระบบที่ใช้งานประจำ');
  await group.getByRole('button', { name: 'เพิ่มลิงก์' }).click();
  await group.getByLabel('ชื่อเครื่องมือ 7').fill('คู่มือหน้างาน');
  await group.getByLabel('ลิงก์ URL').last().fill('https://manual.example.com/');
  await page.getByTestId('external-tools-save').click();

  await expect(page.getByRole('heading', { name: 'ระบบที่ใช้งานประจำ' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'คู่มือหน้างาน' })).toHaveAttribute('href', 'https://manual.example.com/');
  expect(await page.evaluate(() => window.externalToolsWrites)).toHaveLength(1);
});

test('non-Admin staff can use external tools but cannot see the settings page', async ({ page }) => {
  await openSignedInApp(page, { staffAdmin: false });

  await expect(page.getByTestId('delivery-system-link')).toBeVisible();
  await expect(page.getByTestId('external-tools-settings-tab')).toHaveCount(0);
  await expect(page.getByTestId('external-tools-settings')).toHaveCount(0);
});
