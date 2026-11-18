import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import CreatorEarning from '@/models/CreatorEarning';
import { getCurrentUser } from '@/lib/templateAuth';
import User from '@/models/User';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: templateId } = await params;
    
    // Get current user from session
    const session = await getCurrentUser();
    if (!session || !session.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    await connectDB();

    // Get user details to find their creatorUserId
    const user = await User.findOne({ email: session.email.toLowerCase() });
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // Fetch earnings for this template and user
    const earnings = await CreatorEarning.find({
      templateId: templateId,
      creatorUserId: user._id
    })
      .sort({ createdAt: -1 });

    // Calculate summary statistics
    const allEarnings = earnings;
    const summary = {
      totalEarnings: allEarnings.reduce((sum, e) => sum + e.amount, 0),
      pendingEarnings: allEarnings
        .filter(e => e.status === 'pending')
        .reduce((sum, e) => sum + e.amount, 0),
      paidEarnings: allEarnings
        .filter(e => e.status === 'paid')
        .reduce((sum, e) => sum + e.amount, 0),
      platformEarnings: allEarnings.reduce((sum, e) => sum + (e.platformShareAmount || 0), 0),
      totalCount: allEarnings.length,
      pendingCount: allEarnings.filter(e => e.status === 'pending').length,
      paidCount: allEarnings.filter(e => e.status === 'paid').length,
    };

    return NextResponse.json({
      success: true,
      earnings,
      summary,
      templateId,
    });
  } catch (error) {
    console.error('Error fetching template earnings:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch earnings' },
      { status: 500 }
    );
  }
}

