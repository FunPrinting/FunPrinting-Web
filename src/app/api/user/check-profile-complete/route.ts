import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', isComplete: false },
        { status: 401 }
      );
    }

    await connectDB();

    const user = await User.findOne({ email: session.user.email.toLowerCase() });
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found', isComplete: false },
        { status: 404 }
      );
    }

    // A profile is complete once we have a phone number to contact the customer on
    const isComplete = !!user.phone;

    return NextResponse.json({
      success: true,
      isComplete,
      hasPhone: !!user.phone,
      hasPassword: !!user.password,
      provider: user.provider,
    });
  } catch (error) {
    console.error('Error checking profile completeness:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check profile', isComplete: false },
      { status: 500 }
    );
  }
}



