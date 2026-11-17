import 'server-only';
import { z } from 'zod';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';
import User from '@/models/User';
import { getPricing } from '@/lib/pricing';
import { assertChargeable, percentOf, rupeesToPaise, withProcessingFee } from '@/lib/payments/money';
import { createLinkForPayment, newPaymentAttempt, type CheckoutResult } from '@/lib/payments/links';
import { CheckoutError } from '@/lib/payments/checkout';
import type { SessionUser } from '@/lib/authz';

const MAX_FORM_BYTES = 50 * 1024;

export const templateCheckoutSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(64),
  templateId: z.string().trim().min(1).max(100),
  formData: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Paid template purchase. Price and creator share come from the template and the
 * pricing settings, never from the browser. The form data is stored with the payment
 * so document generation can continue after the Razorpay redirect.
 */
export async function createTemplateCheckout(
  user: SessionUser,
  input: z.infer<typeof templateCheckoutSchema>,
  requestOrigin: string
): Promise<CheckoutResult> {
  if (Buffer.byteLength(JSON.stringify(input.formData)) > MAX_FORM_BYTES) {
    throw new CheckoutError('The form is too large');
  }
  await connectDB();

  const existing = await newPaymentAttempt.findReusable(user.email, input.idempotencyKey);
  if (existing) return existing;

  const template = await DynamicTemplate.findOne({ id: input.templateId }).lean<{
    name?: string;
    isPaid?: boolean;
    price?: number;
    createdByType?: string;
    createdByEmail?: string;
  } | null>();
  if (!template) throw new CheckoutError('Template not found', 404);
  if (!template.isPaid || !template.price || template.price <= 0) throw new CheckoutError('This template is free');

  const totals = withProcessingFee(rupeesToPaise(template.price));
  assertChargeable(totals.total);

  const pricing = await getPricing();
  const commissionPercent = pricing.templateCommissionPercent ?? 20;
  let creatorUserId: string | undefined;
  if (template.createdByType === 'user' && template.createdByEmail) {
    const creator = await User.findOne({ email: template.createdByEmail.toLowerCase() }).select('_id').lean<{ _id: unknown } | null>();
    creatorUserId = creator ? String(creator._id) : undefined;
  }
  const creatorShare = creatorUserId ? percentOf(totals.subtotal, 100 - commissionPercent) : undefined;

  const payment = await newPaymentAttempt.create({
    purpose: 'template',
    user,
    idempotencyKey: input.idempotencyKey,
    totals,
    templateId: input.templateId,
    template: { name: template.name, formData: input.formData, creatorUserId, commissionPercent },
    creatorShare,
  });
  return createLinkForPayment(payment, {
    description: `FunPrinting template: ${template.name ?? input.templateId}`.slice(0, 200),
    customer: { name: user.name ?? undefined, email: user.email },
    requestOrigin,
  });
}
