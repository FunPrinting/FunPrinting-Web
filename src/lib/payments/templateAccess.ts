import 'server-only';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';
import Payment from '@/models/Payment';

/** Documents a buyer may generate per paid template purchase (covers retries). */
export const MAX_GENERATIONS_PER_PURCHASE = 5;

export type TemplateAccess =
  | { paid: false; formData: Record<string, unknown> }
  | { paid: true; formData: Record<string, unknown>; referenceId: string };

/**
 * Gate for every route that generates a document from a template.
 *
 * Free templates: returns the caller's form data unchanged.
 * Paid templates: requires a signed-in user with a paid purchase of this template
 * (`paymentRef`), counts one generation against it, and returns the form data
 * stored at checkout, so a purchase can't be reused for different content.
 * Returns a 401/402 response when access is denied.
 */
export async function checkTemplateAccess(
  templateId: unknown,
  formData: unknown,
  paymentRef: unknown
): Promise<TemplateAccess | NextResponse> {
  const data = formData && typeof formData === 'object' && !Array.isArray(formData) ? (formData as Record<string, unknown>) : {};
  if (typeof templateId !== 'string' || !templateId) return { paid: false, formData: data };

  await connectDB();
  const meta = await DynamicTemplate.findOne({ id: templateId }).select('isPaid price').lean<{ isPaid?: boolean; price?: number } | null>();
  if (!meta?.isPaid || !(meta.price && meta.price > 0)) return { paid: false, formData: data };

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ success: false, error: 'Please sign in to use this template.', code: 'auth_required' }, { status: 401 });
  }
  const purchase =
    typeof paymentRef === 'string' && paymentRef
      ? await Payment.findOneAndUpdate(
          {
            referenceId: paymentRef,
            purpose: 'template',
            templateId,
            userEmail: email,
            // A partial refund (for example a goodwill credit) keeps access
            status: { $in: ['paid', 'partially_refunded'] },
            'template.generationCount': { $lt: MAX_GENERATIONS_PER_PURCHASE },
          },
          { $inc: { 'template.generationCount': 1 } },
          { new: true }
        ).lean<{ referenceId: string; template?: { formData?: Record<string, unknown> } } | null>()
      : null;
  if (!purchase) {
    return NextResponse.json({ success: false, error: 'Payment is required for this template.', code: 'payment_required' }, { status: 402 });
  }
  return { paid: true, formData: purchase.template?.formData ?? data, referenceId: purchase.referenceId };
}

/** Gives back the generation counted by checkTemplateAccess when making the document failed. */
export async function releaseTemplateGeneration(access: TemplateAccess): Promise<void> {
  if (!access.paid) return;
  await connectDB();
  await Payment.updateOne(
    { referenceId: access.referenceId, 'template.generationCount': { $gt: 0 } },
    { $inc: { 'template.generationCount': -1 } }
  );
}
