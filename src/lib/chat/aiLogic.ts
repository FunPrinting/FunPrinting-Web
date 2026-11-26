import { statusInfo } from '@/lib/orderStatus';

export interface GroundedOrderContext {
  orderId: string;
  status: string;
  deliveryNumber?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  amount: number;
  expectedDate?: string;
  deliveryType?: 'pickup' | 'delivery';
  pickupPointName?: string;
  scheduledSlot?: {
    date: string;
    label: string;
  };
  trackingUrl?: string;
  awbCode?: string;
}

export interface GroundedShopContext {
  businessName: string;
  address?: string;
  phoneNumbers: string[];
  faqNotes?: string;
  deliveryPoints: Array<{ name: string; contactNumber?: string }>;
  scheduleSummary: string[];
  cod: {
    enabled: boolean;
    allowAtPickupPoints: boolean;
    maxOrderAmount: number;
    cashFee: number;
  };
}

export interface GroundedBroadcastContext {
  pickupPointName: string;
  message: string;
  createdAt: string;
}

export interface AiGroundContext {
  shop: GroundedShopContext;
  order?: GroundedOrderContext | null;
  latestBroadcast?: GroundedBroadcastContext | null;
}

export type EscalationResult =
  | { escalate: true; category: 'refund' | 'quality' | 'urgent' | 'human_request' | 'cod_confirm'; reason: string }
  | { escalate: false };

const REFUND_RE = /\b(refund|money back|charged twice|double charge|cancel(led)?\s*(my\s*)?order|reimburse)\b/i;
const QUALITY_RE = /\b(damage|damaged|torn|missing page|wrong print|reprint|smudge|blurred|blurry|defect|bad print)\b/i;
const URGENT_RE = /\b(urgent|asap|emergency|right now|immediately)\b/i;
const HUMAN_RE = /\b(human|real person|talk to (the )?(shop|owner|manager|someone|agent)|call me)\b/i;
const COD_CONFIRM_RE = /\b(confirm|confirmed|yes|please print|go ahead|ok|okay|sure|ready to pay|pay cash|i will collect|approve)\b/i;

export function detectEscalation(messageBody: string, ctx?: { orderStatus?: string; paymentMethod?: string }): EscalationResult {
  const text = messageBody.trim();
  if (REFUND_RE.test(text)) {
    return { escalate: true, category: 'refund', reason: 'Customer asked about a refund or cancellation' };
  }
  if (QUALITY_RE.test(text)) {
    return { escalate: true, category: 'quality', reason: 'Customer reported a print quality or missing page issue' };
  }
  if (HUMAN_RE.test(text)) {
    return { escalate: true, category: 'human_request', reason: 'Customer asked to speak directly with the shop' };
  }
  if (URGENT_RE.test(text)) {
    return { escalate: true, category: 'urgent', reason: 'Customer marked their request as urgent' };
  }
  if (
    ctx?.paymentMethod === 'cod' &&
    ctx?.orderStatus === 'pending_cod_approval' &&
    COD_CONFIRM_RE.test(text)
  ) {
    return {
      escalate: true,
      category: 'cod_confirm',
      reason: 'Customer confirmed Cash on Pickup — tap Approve & Print',
    };
  }
  return { escalate: false };
}

export function buildEscalationHandoffMessage(
  escalation: Extract<EscalationResult, { escalate: true }>,
  ctx: AiGroundContext
): string {
  if (escalation.category === 'cod_confirm' && ctx.order) {
    return `Thanks! I've alerted ${ctx.shop.businessName} to review your Cash on Pickup confirmation for order #${ctx.order.orderId} (₹${ctx.order.amount}) and tap Approve & Print shortly.`;
  }
  const phone = ctx.shop.phoneNumbers[0] ? ` For anything immediate, you can also reach the shop at ${ctx.shop.phoneNumbers[0]}.` : '';
  return `I've flagged this conversation as high priority for the ${ctx.shop.businessName} team (${escalation.reason.toLowerCase()}). A team member will reply here directly.${phone}`;
}

