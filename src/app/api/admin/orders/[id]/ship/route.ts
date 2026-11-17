import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import { shipOrder, isShiprocketConfigured } from '@/lib/shiprocket';

/**
 * POST /api/admin/orders/[id]/ship
 * 
 * Ship an order via Shiprocket (admin-only).
 * Creates a Shiprocket order, assigns AWB, and updates the local order record.
 */
export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

    try {
        // Check Shiprocket configuration
        if (!isShiprocketConfigured()) {
            return NextResponse.json(
                { success: false, error: 'Shiprocket is not configured. Please set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD environment variables.' },
                { status: 503 }
            );
        }

        await connectDB();
        const { id } = await context.params;

        // Get the order
        const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
        const query = isObjectId ? { _id: id } : { orderId: id };
        const order = await Order.findOne(query);
        if (!order) {
            return NextResponse.json(
                { success: false, error: 'Order not found' },
                { status: 404 }
            );
        }

        // Validate order state
        if (order.paymentStatus !== 'completed') {
            return NextResponse.json(
                { success: false, error: 'Order payment must be completed before shipping' },
                { status: 400 }
            );
        }

        if (order.deliveryOption?.type !== 'delivery') {
            return NextResponse.json(
                { success: false, error: 'Only delivery orders can be shipped via Shiprocket (not pickup orders)' },
                { status: 400 }
            );
        }

        // Check if already shipped
        if (order.shiprocket?.awbCode) {
            return NextResponse.json(
                { success: false, error: `Order already shipped. AWB: ${order.shiprocket.awbCode}, Courier: ${order.shiprocket.courierName}` },
                { status: 400 }
            );
        }

        console.log(`🚀 Admin shipping order ${order.orderId} via Shiprocket`);

        // Ship via Shiprocket (create order + assign AWB)
        const result = await shipOrder(order.toObject());

        if (!result.success && !result.shiprocketOrderId) {
            return NextResponse.json(
                { success: false, error: result.error || 'Failed to ship order' },
                { status: 500 }
            );
        }

        // Update order with Shiprocket data
        const updateData: Record<string, any> = {
            'shiprocket.orderId': result.shiprocketOrderId,
            'shiprocket.shipmentId': result.shipmentId,
            'shiprocket.lastTrackedAt': new Date(),
        };

        if (result.awbCode) {
            updateData['shiprocket.awbCode'] = result.awbCode;
            updateData['shiprocket.courierName'] = result.courierName;
            updateData['shiprocket.trackingUrl'] = result.trackingUrl;
            updateData['shiprocket.status'] = 'SHIPPED';
            // Also update order status to dispatched
            updateData['orderStatus'] = 'dispatched';
            updateData['status'] = 'dispatched';
        }

        const updatedOrder = await Order.findOneAndUpdate(
            query,
            { $set: updateData },
            { new: true }
        );

        console.log(`✅ Order ${order.orderId} shipped successfully`);

        return NextResponse.json({
            success: true,
            message: result.awbCode
                ? `Order shipped successfully! AWB: ${result.awbCode}, Courier: ${result.courierName}`
                : `Order created in Shiprocket (ID: ${result.shiprocketOrderId}) but AWB not yet assigned.`,
            shiprocket: {
                orderId: result.shiprocketOrderId,
                shipmentId: result.shipmentId,
                awbCode: result.awbCode,
                courierName: result.courierName,
                trackingUrl: result.trackingUrl,
            },
            order: updatedOrder,
            warning: result.error, // Partial success warning (e.g., AWB not assigned)
        });
    } catch (error: any) {
        console.error('❌ Ship order API error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
