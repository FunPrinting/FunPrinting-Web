import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import PrintJob from '@/models/PrintJob';

/**
 * API endpoint to migrate cancelled status to pending
 * 
 * This endpoint:
 * 1. Updates all orders with status: 'cancelled' to orderStatus: 'pending'
 * 2. Updates all print jobs with status: 'cancelled' to status: 'pending'
 * 
 * Access: Admin only
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {

    await connectDB();
    console.log('🔄 Starting cancelled status migration via API...');

    // Update orders with cancelled status
    console.log('\n📋 Processing orders...');
    const cancelledOrders = await Order.find({ status: 'cancelled' });
    console.log(`   Found ${cancelledOrders.length} orders with cancelled status`);

    let ordersUpdated = 0;
    for (const order of cancelledOrders) {
      await Order.updateOne(
        { _id: order._id },
        { 
          $set: { 
            orderStatus: 'pending',
            status: 'pending_payment' // Set status to pending_payment as default
          } 
        }
      );
      ordersUpdated++;
      console.log(`   ✅ Updated order: ${order.orderId || order._id}`);
    }

    // Update print jobs with cancelled status
    console.log('\n📋 Processing print jobs...');
    const cancelledPrintJobs = await PrintJob.find({ status: 'cancelled' });
    console.log(`   Found ${cancelledPrintJobs.length} print jobs with cancelled status`);

    let printJobsUpdated = 0;
    for (const printJob of cancelledPrintJobs) {
      await PrintJob.updateOne(
        { _id: printJob._id },
        { $set: { status: 'pending' } }
      );
      printJobsUpdated++;
      console.log(`   ✅ Updated print job: ${printJob.orderId || printJob._id}`);
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Orders updated: ${ordersUpdated}`);
    console.log(`   ✅ Print jobs updated: ${printJobsUpdated}`);
    console.log(`   📋 Total records updated: ${ordersUpdated + printJobsUpdated}`);

    return NextResponse.json({
      success: true,
      message: 'Migration completed successfully',
      summary: {
        ordersUpdated,
        printJobsUpdated,
        totalUpdated: ordersUpdated + printJobsUpdated
      }
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Migration failed' 
      },
      { status: 500 }
    );
  }
}

