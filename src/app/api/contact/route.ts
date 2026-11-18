import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, contactRateLimit, getClientIdentifier } from '@/lib/ratelimit';
import { normalisePhoneInput } from '@/lib/phoneValidation';
import { sendContactMessageEmail } from '@/lib/jobs/emails';
import { withRequestLogger } from '@/lib/logger';
import { CONTACT_TOPICS, CONTACT_TOPIC_KEYS } from '@/lib/contactTopics';

export const runtime = 'nodejs';

const body = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(100),
  email: z.string().trim().email('Please enter a valid email').max(200),
  phone: z.string().trim().max(30),
  topic: z.enum(CONTACT_TOPIC_KEYS),
  message: z.string().trim().min(10, 'Please write a little more so we can help').max(3000),
  // Real visitors never fill this in; bots usually do
  website: z.string().max(200).optional(),
});

/** POST /api/contact: emails the admins; the reply address is the sender's. */
export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(contactRateLimit, getClientIdentifier(request));
  if (limited) return limited;

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Please check the form' }, { status: 400 });
  const data = parsed.data;

  // Looks like a bot: pretend it worked
  if (data.website) return NextResponse.json({ success: true });

  const phone = normalisePhoneInput(data.phone);
  if (!phone.ok) return NextResponse.json({ success: false, error: phone.error }, { status: 400 });

  const log = withRequestLogger(request);
  const sent = await sendContactMessageEmail({ name: data.name, email: data.email, phone: phone.phone, topic: CONTACT_TOPICS[data.topic], message: data.message });
  if (!sent) {
    log.error('contact message could not be emailed');
    return NextResponse.json({ success: false, error: 'We couldn’t send your message right now. Please email or call us instead.' }, { status: 503 });
  }
  return NextResponse.json({ success: true });
}
