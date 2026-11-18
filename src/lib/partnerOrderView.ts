/**
 * Orders as the shop's apps may see them. The handover code is the customer's proof
 * of delivery, so it never leaves the server towards the shop; the apps only learn
 * whether a code is required and whether it has been accepted.
 */
import { MAX_HANDOVER_ATTEMPTS } from '@/lib/partnerOrderTransitions';

export function forPartner<T extends Record<string, any>>(order: T): T {
  const o = typeof order?.toObject === 'function' ? order.toObject() : order;
  const delivery = o?.deliveryOption;
  if (!delivery?.handover) return o;
  const { handover, ...rest } = delivery;
  return {
    ...o,
    deliveryOption: {
      ...rest,
      handover: { required: true, verified: Boolean(handover.verifiedAt), attemptsLeft: Math.max(0, MAX_HANDOVER_ATTEMPTS - (handover.attempts ?? 0)) },
    },
  };
}
