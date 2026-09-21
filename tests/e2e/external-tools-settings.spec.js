import { test, expect } from '@playwright/test';
import { DEFAULT_EXTERNAL_TOOLS_CONFIG } from '../../src/features/externalTools/externalToolsConfig.js';
import { openSignedInApp } from './mock-app.js';

const DEFAULT_LINKS = [
  ['delivery-system-link', 'ระบบส่งของ', 'https://repo-rho-livid.vercel.app/'],
  ['wrong-delivery-link', 'จัดการส่งของผิด', 'https://script.google.com/a/macros/hillkoff.com/s/AKfycbxQENSgzP-0IzDX0J_pY2g9HoMlCKMaNQYJlnxPbudqELr79oKdwYpoNflqrSAfsgw2/exec'],
  ['label-checker-link', 'พิมพ์ใบเช็ค ใบปะหน้า', 'https://barcode-checker-ashy.vercel.app/'],
  ['coffee-stock-link', 'เบิกออก/รับเข้ากาแฟถัง', 'https://script.google.com/a/macros/hillkoff.com/s/AKfycbxETrRx_gJBuVTdl2MUaumr5Pem4LzahebQ6HZzrknPOr-PPCPmJHQ0I9f-p-kYJB-J/exec'],
  ['coffee-shop-grinder-link', 'บดกาแฟหน้าร้าน', 'https://coffee-grinder-system.vercel.app/'],
  ['coffee-stock-count-link', 'ตรวจนับสต็อกกาแฟ', 'https://script.google.com/macros/s/AKfycbyulSX89Q-eXvcd33QypMp8uP2_PrqjGjpBiYre_j2rJDXg74dNqGQ44jBgU1N_WNIXnA/exec'],
];

function configWithExistingGroup() {
  return {
    groups: [
      {
        ...DEFAULT_EXTERNAL_TOOLS_CONFIG.groups[0],
        links: DEFAULT_EXTERNAL_TOOLS_CONFIG.groups[0].links.map((link) => ({ ...link })),
      },
      {
        id: 'legacy-group',
        name: 'หมวดเดิม',
        links: [{ id: 'legacy-link', label: 'ลิงก์เดิม', url: 'https://legacy.example.com/' }],
      },
    ],
  };
}

function configAtLimits() {
  return {
    groups: Array.from({ length: 10 }, (_, groupIndex) => ({
      id: 'limit-group-' + groupIndex,
      name: 'หมวด ' + (groupIndex + 1),
      links: Array.from({ length: 10 }, (_, linkIndex) => ({
        id: 'limit-link-' + groupIndex + '-' + linkIndex,
        label: 'ลิงก์ ' + linkIndex,
        url: 'https://example.com/' + groupIndex + '/' + linkIndex,
      })),
    })),
  };
}

