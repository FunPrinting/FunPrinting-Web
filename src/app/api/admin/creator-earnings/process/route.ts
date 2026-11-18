import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import CreatorEarning from '@/models/CreatorEarning';
import User from '@/models/User';
import { processCreatorPayout } from '@/lib/razorpayPayouts';

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    
    const body = await request.json();
    const { earningId, batchProcess, markAsPaid, transactionId } = body;
    
    // Manual mark as paid (for manual bank/UPI transfers)
    if (markAsPaid && earningId) {
      const earning = await CreatorEarning.findById(earningId);
      if (!earning) {
        return NextResponse.json(
          { success: false, error: 'Earning not found' },
          { status: 404 }
        );
      }
      
      earning.status = 'paid';
      earning.notes = transactionId 
        ? `Manual payout - Transaction ID: ${transactionId}` 
        : 'Manual payout completed';
      await earning.save();
      
      return NextResponse.json({
        success: true,
        message: 'Marked as paid successfully',
      });
    }
    
    if (batchProcess) {
      // Process all pending earnings
      const pendingEarnings = await CreatorEarning.find({ status: 'pending' })
        .limit(10); // Process in batches of 10
      
      const results = [];
      
      for (const earning of pendingEarnings) {
        try {
          const result = await processSingleEarning(earning);
          results.push({
            earningId: earning._id,
            success: result.success,
            error: result.error,
          });
        } catch (error: any) {
          results.push({
            earningId: earning._id,
            success: false,
            error: error.message,
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;
      
      return NextResponse.json({
        success: true,
        message: `Processed ${successCount} payouts successfully, ${failCount} failed`,
        results,
      });
    }
    
    // Process single earning
    if (!earningId) {
      return NextResponse.json(
        { success: false, error: 'Earning ID is required' },
        { status: 400 }
      );
    }
    
    const earning = await CreatorEarning.findById(earningId);
    
    if (!earning) {
      return NextResponse.json(
        { success: false, error: 'Earning not found' },
        { status: 404 }
      );
    }
    
    if (earning.status === 'paid') {
      return NextResponse.json(
        { success: false, error: 'Earning already paid' },
        { status: 400 }
      );
    }
    
    if (earning.status === 'processing') {
      return NextResponse.json(
        { success: false, error: 'Earning is already being processed' },
        { status: 400 }
      );
    }
    
    const result = await processSingleEarning(earning);
    
    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Payout processed successfully',
        payoutId: result.payoutId,
      });
    } else {
      return NextResponse.json(
        { success: false, error: result.error || 'Payout processing failed' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error processing payout:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process payout' },
      { status: 500 }
    );
  }
}

async function processSingleEarning(earning: any): Promise<{ success: boolean; payoutId?: string; error?: string }> {
  try {
    // Get creator details
    const creator = await User.findById(earning.creatorUserId);
    
    if (!creator) {
      earning.status = 'failed';
      earning.notes = 'Creator not found';
      await earning.save();
      return { success: false, error: 'Creator not found' };
    }
    
    // Check for payout details
    const hasUpi = !!creator.upiId;
    const hasBank = !!(
      creator.bankDetails?.accountNumber && 
      creator.bankDetails?.ifscCode
    );
    
    if (!hasUpi && !hasBank) {
      earning.status = 'failed';
      earning.notes = 'Creator has no valid payout method';
      await earning.save();
      return { success: false, error: 'Creator has no valid payout method configured' };
    }
    
    // Mark as processing
    earning.status = 'processing';
    earning.payoutMethod = hasUpi ? 'upi' : 'bank';
    earning.payoutDestination = hasUpi 
      ? creator.upiId 
      : `${creator.bankDetails?.bankName || 'Bank'} - ****${creator.bankDetails?.accountNumber?.slice(-4)}`;
    await earning.save();
    
    // Check if RazorpayX is configured
    const hasRazorpayX = !!process.env.RAZORPAYX_ACCOUNT_NUMBER;
    
    if (!hasRazorpayX) {
      // RazorpayX not configured - mark as paid for manual processing
      console.log(`⚠️ RazorpayX not configured. Marking earning ${earning._id} for manual payout.`);
      earning.status = 'paid';
      earning.notes = 'Manual payout required - RazorpayX not configured';
      await earning.save();
      
      return { 
        success: true, 
        payoutId: `manual_${earning._id}`,
      };
    }
    
    // Process via RazorpayX
    const payoutResult = await processCreatorPayout(
      {
        _id: earning._id.toString(),
        creatorUserId: earning.creatorUserId.toString(),
        amount: earning.amount,
        orderId: earning.orderId,
      },
      {
        _id: creator._id.toString(),
        name: creator.name,
        email: creator.email,
        phone: creator.phone,
        upiId: creator.upiId,
        bankDetails: creator.bankDetails,
      }
    );
    
    if (payoutResult.success) {
      earning.status = 'paid';
      earning.notes = `Payout ID: ${payoutResult.payoutId}`;
      await earning.save();
      
      console.log(`✅ Payout processed for earning ${earning._id}: ${payoutResult.payoutId}`);
      
      return { success: true, payoutId: payoutResult.payoutId };
    } else {
      earning.status = 'failed';
      earning.notes = payoutResult.error || 'Payout failed';
      await earning.save();
      
      console.error(`❌ Payout failed for earning ${earning._id}: ${payoutResult.error}`);
      
      return { success: false, error: payoutResult.error };
    }
  } catch (error: any) {
    console.error('Error in processSingleEarning:', error);
    
    earning.status = 'failed';
    earning.notes = error.message || 'Unknown error';
    await earning.save();
    
    return { success: false, error: error.message };
  }
}

