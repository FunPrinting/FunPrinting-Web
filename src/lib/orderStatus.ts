/**
 * Customer-facing labels and progress for Order.status (shared by order pages).
 * step = how many of progressSteps() are done; 0 hides the progress bar.
 */

export type OrderStatus =
  | 'pending_payment'
  | 'pending_cod_approval'
  | 'paid'
  | 'processing'
  | 'printing'
  | 'printed'
  | 'ready_for_pickup'
  | 'dispatched'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export type StatusTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: StatusTone; step: number }> = {
  pending_payment: { label: 'Awaiting payment', tone: 'warning', step: 0 },
  pending_cod_approval: { label: 'Confirm in chat (COD)', tone: 'warning', step: 0 },
  paid: { label: 'Paid, waiting for the shop', tone: 'primary', step: 1 },
  processing: { label: 'Accepted by the shop', tone: 'primary', step: 2 },
  printing: { label: 'Printing', tone: 'primary', step: 2 },
  printed: { label: 'Printed', tone: 'primary', step: 3 },
  ready_for_pickup: { label: 'Ready for pickup', tone: 'success', step: 4 },
  dispatched: { label: 'On the way', tone: 'primary', step: 4 },
  delivered: { label: 'Delivered', tone: 'success', step: 5 },
  completed: { label: 'Completed', tone: 'success', step: 5 },
  cancelled: { label: 'Cancelled', tone: 'danger', step: -1 },
  refunded: { label: 'Refunded', tone: 'neutral', step: -1 },
};

export function statusInfo(status?: string | null) {
  return ORDER_STATUS[(status as OrderStatus) ?? 'pending_payment'] ?? { label: status || 'Unknown', tone: 'neutral' as const, step: 0 };
}

export function progressSteps(delivery: boolean) {
  return ['Paid', 'Accepted', 'Printed', delivery ? 'Shipped' : 'Ready', delivery ? 'Delivered' : 'Collected'];
}

export const ACTIVE_STATUSES = new Set<string>(['pending_payment', 'pending_cod_approval', 'paid', 'processing', 'printing', 'printed', 'ready_for_pickup', 'dispatched']);
