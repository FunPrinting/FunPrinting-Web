/**
 * Legacy webhook URL. Razorpay dashboards configured before the switch to Payment
 * Links point here; it is handled by the same code as /api/payments/webhook.
 */
export const runtime = 'nodejs';
export { POST } from '@/app/api/payments/webhook/route';
