import 'server-only';
import { getMailTransporter, isMailConfigured } from '@/lib/mailer';
import { logger } from '@/lib/logger';

/** Customer emails sent by the job service. Failures are logged, never thrown. */
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function send(to: string, subject: string, html: string): Promise<boolean> {
  if (!isMailConfigured()) {
    logger.warn({ subject }, 'email not configured; customer email skipped');
    return false;
  }
  try {
    await getMailTransporter().sendMail({ from: process.env.EMAIL_USER || process.env.EMAIL_HOST_USER, to, subject, html });
    return true;
  } catch (error) {
    logger.error({ err: error, subject }, 'customer email failed');
    return false;
  }
}

function layout(title: string, body: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
  <h2 style="margin:0 0 12px">${escape(title)}</h2>${body}
  <p style="color:#6b7280;font-size:12px;margin-top:24px">FunPrinting</p></div>`;
}

export function sendShopDelayEmail(opts: { to: string; name: string; orderId: string; shop: string; choiceUrl: string; refundBy?: Date }) {
  const until = opts.refundBy
    ? opts.refundBy.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    : null;
  return send(
    opts.to,
    `Order #${opts.orderId}: waiting for ${opts.shop} to accept`,
    layout(
      `${opts.shop} hasn't accepted your order yet`,
      `<p>Hi ${escape(opts.name)},</p>
      <p><b>${escape(opts.shop)}</b> hasn't accepted order <b>#${escape(opts.orderId)}</b> yet. You can keep waiting, or cancel and get a full refund now.</p>
      <p><a href="${opts.choiceUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Refund now or keep waiting</a></p>
      ${until ? `<p>If the shop still hasn't accepted by ${escape(until)}, we'll refund you automatically.</p>` : ''}`
    )
  );
}

export function sendRefundEmail(opts: { to: string; name: string; orderId: string; reason: string }) {
  return send(
    opts.to,
    `Order #${opts.orderId} refunded`,
    layout(
      'Your order has been refunded',
      `<p>Hi ${escape(opts.name)},</p>
      <p>${escape(opts.reason)} We have refunded order <b>#${escape(opts.orderId)}</b> in full to your original payment method. Banks usually take 5–7 working days.</p>`
    )
  );
}
