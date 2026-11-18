import 'server-only';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Partner from '@/models/Partner';
import { assignAWB, createShiprocketOrder, getTrackingUrl, isShiprocketConfigured } from '@/lib/shiprocket';
import { ensureCourierPickup } from '@/lib/delivery/options';
import { fulfilmentOf, STATUS_RANK } from '@/lib/partnerOrderTransitions';
import { parcelWeightKg } from '@/lib/payments/quote';
import { logger } from '@/lib/logger';

export class CourierError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'CourierError';
  }
}

const LOCK_MS = 2 * 60_000;

function weightOf(order: any): number {
  const files: any[] = order.pricing?.files ?? [];
  const opts: any[] = order.printingOptions?.fileOptions ?? [];
  if (!files.length) return 0.5;
  return parcelWeightKg(files.map((f, i) => ({ pages: Number(f.pages) || 1, copies: Number(opts[i]?.copies) || 1, pageSize: opts[i]?.pageSize === 'A3' ? 'A3' : 'A4' })));
}

/**
 * Books a Shiprocket courier to collect a printed courier-delivery order from the
 * shop's registered pickup address. Used by the shop (after printing) and by admins.
 *
 * A lock stops double bookings. If an earlier attempt created the Shiprocket order
 * but got no tracking number (AWB), only the AWB is retried.
 */
export async function bookCourier(orderId: string, actor: string, opts: { partnerId?: string } = {}) {
  if (!isShiprocketConfigured()) throw new CourierError('Courier booking is not set up yet. Please contact support.', 503);
  await connectDB();

  const order = await Order.findOne({ orderId, ...(opts.partnerId ? { $or: [{ partnerId: opts.partnerId }, { 'deliveryOption.partnerId': opts.partnerId }] } : {}) }).lean<any>();
  if (!order) throw new CourierError('Order not found', 404);
  if (order.paymentStatus !== 'completed') throw new CourierError('The order is not paid');
  if (fulfilmentOf(order) !== 'courier') throw new CourierError('This order is not a courier delivery');
  if (order.shiprocket?.awbCode) throw new CourierError(`Already booked: ${order.shiprocket.courierName || 'courier'}, AWB ${order.shiprocket.awbCode}`, 409);
  if (opts.partnerId && (STATUS_RANK[order.status] ?? -1) < STATUS_RANK.printed) throw new CourierError('Print the order before booking the courier');

  const partnerId = order.partnerId || order.deliveryOption?.partnerId;
  const pickup = await ensureCourierPickup(partnerId);
  if (!pickup.ok) throw new CourierError(`The shop’s courier pickup address isn’t ready: ${pickup.error}`, 409);
  const partner = await Partner.findById(partnerId).select('delivery.courier.pickupName').lean<any>();
  const pickupName: string | undefined = partner?.delivery?.courier?.pickupName;
  if (!pickupName) throw new CourierError('The shop’s courier pickup address isn’t registered', 409);

  // Lock (released below, or expires after LOCK_MS if this process dies)
  const now = new Date();
  const locked = await Order.findOneAndUpdate(
    { _id: order._id, 'shiprocket.awbCode': { $exists: false }, $or: [{ 'shiprocket.bookingStartedAt': { $exists: false } }, { 'shiprocket.bookingStartedAt': { $lt: new Date(now.getTime() - LOCK_MS) } }] },
    { $set: { 'shiprocket.bookingStartedAt': now } },
    { new: true }
  ).lean<any>();
  if (!locked) throw new CourierError('A booking for this order is already in progress', 409);

  const log = logger.child({ orderId, actor });
  try {
    let shipmentId: number | undefined = locked.shiprocket?.shipmentId;
    if (!shipmentId) {
      const customer = order.customerInfo || order.studentInfo || {};
      const d = order.deliveryOption;
      const created = await createShiprocketOrder({
        orderId: order.orderId,
        orderDate: order.createdAt,
        customerName: d.recipientName || customer.name,
        customerEmail: customer.email,
        customerPhone: d.recipientPhone || customer.phone,
        address: [d.flatBuilding, d.address, d.landmark ? `Near ${d.landmark}` : ''].filter(Boolean).join(', '),
        city: d.city,
        state: d.state,
        pinCode: d.pinCode,
        amount: order.amount,
        items: [{ name: `Printed documents #${order.orderId}`, sku: `PRINT-${order.orderId}`, units: 1, sellingPrice: order.amount }],
        weight: weightOf(order),
        paymentMethod: 'Prepaid',
        pickupLocation: pickupName,
      });
      if (!created.success || !created.shipmentId) throw new CourierError(created.error || 'Shiprocket could not create the shipment', 502);
      shipmentId = created.shipmentId;
      await Order.updateOne({ _id: order._id }, { $set: { 'shiprocket.orderId': created.shiprocketOrderId, 'shiprocket.shipmentId': shipmentId, 'shiprocket.bookedBy': actor } });
    }

    const awb = await assignAWB(shipmentId);
    if (!awb.success || !awb.awbCode) {
      log.warn({ err: awb.error }, 'courier booked without AWB');
      throw new CourierError(`The shipment was created but no courier was assigned yet: ${awb.error || 'unknown reason'}. Try again in a few minutes.`, 502);
    }
    const update = {
      'shiprocket.awbCode': awb.awbCode,
      'shiprocket.courierName': awb.courierName,
      'shiprocket.trackingUrl': getTrackingUrl(awb.awbCode),
      'shiprocket.status': 'PICKUP_SCHEDULED',
      'shiprocket.lastTrackedAt': new Date(),
      status: 'dispatched',
      orderStatus: 'dispatched',
    };
    const updated = await Order.findOneAndUpdate({ _id: order._id }, { $set: update, $unset: { 'shiprocket.bookingStartedAt': '' } }, { new: true }).lean<any>();
    log.info({ awb: awb.awbCode, courier: awb.courierName }, 'courier booked');
    return { awbCode: awb.awbCode, courierName: awb.courierName, trackingUrl: getTrackingUrl(awb.awbCode), order: updated };
  } catch (error) {
    await Order.updateOne({ _id: order._id }, { $unset: { 'shiprocket.bookingStartedAt': '' } });
    throw error;
  }
}
