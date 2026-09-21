import { test, expect } from '@playwright/test';
import { openSignedInApp } from './mock-app.js';

const DEFAULT_LINKS = [
  ['delivery-system-link', 'ระบบส่งของ', 'https://repo-rho-livid.vercel.app/'],
  ['wrong-delivery-link', 'จัดการส่งของผิด', 'https://script.google.com/a/macros/hillkoff.com/s/AKfycbxQENSgzP-0IzDX0J_pY2g9HoMlCKMaNQYJlnxPbudqELr79oKdwYpoNflqrSAfsgw2/exec'],
  ['label-checker-link', 'พิมพ์ใบเช็ค ใบปะหน้า', 'https://barcode-checker-ashy.vercel.app/'],
  ['coffee-stock-link', 'เบิกออก/รับเข้ากาแฟถัง', 'https://script.google.com/a/macros/hillkoff.com/s/AKfycbxETrRx_gJBuVTdl2MUaumr5Pem4LzahebQ6HZzrknPOr-PPCPmJHQ0I9f-p-kYJB-J/exec'],
  ['coffee-shop-grinder-link', 'บดกาแฟหน้าร้าน', 'https://coffee-grinder-system.vercel.app/'],
  ['coffee-stock-count-link', 'ตรวจนับสต็อกกาแฟ', 'https://script.google.com/macros/s/AKfycbyulSX89Q-eXvcd33QypMp8uP2_PrqjGjpBiYre_j2rJDXg74dNqGQ44jBgU1N_WNIXnA/exec'],
];

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
});
