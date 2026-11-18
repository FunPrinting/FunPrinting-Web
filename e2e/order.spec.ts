import { expect, test, type Page } from '@playwright/test';
import { api, CUSTOMER, PAYMENT_URL, pdfFile, SHOP, signIn, stubPaymentPage } from './helpers';

test.use({ geolocation: { latitude: 29.2183, longitude: 79.513 }, permissions: ['geolocation'] });

async function stubOrderApis(page: Page, { phone = '9876543210' }: { phone?: string } = {}) {
  await api(page, '**/api/user/profile', { success: true, profile: { name: CUSTOMER.name, email: CUSTOMER.email, phone } });
  await api(page, '**/api/partners/nearby?**', { success: true, partners: [SHOP], pagination: { totalPages: 1 } });
  await api(page, '**/api/delivery/options?**', { success: true, shop: { fee: 20, etaMinutes: 60, distanceKm: 2.1 }, courier: [] });
  const uploads = await api(page, '**/api/upload-file', { success: true, receipt: 'signed-receipt-1', pageCount: 3 });
  return { uploads };
}

/** The Pay button: the summary one on desktop, the sticky bar on mobile. */
const payButton = (page: Page) => page.getByRole('button', { name: /^(Pay|Sign in to pay)/ }).locator('visible=true').first();

test.describe('ordering prints', () => {
  test('upload, choose a shop, pick up, and go to payment', async ({ page }) => {
    await signIn(page, CUSTOMER);
    const { uploads } = await stubOrderApis(page);
    const checkout = await api(page, '**/api/checkout', (req) => {
      const body = req.postDataJSON();
      return { success: true, orderId: 'FP1001', paymentUrl: PAYMENT_URL, amounts: { total: Math.round(body.files.length * 3 * 2 * 1.03 * 100) } };
    });
    await stubPaymentPage(page);

    await page.goto('/order');
    await page.locator('input[type=file]').setInputFiles(await pdfFile('notes.pdf', 3));
    await expect(page.getByText('notes.pdf').first()).toBeVisible();

    // Shop list priced for this document: 3 pages × ₹2
    const shop = page.getByRole('listitem').filter({ hasText: SHOP.businessName });
    await expect(shop).toContainText('₹6');
    await shop.getByRole('button', { name: 'Choose' }).click();

    await expect(page.getByRole('radio', { name: /Pick up from the shop/ })).toHaveAttribute('aria-checked', 'true');
    await payButton(page).click();

    await page.waitForURL(PAYMENT_URL);
    expect(uploads).toHaveLength(1);
    expect(checkout).toHaveLength(1);
    const body = checkout[0].body as { files: Array<{ receipt: string; copies: number }>; delivery: { type: string; partnerId: string } };
    expect(body.files[0].receipt).toBe('signed-receipt-1');
    expect(body.delivery).toMatchObject({ type: 'pickup', partnerId: SHOP._id });
  });

  test('shop delivery sends the address and the shop as the deliverer', async ({ page }) => {
    await signIn(page, CUSTOMER);
    await stubOrderApis(page);
    const checkout = await api(page, '**/api/checkout', { success: true, orderId: 'FP1002', paymentUrl: PAYMENT_URL, amounts: { total: 2678 } });
    await stubPaymentPage(page);

    await page.goto('/order');
    await page.locator('input[type=file]').setInputFiles(await pdfFile('report.pdf', 3));
    await page.getByRole('listitem').filter({ hasText: SHOP.businessName }).getByRole('button', { name: 'Choose' }).click();

    await page.getByRole('radio', { name: /Deliver to me/ }).click();
    await page.getByLabel('Recipient name').fill('Riya Sharma');
    await page.getByLabel('Recipient mobile').fill('9876543210');
    await page.getByLabel('Flat, house or building').fill('Flat 4, Green Residency');
    await page.getByLabel('Street and area').fill('Nainital Road, Kathgodam');
    await page.getByLabel('Pincode').fill('263139');
    await page.getByLabel('City').fill('Haldwani');
    await page.getByLabel('State').fill('Uttarakhand');
    await expect(page.getByRole('radio', { name: /Delivered by the shop/ })).toHaveAttribute('aria-checked', 'true');

    await payButton(page).click();
    await page.waitForURL(PAYMENT_URL);
    const delivery = (checkout[0].body as { delivery: Record<string, unknown> }).delivery;
    expect(delivery).toMatchObject({ type: 'delivery', speed: 'shop', partnerId: SHOP._id, pinCode: '263139', city: 'Haldwani' });
  });

  test('signed-out visitors are asked to sign in, and keep their files', async ({ page }) => {
    await signIn(page, null);
    await stubOrderApis(page);
    await page.goto('/order');
    await page.locator('input[type=file]').setInputFiles(await pdfFile('notes.pdf', 2));
    await page.getByRole('listitem').filter({ hasText: SHOP.businessName }).getByRole('button', { name: 'Choose' }).click();
    await payButton(page).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('notes.pdf').first()).toBeVisible();
  });

  test('a customer without a phone number is asked for one before paying', async ({ page }) => {
    await signIn(page, CUSTOMER);
    await stubOrderApis(page, { phone: '' });
    const saved = await api(page, '**/api/user/update-phone', { success: true, phone: '+919876543210' });
    await page.goto('/order');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add your phone number' })).toBeVisible();
    await dialog.getByLabel('Mobile number').fill('98765 43210');
    await dialog.getByRole('button', { name: 'Save and continue' }).click();
    await expect(dialog).toBeHidden();
    expect(saved[0].body).toEqual({ phone: '+919876543210' });
  });
});
