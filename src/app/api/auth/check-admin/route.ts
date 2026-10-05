import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required', isAdmin: false },
        { status: 400 }
      );
    }

    await connectDB();

    // Check if user exists and has admin role
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return NextResponse.json({ isAdmin: false });
    }

    // Check if user has admin role OR is the specific admin email
    const isAdmin = user.role === 'admin' || email.toLowerCase() === (process.env.ADMIN_EMAIL || process.env.NEXT_PUBLIC_ADMIN_EMAIL)?.toLowerCase();

    return NextResponse.json({ isAdmin });
  } catch (error) {
    console.error('Error checking admin role:', error);
    return NextResponse.json(
      { error: 'Internal server error', isAdmin: false },
      { status: 500 }
    );
  }
}
