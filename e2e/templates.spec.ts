import { expect, test } from '@playwright/test';
import { api, CUSTOMER, PAYMENT_URL, signIn, stubPaymentPage, TEMPLATE } from './helpers';

const JOB = '11111111-1111-4111-8111-111111111111';
const WORD_URL = 'https://res.cloudinary.com/demo/raw/upload/filled.docx';
const PDF_URL = 'https://res.cloudinary.com/demo/raw/upload/filled.pdf';

test.describe('templates', () => {
  test('browse and search', async ({ page }) => {
    await signIn(page, null);
    await api(page, /\/api\/templates(\?.*)?$/, {
      success: true,
      templates: [
        { ...TEMPLATE, isMine: false, purchaseCount: 3, rank: 1, isFavorite: false },
        { ...TEMPLATE, id: 'tpl-2', name: 'Assignment front page', description: undefined, category: 'assignment', isPaid: true, price: 49, isMine: false, purchaseCount: 0, rank: null, isFavorite: false },
      ],
    });
    await page.goto('/templates');
    await expect(page.getByText('Lab cover page')).toBeVisible();
    await expect(page.getByText('₹49')).toBeVisible();
    // A template with no description must not break search
    await page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first().fill('assignment');
    await expect(page.getByText('Assignment front page')).toBeVisible();
    await expect(page.getByText('Lab cover page')).toBeHidden();
  });

  test('fill a free template, get the document, and send it to the order page', async ({ page }) => {
    await signIn(page, CUSTOMER);
    await api(page, `**/api/templates/${TEMPLATE.id}`, { success: true, template: TEMPLATE });
    const generate = await api(page, '**/api/templates/generate-fill-pdf', { success: true, jobId: JOB, wordUrl: WORD_URL, status: 'processing' });
    let polls = 0;
    await api(page, '**/api/templates/generation-status/**', () => (++polls < 2 ? { success: true, status: 'processing', progress: 60 } : { success: true, status: 'completed', progress: 100, pdfUrl: PDF_URL, wordUrl: WORD_URL }));
    // The order page downloads the PDF to add it as a document
    await page.route(PDF_URL, (r) => r.fulfill({ status: 404 }));

    await page.goto(`/templates/fill/${TEMPLATE.id}`);
    await page.getByLabel(/Full Name/).fill('Riya Sharma');
    await page.getByLabel(/Roll Number/).fill('42');
    await page.getByRole('button', { name: 'Create my document' }).click();

    // Wait for navigation to the loading page, then for polling to complete
    await page.waitForURL(/\/loading/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Your document is ready' })).toBeVisible({ timeout: 30_000 });
    expect(generate).toHaveLength(1);
    expect(generate[0].body).toMatchObject({ templateId: TEMPLATE.id, formData: { 'Full Name': 'Riya Sharma', 'Roll Number': '42' } });
    await expect(page).toHaveURL(new RegExp(`jobId=${JOB}`));

    // Refreshing resumes the same job instead of making a new document
    await page.reload();
    await expect(page.getByRole('heading', { name: /ready/i })).toBeVisible();
    expect(generate).toHaveLength(1);

    await page.getByRole('button', { name: /print/i }).first().click();
    await expect(page).toHaveURL(/\/order$/);
  });

  test('a paid template goes to payment with the filled-in details', async ({ page }) => {
    await signIn(page, CUSTOMER);
    await api(page, `**/api/templates/${TEMPLATE.id}`, { success: true, template: { ...TEMPLATE, isPaid: true, price: 49 } });
    const checkout = await api(page, '**/api/checkout/template', { success: true, paymentUrl: PAYMENT_URL });
    await stubPaymentPage(page);

    await page.goto(`/templates/fill/${TEMPLATE.id}`);
    await page.getByLabel(/Full Name/).fill('Riya Sharma');
    await page.getByLabel(/Roll Number/).fill('42');
    await page.getByRole('button', { name: 'Review and pay' }).click();
    await page.getByRole('button', { name: /^Pay ₹/ }).click();

    await page.waitForURL(PAYMENT_URL);
    expect(checkout[0].body).toMatchObject({ templateId: TEMPLATE.id, formData: { 'Full Name': 'Riya Sharma', 'Roll Number': '42' } });
  });

  test('signing in from the form keeps what was typed', async ({ page }) => {
    await signIn(page, null);
    await api(page, `**/api/templates/${TEMPLATE.id}`, { success: true, template: TEMPLATE });
    await page.goto(`/templates/fill/${TEMPLATE.id}`);
    await page.getByLabel(/Full Name/).fill('Riya Sharma');
    await page.getByLabel(/Roll Number/).fill('42');
    await page.getByRole('button', { name: 'Sign in to continue' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByLabel(/Full Name/)).toHaveValue('Riya Sharma');
  });

  test('creators see earnings for their paid templates', async ({ page }) => {
    await signIn(page, CUSTOMER);
    await api(page, '**/api/templates/my-templates', { success: true, templates: [{ ...TEMPLATE, isPaid: true, price: 49 }] });
    await api(page, `**/api/templates/${TEMPLATE.id}/earnings`, {
      success: true,
      earnings: [{ _id: 'e1', orderId: 'TPL-1', amount: 39.2, status: 'pending', createdAt: '2026-11-18T10:00:00.000Z' }],
      summary: { totalEarnings: 39.2, pendingEarnings: 39.2, paidEarnings: 0, totalCount: 1 },
    });
    await page.goto('/my-templates');
    await page.getByRole('button', { name: 'Earnings' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('TPL-1')).toBeVisible();
    await expect(dialog.getByText('₹39.20').first()).toBeVisible();
  });
});