export function buildDeterministicGroundedReply(ctx: AiGroundContext, question: string): string {
  const q = question.toLowerCase();
  const { shop, order, latestBroadcast } = ctx;
  const phoneHint = shop.phoneNumbers.length ? `Shop contact: ${shop.phoneNumbers.join(', ')}.` : '';

  // 1. Live Broadcast / Arrival / Pickup-point update
  if (latestBroadcast && /\b(reach|reached|arrived|where are|rider|pickup point|let me bake|gate|waiting|location|update|announcement)\b/i.test(q)) {
    const timeStr = new Date(latestBroadcast.createdAt).toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
    return `Latest announcement for ${latestBroadcast.pickupPointName} (${timeStr} IST): "${latestBroadcast.message}"`;
  }

  // 2. Order status / readiness query
  if (/\b(status|where is my|ready|printed|track|progress|update|delivered|collected|order)\b/i.test(q) && order) {
    const label = statusInfo(order.status).label;
    const parts: string[] = [
      `Order #${order.orderId}${order.deliveryNumber ? ` (Tag #${order.deliveryNumber})` : ''} is currently: ${label}.`,
    ];
    if (order.scheduledSlot?.date) {
      parts.push(`Scheduled pickup: ${order.scheduledSlot.date}${order.scheduledSlot.label ? ` (${order.scheduledSlot.label})` : ''}.`);
    }
    if (order.pickupPointName) {
      parts.push(`Pickup point: ${order.pickupPointName}.`);
    }
    if (order.awbCode) {
      parts.push(`Courier AWB: ${order.awbCode}.`);
    }
    if (order.paymentMethod === 'cod' && order.paymentStatus !== 'completed') {
      parts.push(`Cash due on pickup: ₹${order.amount} (scan the printed Order Summary QR when collecting).`);
    }
    if (latestBroadcast) {
      parts.push(`Latest pickup alert: "${latestBroadcast.message}"`);
    }
    return parts.join(' ');
  }

  // 3. Payment / COD / Cash / Razorpay query
  if (/\b(cod|cash|pay|payment|upi|razorpay|online|fee|qr|scan)\b/i.test(q)) {
    const onlinePart = 'Online payments are processed securely via Razorpay (UPI, cards, and netbanking).';
    if (!shop.cod.enabled) {
      return `${onlinePart} ${shop.businessName} currently accepts online Razorpay payment only.`;
    }
    const pointRule = shop.cod.allowAtPickupPoints
      ? 'available at the main shop and external pickup points'
      : 'available at the main shop counter only (external pickup points require Razorpay)';
    const feeRule = shop.cod.cashFee > 0 ? ` with a ₹${shop.cod.cashFee} cash handling fee` : '';
    return `${onlinePart} Cash on Pickup is ${pointRule} for orders up to ₹${shop.cod.maxOrderAmount}${feeRule}. Once approved by the shop in chat, pay cash and scan the printed Order Summary QR at collection.`;
  }

  // 4. Scheduling / pickup slots / timings
  if (/\b(slot|schedule|time|timing|when|today|tomorrow|open|hours|cutoff)\b/i.test(q)) {
    const parts: string[] = [];
    if (order?.scheduledSlot?.date) {
      parts.push(`Your selected pickup slot is ${order.scheduledSlot.date} (${order.scheduledSlot.label}).`);
    }
    parts.push('Main store pickups offer same-day and upcoming slots (before cutoff), while external pickup points schedule from tomorrow onwards.');
    if (shop.scheduleSummary.length) {
      parts.push(`Configured slots: ${shop.scheduleSummary.slice(0, 4).join('; ')}.`);
    }
    if (shop.faqNotes) parts.push(`Shop note: ${shop.faqNotes}`);
    return parts.join(' ');
  }

  // 5. Address / contact / shop info
  if (/\b(address|location|phone|contact|number|where|map)\b/i.test(q)) {
    const parts: string[] = [];
    if (shop.address) parts.push(`${shop.businessName} address: ${shop.address}.`);
    if (phoneHint) parts.push(phoneHint);
    if (shop.deliveryPoints.length) {
      parts.push(
        `Pickup points: ${shop.deliveryPoints
          .slice(0, 5)
          .map((d) => (d.contactNumber ? `${d.name} (${d.contactNumber})` : d.name))
          .join(', ')}.`
      );
    }
    if (shop.faqNotes) parts.push(`Notes: ${shop.faqNotes}`);
    return parts.join(' ') || `${shop.businessName} can assist you directly here.`;
  }

  // 6. General fallback grounded in order/FAQ context
  const base: string[] = [`Hi! I'm the ${shop.businessName} AI assistant.`];
  if (order) {
    base.push(
      `Your order #${order.orderId} is "${statusInfo(order.status).label}"${
        order.scheduledSlot?.date ? ` for ${order.scheduledSlot.date} (${order.scheduledSlot.label})` : ''
      }.`
    );
  }
  if (shop.faqNotes) {
    base.push(shop.faqNotes);
  } else {
    base.push('Ask me about your order status, pickup time slot, Cash on Pickup rules, or pickup point updates.');
  }
  return base.join(' ');
}

