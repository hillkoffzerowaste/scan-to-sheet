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

  test('creates an outstation order with the carrier and closes the drawer', async ({ page }) => {
    let posted;
    await page.route('**/api/hillkoff?op=orders', async (route) => {
      if (route.request().method() === 'POST') posted = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: 'SO-100' } }) });
    });
    await page.goto('/'); await page.getByTestId('sales-tab').click(); await page.getByRole('button', { name: 'ออเดอร์', exact: true }).click();
    await page.getByRole('button', { name: 'สร้างใหม่' }).click();
    await page.getByLabel('รหัสออเดอร์').fill('SO-100'); await page.getByLabel('รหัสลูกค้า').fill('C-100');
    await page.getByLabel('ประเภทจัดส่ง').selectOption('outstation'); await page.getByLabel('บริษัทขนส่ง').fill('Kerry');
    await page.getByRole('button', { name: 'ยืนยันเปิดออเดอร์' }).click();
    await expect(page.getByText('สร้างออเดอร์ SO-100 แล้ว')).toBeVisible();
    expect(posted.order.shippingCarrier).toBe('Kerry'); expect(posted.order.deliveryMethod).toBe('outstation');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('queues only ready work and prevents a repeated click while pending', async ({ page }) => {
    let queueCalls = 0;
    const orders = [{ id: 'READY-1', customerName: 'พร้อมส่ง', deliveryMethod: 'company_driver', workflowType: 'direct_pack', storeStatus: 'skipped', packStatus: 'checked', queueStatus: 'ready' }, { id: 'BLOCK-1', customerName: 'ยังไม่พร้อม', deliveryMethod: 'company_driver', workflowType: 'store_route', storeStatus: 'pending', packStatus: 'blocked', queueStatus: 'preparing' }];
    await page.route('**/api/hillkoff?op=dashboard', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { orders } }) }));
    await page.route('**/api/hillkoff?op=queue', async (route) => { queueCalls += 1; await new Promise((resolve) => setTimeout(resolve, 150)); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { queued: true } }) }); });
    await page.goto('/'); await page.getByTestId('sales-tab').click(); await page.getByRole('button', { name: 'จัดคิว', exact: true }).click();
    const ready = page.locator('.sales-row').filter({ hasText: 'READY-1' }).getByRole('button', { name: 'เข้าคิว' }); const blocked = page.locator('.sales-row').filter({ hasText: 'BLOCK-1' }).getByRole('button', { name: 'เข้าคิว' });
    await expect(ready).toBeEnabled(); await expect(blocked).toBeDisabled(); await ready.dblclick();
    await expect(page.getByText('นำ READY-1 เข้าคิวแล้ว')).toBeVisible(); expect(queueCalls).toBe(1);
  });

  test('assigns only valid Chiang Mai rounds and supports Escape to close details', async ({ page }) => {
    let roundPayload;
    const orders = [{ id: 'CM-1', customerName: 'เชียงใหม่', deliveryMethod: 'company_driver', workflowType: 'store_route', storeStatus: 'checked', packStatus: 'pending', queueStatus: 'preparing' }, { id: 'OUT-1', customerName: 'ต่างจังหวัด', deliveryMethod: 'outstation', workflowType: 'direct_pack', queueStatus: 'preparing' }];
    await page.route('**/api/hillkoff?op=dashboard', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { orders } }) }));
    await page.route('**/api/hillkoff?op=chiangmai-round', async (route) => { roundPayload = route.request().postDataJSON(); orders[0].chiangmaiRoundCode = roundPayload.roundCode; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { orderId: 'CM-1' } }) }); });
    await page.goto('/'); await page.getByTestId('sales-tab').click(); await page.getByRole('button', { name: 'รอบเชียงใหม่' }).click();
    await expect(page.getByText('OUT-1')).toHaveCount(0); await page.getByLabel('เลือกรอบสำหรับ CM-1').selectOption('wednesday');
    await expect(page.getByText('จัดรอบ CM-1 แล้ว')).toBeVisible(); expect(roundPayload.roundCode).toBe('wednesday');
    await page.getByText('เชียงใหม่', { exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('operates store and pack through the original workflow action names', async ({ page }) => {
    const actions = []; let current = { id: 'OPS-1', customerName: 'งานครบวงจร', deliveryMethod: 'company_driver', workflowType: 'store_route', storeStatus: 'pending', packStatus: 'blocked', queueStatus: 'preparing' };
    await page.route('**/api/hillkoff?op=orders&*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: route.request().url().includes('id=') ? current : [current] }) }));
    await page.route('**/api/hillkoff?op=workflow', async (route) => { const body = route.request().postDataJSON(); actions.push(body); if (body.action === 'store_update') current = { ...current, storeStatus: body.storeStatus, packStatus: 'pending' }; if (body.action === 'pack_update') current = { ...current, packStatus: body.packStatus, queueStatus: 'ready' }; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) }); });
    await page.goto('/'); await page.getByTestId('sales-tab').click(); await page.getByRole('button', { name: 'ออเดอร์', exact: true }).click(); await page.getByLabel('คำค้นหา').fill('OPS-1'); await page.getByRole('button', { name: 'ค้นหา' }).click(); await page.getByText('งานครบวงจร').click();
    const storeSection = page.locator('.sales-operations section').filter({ hasText: 'สโตร์' }); await storeSection.getByLabel('สถานะ').selectOption('checked'); await storeSection.getByLabel('ผู้ตรวจ').fill('Store Checker'); await storeSection.getByRole('button', { name: /store_update/ }).click();
    const packSection = page.locator('.sales-operations section').filter({ hasText: 'ห้องแพ็ค' }); await packSection.getByLabel('สถานะ').selectOption('checked'); await packSection.getByLabel('ผู้ตรวจ').fill('Pack Checker'); await packSection.getByRole('button', { name: /pack_update/ }).click();
    expect(actions.map((item) => item.action)).toEqual(['store_update', 'pack_update']); expect(actions[0].storeCheckerName).toBe('Store Checker'); expect(actions[1].packCheckerName).toBe('Pack Checker');
  });

  test('edits an existing customer and loads authoritative order history', async ({ page }) => {
    let saved;
    await page.route('**/api/hillkoff?op=customers&*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'C-9', name: 'ลูกค้าเดิม', phone: '0811111111' }] }) }));
    await page.route('**/api/hillkoff?op=customer-history&*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { customer: { id: 'C-9' }, orders: [{ id: 'OLD-1', status: 'ส่งสำเร็จ' }] } }) }));
    await page.route('**/api/hillkoff?op=customers', async (route) => { saved = route.request().postDataJSON(); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: 'C-9' } }) }); });
    await page.goto('/'); await page.getByTestId('sales-tab').click(); await page.getByRole('button', { name: 'ลูกค้า', exact: true }).click(); await page.getByLabel('คำค้นหา').fill('ลูกค้าเดิม'); await page.getByRole('button', { name: 'ค้นหา' }).click(); await page.getByText('ลูกค้าเดิม').click();
    await expect(page.getByText('OLD-1')).toBeVisible(); await page.getByLabel('โทรศัพท์').fill('0899999999'); await page.getByRole('button', { name: 'บันทึกข้อมูลลูกค้า' }).click(); expect(saved.customer.id).toBe('C-9'); expect(saved.customer.phone).toBe('0899999999');
  });
});
