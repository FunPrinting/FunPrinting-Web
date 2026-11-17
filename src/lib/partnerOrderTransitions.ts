/**
 * Fulfilment progression a partner may move an order through.
 *
 * Only forward moves are allowed. Targets are limited to statuses that exist in both
 * Order.status and Order.orderStatus enums ('out_for_delivery' is not one of them).
 * Payment-related states (pending_payment, cancelled, refunded) are never reachable
 * from here; Phase 3 replaces this with the full order state machine.
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
  'delivered',
  'completed',
]);

export type TransitionCheck = { ok: true } | { ok: false; error: string };

/** Validates the requested target on its own, before the order is loaded. */
export function checkPartnerTarget(target: unknown): TransitionCheck {
  if (typeof target !== 'string' || !target) return { ok: false, error: 'Missing status update' };
  if (!PARTNER_TARGET_STATUSES.has(target)) {
    return { ok: false, error: `Status "${target}" cannot be set by a partner` };
  }
  return { ok: true };
}

/** Validates moving a specific order to `target`. */
export function checkPartnerTransition(
  order: { status?: string | null; paymentStatus?: string | null },
  target: string
): TransitionCheck {
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
  return { ok: true };
}
