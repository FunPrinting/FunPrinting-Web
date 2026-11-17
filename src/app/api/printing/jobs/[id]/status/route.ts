import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import PrintJob from '@/models/PrintJob';
import Order from '@/models/Order';

export async function PUT(
    request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();

    const { id } = await params;
    const body = await request.json();
    const { status, errorMessage } = body;

    if (!status) {
      return NextResponse.json(
        { success: false, error: 'Status is required' },
        { status: 400 }
      );
    }

    // Find the job
    const job = await PrintJob.findById(id);
    if (!job) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404 }
      );
    }

    // Update job status
    const updateData: any = { status };
    
    if (status === 'completed') {
      updateData.completedAt = new Date();
      if (job.startedAt) {
        updateData.actualDuration = Math.round(
          (Date.now() - job.startedAt.getTime()) / (1000 * 60) // minutes
        );
      }
    } else if (status === 'failed') {
      updateData.errorMessage = errorMessage || 'Unknown error';
      updateData.retryCount = (job.retryCount || 0) + 1;
    }

    await PrintJob.findByIdAndUpdate(id, updateData);

    // Update order status based on print job status
    if (status === 'completed') {
      await Order.findOneAndUpdate(
        { orderId: job.orderNumber },
        { 
          orderStatus: 'completed',
          status: 'completed',
          updatedAt: new Date()
        }
      );
      console.log(`✅ Order ${job.orderNumber} marked as completed`);
    } else if (status === 'failed') {
      await Order.findOneAndUpdate(
        { orderId: job.orderNumber },
        { 
          orderStatus: 'failed',
          status: 'failed',
          updatedAt: new Date()
        }
      );
      console.log(`❌ Order ${job.orderNumber} marked as failed`);
    } else if (status === 'printing') {
      await Order.findOneAndUpdate(
        { orderId: job.orderNumber },
        { 
          orderStatus: 'printing',
          status: 'processing',
          updatedAt: new Date()
        }
      );
      console.log(`🖨️ Order ${job.orderNumber} marked as printing`);
    }

    console.log(`✅ Job ${job.orderNumber} status updated to: ${status}`);

    return NextResponse.json({
      success: true,
      message: `Job status updated to ${status}`,
      job: {
        id: job._id,
        orderNumber: job.orderNumber,
        status: status
      }
    });

  } catch (error) {
    console.error('❌ Error updating job status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update job status' },
      { status: 500 }
    );
  }
}
