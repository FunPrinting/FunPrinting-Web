import { expect, test } from '@playwright/test';
import { ADMIN, api, CUSTOMER, signIn } from './helpers';

const ORDER = {
  _id: '64b000000000000000000001',
  orderId: 'FP1001',
  orderType: 'file',
  customerInfo: { name: 'Riya Sharma', phone: '9876543210', email: 'riya@example.com' },
  deliveryOption: { type: 'pickup' },
  status: 'paid',
  paymentStatus: 'completed',
  amount: 120,
  createdAt: '2026-11-18T10:00:00.000Z',
  fileURLs: [],
  printingOptions: { pageSize: 'A4', color: 'bw', sided: 'single', copies: 1 },
};

test.describe('admin', () => {
  test('a signed-in customer cannot open the admin area', async ({ page }) => {
    await signIn(page, CUSTOMER);
    await page.goto('/admin');
    await expect(page.getByText(/not an admin account/)).toBeVisible();
  });

  test('dashboard shows money, orders and shops', async ({ page }) => {
    await signIn(page, ADMIN);
    const list = await api(page, '**/api/admin/orders?**', {
      success: true,
      orders: [ORDER],
      totalCount: 1,
      page: 1,
      totalPages: 1,
      statusCounts: { awaitingPayment: 0, waitingForShop: 1, inProgress: 0, onTheWay: 0 },
      financials: { totalSales: 120, partnerPayouts: 108, platformRevenue: 12 },
    });
    await api(page, '**/api/admin/partners', { success: true, partners: [{ _id: 'p1', businessName: 'Copy Corner', isActive: false, isOnline: false, earnings: {} }] });
    const approve = await api(page, '**/api/admin/partners/p1', { success: true, partner: { isActive: true } });

    await page.goto('/admin');
    await expect(page.getByText('₹108')).toBeVisible();
    await expect(page.getByRole('link', { name: 'FP1001' })).toBeVisible();

    await page.getByLabel('Customer or order number').fill('Riya');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect.poll(() => list.at(-1)?.url).toContain('name=Riya');

    await page.getByRole('tab', { name: 'Shops' }).click();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Approved', { exact: true })).toBeVisible();
    expect(approve[0].body).toEqual({ isActive: true });
  });

  test('cancel and refund asks for a reason', async ({ page }) => {
    await signIn(page, ADMIN);
    await api(page, `**/api/admin/orders/${ORDER._id}`, { success: true, order: ORDER });
    const job = await api(page, `**/api/admin/orders/${ORDER.orderId}/job`, (req) =>
      req.method() === 'GET'
        ? { success: true, job: { jobId: 'j1', status: 'pending_acceptance', acceptanceMode: 'manual', history: [] } }
        : { success: true }
    );

    await page.goto(`/admin/orders/${ORDER._id}`);
    await page.getByRole('button', { name: 'Cancel and refund' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Reason shown to the customer').fill('The shop is closed today.');
    await dialog.getByRole('button', { name: 'Cancel and refund' }).click();
    await expect(dialog).toBeHidden();
    const post = job.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ action: 'cancel', reason: 'The shop is closed today.', refund: true, force: false });
  });

  test('manual status change sends the new status', async ({ page }) => {
    await signIn(page, ADMIN);
    const order = await api(page, `**/api/admin/orders/${ORDER._id}`, (req) => (req.method() === 'PATCH' ? { success: true } : { success: true, order: ORDER }));
    await api(page, `**/api/admin/orders/${ORDER.orderId}/job`, { success: true, job: null });

    await page.goto(`/admin/orders/${ORDER._id}`);
    await page.getByLabel('Set status').click();
    await page.getByRole('option', { name: 'Printed' }).click();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect.poll(() => order.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'printed' });
  });
});
