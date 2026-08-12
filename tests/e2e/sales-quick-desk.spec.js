import { expect, test } from '@playwright/test';

const widths = [375, 1000, 1400];

test.describe('Sales Quick Desk shell', () => {
  for (const width of widths) {
    for (const theme of ['light', 'dark']) {
      test(`${width}px ${theme} renders without horizontal overflow`, async ({ page }) => {
        const consoleErrors = [];
        page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('401')) consoleErrors.push(message.text()); });
        await page.route('**/api/hillkoff?op=dashboard', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { orders: [] } }) }));
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        await page.getByTestId('sales-tab').click();
        if (theme === 'dark') await page.getByTitle('Dark mode').click();
        await expect(page.getByRole('heading', { name: 'Sales Quick Desk' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'เมนู Sales Quick Desk' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        expect(await page.locator('.vite-error-overlay').count()).toBe(0);
        expect(consoleErrors).toEqual([]);
      });
    }
  }

  test('module navigation updates the URL and customer search stays independent', async ({ page }) => {
    await page.route('**/api/hillkoff?op=customers&*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { customers: [{ id: 'C-1', name: 'ลูกค้าทดสอบ', phone: '0800000000' }] } }) }));
    await page.goto('/'); await page.getByTestId('sales-tab').click();
    await page.getByRole('button', { name: 'ลูกค้า', exact: true }).click();
    await expect(page).toHaveURL(/sales=customers/);
    await page.getByLabel('คำค้นหา').fill('ลูกค้า'); await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();
    await expect(page.getByText('ลูกค้าทดสอบ')).toBeVisible();
  });
});
