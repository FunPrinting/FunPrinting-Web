import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.describe('public pages', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, null);
  });

  test('home page links to ordering and templates', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /order prints/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /templates/i }).first()).toBeVisible();
  });

  for (const [path, heading] of [
    ['/terms', /terms/i],
    ['/privacy', /privacy/i],
    ['/cancellation-refund', /cancellation|refund/i],
    ['/return-policy', /return/i],
    ['/shipping-delivery', /shipping|delivery/i],
    ['/contact', /contact us/i],
    ['/partner', /print orders/i],
  ] as const) {
    test(`${path} renders`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator('h1').first()).toHaveText(heading);
    });
  }

  test('unknown pages show the 404 page', async ({ page }) => {
    const res = await page.goto('/this-page-does-not-exist');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: /can’t find that page/i })).toBeVisible();
  });

  test('old links redirect', async ({ request }) => {
    const dash = await request.get('/dashboard', { maxRedirects: 0 });
    expect(dash.status()).toBe(308);
    expect(dash.headers().location).toBe('/my-orders');
    const qr = await request.get('/verify-order/FP123', { maxRedirects: 0 });
    expect(qr.status()).toBe(308);
    expect(qr.headers().location).toBe('/orders/FP123');
  });

  test('admin area asks signed-out visitors to sign in', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('Admin sign-in')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });
});
