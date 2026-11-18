import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { normalisePhoneInput } from '@/lib/phoneValidation';
import { cleanBorder, DEFAULT_BORDER } from '@/lib/templateBorders';

export async function GET(_request: NextRequest) {
  try {
    // Get current user from session
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    await connectDB();

    // Get user by email
    const user = await User.findOne({ email: session.user.email.toLowerCase() });
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      profile: {
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        profilePicture: user.profilePicture || null,
        emailVerified: user.emailVerified,
        provider: user.provider,
        templateBorderPreference: user.templateBorderPreference || {
          style: 'solid',
          color: 'blue',
          width: '2px'
        }
      }
    });

  } catch (error) {
    console.error('Error fetching user profile:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch profile' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // Get current user from session
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, email, phone, templateBorderPreference } = body;

    await connectDB();

    // Get user by email
    const user = await User.findOne({ email: session.user.email.toLowerCase() });
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // The email is the sign-in identity and ties the customer to their orders, so it
    // cannot be changed here
    if (typeof email === 'string' && email.trim().toLowerCase() !== user.email.toLowerCase()) {
      return NextResponse.json(
        { success: false, error: 'Your email address cannot be changed here. Contact us if you need it changed.' },
        { status: 400 }
      );
    }

    if (typeof name === 'string' && name.trim()) {
      user.name = name.trim().slice(0, 100);
    }

    if (phone !== undefined && phone !== null) {
      const checked = normalisePhoneInput(phone);
      if (!checked.ok) {
        return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
      }
      user.phone = checked.phone;
    }

    if (templateBorderPreference && typeof templateBorderPreference === 'object') {
      user.templateBorderPreference = cleanBorder(templateBorderPreference, user.templateBorderPreference ?? DEFAULT_BORDER);
    }

    await user.save();

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
      profile: {
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        emailVerified: user.emailVerified,
      }
    });

  } catch (error) {
    console.error('Error updating profile:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}

