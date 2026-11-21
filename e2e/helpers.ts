import type { Page, Request, Route } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

export interface TestUser {
  name: string;
  email: string;
  role?: 'customer' | 'admin';
}

export const CUSTOMER: TestUser = { name: 'Riya Sharma', email: 'riya@example.com', role: 'customer' };
export const ADMIN: TestUser = { name: 'Admin', email: 'admin@example.com', role: 'admin' };

export const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const ADMIN_INFO = {
  name: 'Fun Printing Store',
  email: 'support@funprinting.store',
  phone: '1234567890',
  address: 'Test Road',
  city: 'Test City',
  state: 'TS',
  pincode: '000000',
  country: 'India',
  website: '',
  description: 'Test store',
  isActive: true,
};

/**
 * Stubs the NextAuth session as `user` (or signed out), the admin check and the
 * admin-info endpoint that the root layout calls on every server render.
 * Without the admin-info stub every test triggers a MongoDB query and the layout
 * silently swallows the error, but the extra time makes navigation assertions flaky.
 */
export async function signIn(page: Page, user: TestUser | null) {
  await page.route('**/api/auth/session', (r) => r.fulfill(json(user ? { user, expires: '2099-01-01T00:00:00.000Z' } : {})));
  await page.route('**/api/auth/check-admin', (r) => r.fulfill(json({ isAdmin: user?.role === 'admin' })));
  await page.route('**/api/admin/info', (r) => r.fulfill(json({ success: true, admin: ADMIN_INFO })));
}

/**
 * Stubs one API route. `handler` gets the request and returns the JSON body
 * (or a [status, body] pair). Calls are recorded so tests can check what was sent.
 */
type Handler = ((req: Request) => unknown) | Record<string, unknown> | unknown[];

export async function api(page: Page, pattern: string | RegExp, handler: Handler) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  await page.route(pattern, async (route: Route) => {
    const req = route.request();
    let body: unknown = req.postData();
    try {
      body = req.postDataJSON();
    } catch {
      /* not JSON */
    }
    calls.push({ method: req.method(), url: req.url(), body });
    const out = typeof handler === 'function' ? await (handler as (r: Request) => unknown)(req) : handler;
    const [status, payload] = Array.isArray(out) && typeof out[0] === 'number' ? (out as [number, unknown]) : [200, out];
    await route.fulfill(json(payload, status));
  });
  return calls;
}

/** A real PDF with `pages` pages, for the upload input. */
export async function pdfFile(name: string, pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]).drawText(`Page ${i + 1}`, { x: 50, y: 780 });
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

/** Razorpay's hosted page, replaced by a stub so tests can see the redirect. */
export const PAYMENT_URL = 'https://rzp.io/i/e2e-test';
export async function stubPaymentPage(page: Page) {
  await page.route('https://rzp.io/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Razorpay test page</h1>' }));
}

export const SHOP = {
  _id: '64b000000000000000000a01',
  businessName: 'Copy Corner',
  address: { street: 'Station Road', city: 'Haldwani', state: 'Uttarakhand', zipCode: '263139' },
  location: { type: 'Point', coordinates: [79.5, 29.2] },
  distance: 1.4,
  pricing: { perPageBW: 2, perPageColor: 10, binding: 30 },
  servicesOffered: { printing: true, binding: true, cashOnDelivery: false },
  deliveryPoints: [],
  delivery: { self: { radiusKm: 5, fee: 20, etaMinutes: 60 } },
};

export const TEMPLATE = {
  id: 'tpl-cover',
  name: 'Lab cover page',
  description: 'Cover page for lab files',
  category: 'lab-manual',
  placeholders: ['Full Name', 'Roll Number'],
  formSchema: [
    { key: 'Full Name', label: 'Full Name', type: 'text', required: true },
    { key: 'Roll Number', label: 'Roll Number', type: 'text', required: true },
  ],
  isPublic: true,
  isPaid: false,
  price: 0,
  allowFreeDownload: true,
  createdByName: 'Owner',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
};