async function expectDefaultLinks(page) {
  for (const [testId, label, href] of DEFAULT_LINKS) {
    const link = page.getByTestId(testId);
    await expect(link).toHaveAccessibleName(label);
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
}

test('shows external tools settings only to Firebase Admins', async ({ page }) => {
  await openSignedInApp(page, { staffAdmin: true });

  await expectDefaultLinks(page);
  await expect(page.getByTestId('external-tools-settings-tab')).toBeVisible();
  await page.getByTestId('external-tools-settings-tab').click();
  await expect(page.locator('.external-tools-settings')).toBeVisible();
});

test('non-Admin staff can use external tools but cannot open settings', async ({ page }) => {
  await openSignedInApp(page, { staffAdmin: false });

  await expectDefaultLinks(page);
  await expect(page.getByTestId('external-tools-settings-tab')).toHaveCount(0);
  await expect(page.locator('.external-tools-settings')).toHaveCount(0);
});

test('Admin can rename groups, edit and remove links, and add groups and links', async ({ page }) => {
  await openSignedInApp(page, { externalToolsConfig: configWithExistingGroup() });
  await page.getByTestId('external-tools-settings-tab').click();

  const originalGroup = page.getByTestId('external-tools-group-external-tools');
  await originalGroup.getByLabel('ชื่อหมวด 1').fill('ระบบคลัง');
  const deliveryLink = originalGroup.getByTestId('external-tools-link-delivery-system');
  await deliveryLink.getByLabel('ชื่อเครื่องมือ 1').fill('ระบบคลังสินค้า');
  await deliveryLink.getByLabel('ลิงก์ URL').fill('https://inventory.example.com/');
  await originalGroup.getByTestId('external-tools-link-coffee-shop-grinder')
    .getByRole('button', { name: 'ลบลิงก์ บดกาแฟหน้าร้าน' }).click();
  await originalGroup.getByRole('button', { name: 'เพิ่มลิงก์' }).click();
  await originalGroup.getByLabel('ชื่อเครื่องมือ 6').fill('รายงานคลัง');
  await originalGroup.getByLabel('ลิงก์ URL').last().fill('https://inventory.example.com/reports');

  await page.getByTestId('external-tools-save').click();
  await expect(page.getByRole('heading', { name: 'ระบบคลัง' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ระบบคลังสินค้า' })).toHaveAttribute('href', 'https://inventory.example.com/');
  await expect(page.getByRole('link', { name: 'รายงานคลัง' })).toHaveAttribute('href', 'https://inventory.example.com/reports');
  await expect(page.getByTestId('coffee-shop-grinder-link')).toHaveCount(0);
  expect(await page.evaluate(() => window.externalToolsWrites)).toHaveLength(1);

  await page.getByRole('button', { name: 'เพิ่มหมวด' }).click();
  const newGroup = page.locator('.external-tools-group').nth(2);
  await newGroup.getByLabel('ชื่อหมวด 3').fill('คลังเสริม');
  await newGroup.getByRole('button', { name: 'เพิ่มลิงก์' }).click();
  await newGroup.getByLabel('ชื่อเครื่องมือ 1').fill('คู่มือสต็อก');
  await newGroup.getByLabel('ลิงก์ URL').fill('https://inventory.example.com/guide');
  await page.getByTestId('external-tools-save').click();

  await expect(page.getByRole('heading', { name: 'คลังเสริม' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'คู่มือสต็อก' })).toHaveAttribute('href', 'https://inventory.example.com/guide');
  expect(await page.evaluate(() => window.externalToolsWrites)).toHaveLength(2);

  const existingGroup = page.getByTestId('external-tools-group-legacy-group');
  await expect(page.getByRole('link', { name: 'ลิงก์เดิม' })).toBeVisible();
  let cancelMessage = '';
  const cancelDialog = page.waitForEvent('dialog').then(async (dialog) => {
    cancelMessage = dialog.message();
    await dialog.dismiss();
  });
  await Promise.all([
    cancelDialog,
    existingGroup.getByRole('button', { name: 'ลบหมวด หมวดเดิม' }).click(),
  ]);
  expect(cancelMessage).toContain('ลิงก์ 1 รายการ');
  await expect(existingGroup).toBeVisible();
  expect(await page.evaluate(() => window.externalToolsWrites)).toHaveLength(2);

  const acceptDialog = page.waitForEvent('dialog').then((dialog) => dialog.accept());
  await Promise.all([
    acceptDialog,
    existingGroup.getByRole('button', { name: 'ลบหมวด หมวดเดิม' }).click(),
  ]);
  await expect(existingGroup).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'ลิงก์เดิม' })).toBeVisible();
  await page.getByTestId('external-tools-save').click();
  await expect(page.getByRole('heading', { name: 'หมวดเดิม' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'ลิงก์เดิม' })).toHaveCount(0);
  expect(await page.evaluate(() => window.externalToolsWrites)).toHaveLength(3);
});

test('invalid URLs show a stable validation code without writing', async ({ page }) => {
  await openSignedInApp(page);
  await page.getByTestId('external-tools-settings-tab').click();

  await page.getByTestId('external-tools-link-url-delivery-system').fill('javascript:alert(1)');
  await page.getByTestId('external-tools-save').click();
  await expect(page.locator('[data-error-code="EXTERNAL_TOOLS_INVALID"]')).toBeVisible();
  expect(await page.evaluate(() => window.externalToolsWrites)).toEqual([]);
});

test('read errors disable editing and saving', async ({ page }) => {
  await openSignedInApp(page, { externalToolsReadError: true });
  await page.getByTestId('external-tools-settings-tab').click();

  await expect(page.locator('[data-error-code="EXTERNAL_TOOLS_READ_FAILED"]')).toBeVisible();
  await expect(page.getByTestId('external-tools-group-name-external-tools')).toBeDisabled();
  await expect(page.getByTestId('external-tools-save')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'เพิ่มหมวด' })).toBeDisabled();
  expect(await page.evaluate(() => window.externalToolsWrites)).toEqual([]);
});

test('group and link limits prevent writes past the shared configuration limits', async ({ page }) => {
  test.setTimeout(60000);
  await openSignedInApp(page, { externalToolsConfig: configAtLimits() });
  await page.getByTestId('external-tools-settings-tab').click();

  await expect(page.getByRole('button', { name: 'เพิ่มหมวด' })).toBeDisabled();
  await expect(page.getByTestId('external-tools-group-limit-group-0').getByRole('button', { name: 'เพิ่มลิงก์' })).toBeDisabled();
  expect(await page.evaluate(() => window.externalToolsWrites)).toEqual([]);
});
