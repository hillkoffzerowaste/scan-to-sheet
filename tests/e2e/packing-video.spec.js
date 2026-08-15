import { expect, test } from '@playwright/test';

const widths = [375, 1000, 1400];

test.describe('Packing video tab', () => {
  for (const width of widths) {
    for (const theme of ['light', 'dark']) {
      test(`${width}px ${theme} renders without horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        await page.getByTestId('packing-video-tab').click();
        if (theme === 'dark') await page.getByTitle('Dark mode').click();

        await expect(page.getByRole('heading', { name: 'บันทึกวิดีโอแพ็คพัสดุ' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'ตั้งค่าการใช้งาน' })).toBeVisible();
        expect(await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )).toBe(0);
        expect(await page.locator('.vite-error-overlay').count()).toBe(0);
      });
    }
  }

  test('the setup gate blocks recording until a station and packer are chosen', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('packing-video-tab').click();

    // Recording without knowing who packed what would produce evidence nobody can attribute.
    await expect(page.getByRole('button', { name: 'เริ่มใช้งาน' })).toBeDisabled();
    await page.getByLabel('จุดแพ็ค').selectOption('PACK-A');
    await expect(page.getByRole('button', { name: 'เริ่มใช้งาน' })).toBeDisabled();
  });

  test('the device code is derived from the station and the machine number', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('packing-video-tab').click();
    await page.getByLabel('จุดแพ็ค').selectOption('PACK-B');
    await page.getByLabel('เลขเครื่องที่จุดนี้').fill('3');
    await expect(page.getByText('PACK-B-03')).toBeVisible();
  });

  test('the dashboard waits to be asked before spending Firestore reads', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('packing-video-tab').click();
    await page.getByRole('button', { name: 'ค้นหาวิดีโอ' }).click();

    await expect(page.getByRole('heading', { name: 'ค้นหาวิดีโอแพ็คพัสดุ' })).toBeVisible();
    // No table until the packer searches: mounting the tab must not bill a read per row.
    await expect(page.locator('.pv-table')).toHaveCount(0);
  });
});
