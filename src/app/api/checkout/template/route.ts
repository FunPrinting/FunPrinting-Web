import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { withRequestLogger } from '@/lib/logger';
import { checkRateLimit, getClientIdentifier, orderCreationRateLimit } from '@/lib/ratelimit';
import { createTemplateCheckout, templateCheckoutSchema } from '@/lib/payments/templateCheckout';
import { paymentErrorResponse } from '@/lib/payments/http';

export const runtime = 'nodejs';

/**
 * POST /api/checkout/template — buy a paid template. Body: { idempotencyKey, templateId, formData }.
 * Returns { referenceId, paymentUrl, amounts }; after payment the status page
 * continues document generation with the stored form data.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const log = withRequestLogger(request, { userId: user.id });

  const limited = await checkRateLimit(orderCreationRateLimit, `checkout:${user.email}:${getClientIdentifier(request)}`);
  if (limited) return limited;

  const parsed = templateCheckoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });

  try {
    const result = await createTemplateCheckout(user, parsed.data, request.nextUrl.origin);
    log.info({ referenceId: result.referenceId, templateId: parsed.data.templateId }, 'template checkout created');
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return paymentErrorResponse(error, log, 'Could not start the payment. Please try again.');
  }
}
