/**
 * Fulfilment progression a partner may move an order through. Only forward moves.
 *
 * What comes after "printed" depends on how the order reaches the customer:
 * - pickup:          printed → ready_for_pickup → completed
 * - shop delivery:   printed → dispatched (out for delivery) → delivered, which needs
 *                    the customer's handover code
 * - courier:         the shop stops at printed; booking the courier sets dispatched and
 *                    the courier's tracking (or an admin) sets delivered
 * Payment-related states (pending_payment, cancelled, refunded) are never reachable here.
 */
export const STATUS_RANK: Readonly<Record<string, number>> = {
  paid: 0,
  processing: 1,
  printing: 2,
  printed: 3,
  ready_for_pickup: 4,
  dispatched: 5,
  delivered: 6,
  completed: 7,
};

export const PARTNER_TARGET_STATUSES: ReadonlySet<string> = new Set([
  'printing',
  'printed',
  'ready_for_pickup',
  'dispatched',
  'delivered',
  'completed',
]);

export type Fulfilment = 'pickup' | 'shop' | 'courier';

export interface TransitionOrder {
  status?: string | null;
  paymentStatus?: string | null;
  deliveryOption?: { type?: string | null; method?: string | null; handover?: { verifiedAt?: Date | string | null } | null } | null;
}

/** Orders saved before delivery methods existed count as courier deliveries. */
export function fulfilmentOf(order: TransitionOrder): Fulfilment {
  if (order.deliveryOption?.type !== 'delivery') return 'pickup';
  return order.deliveryOption.method === 'shop' ? 'shop' : 'courier';
}

const ALLOWED_AFTER_PRINTING: Record<Fulfilment, ReadonlySet<string>> = {
  pickup: new Set(['ready_for_pickup', 'completed']),
  shop: new Set(['dispatched', 'delivered', 'completed']),
  courier: new Set([]),
};

export type TransitionCheck = { ok: true; needsHandoverCode?: boolean } | { ok: false; error: string };

/** Validates the requested target on its own, before the order is loaded. */
export function checkPartnerTarget(target: unknown): TransitionCheck {
  if (typeof target !== 'string' || !target) return { ok: false, error: 'Missing status update' };
  if (!PARTNER_TARGET_STATUSES.has(target)) {
    return { ok: false, error: `Status "${target}" cannot be set by a partner` };
  }
  return { ok: true };
}

/**
 * Validates moving a specific order to `target`. For shop deliveries, reaching
 * delivered/completed returns needsHandoverCode until the code has been accepted.
 */
export function checkPartnerTransition(order: TransitionOrder, target: string): TransitionCheck {
  const targetCheck = checkPartnerTarget(target);
  if (!targetCheck.ok) return targetCheck;
  if (order.paymentStatus !== 'completed') return { ok: false, error: 'Order is not paid' };
  const current = order.status ?? '';
  const currentRank = STATUS_RANK[current];
  if (currentRank === undefined) {
    return { ok: false, error: `Order in status "${current}" cannot be updated` };
  }
  if (STATUS_RANK[target] <= currentRank) {
    return { ok: false, error: `Cannot move order from "${current}" to "${target}"` };
  }
  const how = fulfilmentOf(order);
  if (STATUS_RANK[target] > STATUS_RANK.printed && !ALLOWED_AFTER_PRINTING[how].has(target)) {
    const hint =
      how === 'courier'
        ? 'This order goes by courier: book the courier pickup instead'
        : how === 'pickup'
          ? 'This is a pickup order: mark it ready for pickup'
          : 'This order is delivered by your shop: mark it out for delivery, then delivered';
    return { ok: false, error: hint };
  }
  const needsHandoverCode = how === 'shop' && STATUS_RANK[target] >= STATUS_RANK.delivered && !order.deliveryOption?.handover?.verifiedAt;
  return { ok: true, needsHandoverCode };
}

/** The moves to offer a shop for this order: the next step only (same rules as checkPartnerTransition). */
export function nextPartnerStatuses(order: TransitionOrder): string[] {
  const rank = STATUS_RANK[order.status ?? ''] ?? -1;
  const steps: Record<Fulfilment, string[]> = {
    pickup: ['ready_for_pickup', 'completed'],
    shop: ['dispatched', 'delivered'],
    courier: [],
  };
  // Before printing: printing / printed. After: the one next step for this kind of order.
  const candidates = rank < STATUS_RANK.printed ? ['printing', 'printed'] : steps[fulfilmentOf(order)].filter((t) => STATUS_RANK[t] > rank).slice(0, 1);
  return candidates.filter((t) => checkPartnerTransition(order, t).ok);
}

export const PARTNER_STATUS_LABEL: Readonly<Record<string, string>> = {
  printing: 'Printing',
  printed: 'Printed',
  ready_for_pickup: 'Ready for pickup',
  dispatched: 'Out for delivery',
  delivered: 'Delivered',
  completed: 'Collected',
};

/** Wrong codes allowed before the shop has to contact support. */
export const MAX_HANDOVER_ATTEMPTS = 5;
