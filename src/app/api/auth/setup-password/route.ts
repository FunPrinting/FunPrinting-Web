import { NextRequest, NextResponse } from 'next/server';
import { passwordError } from '@/lib/passwordRules';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { password, confirmPassword } = await request.json();

    if (!password || !confirmPassword) {
      return NextResponse.json(
        { success: false, error: 'Password and confirm password are required' },
        { status: 400 }
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { success: false, error: 'Passwords do not match' },
        { status: 400 }
      );
    }

    // Validate password strength
    const weak = passwordError(password);
    if (weak) {
      return NextResponse.json(
        { success: false, error: weak },
        { status: 400 }
      );
    }

    await connectDB();

    // Find user by email
    const user = await User.findOne({ email: session.user.email.toLowerCase() });
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // Check if user already has a password (should only be for Google OAuth users or users without password)
    // Allow setup if user has Google provider or no password
    if (user.password && user.provider === 'email') {
      return NextResponse.json(
        { success: false, error: 'Password already exists. Use forgot password if you need to reset it.' },
        { status: 400 }
      );
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Update user password
    // Also update provider to allow email login if it was Google-only
    await User.findByIdAndUpdate(user._id, {
      password: hashedPassword,
      // Keep provider as 'google' if it was Google, but allow email login too
    });

    return NextResponse.json({
      success: true,
      message: 'Password set successfully. You can now sign in with email and password.',
    });

  } catch (error) {
    console.error('Setup password error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to set password' },
      { status: 500 }
    );
  }
}

