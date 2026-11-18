import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import VerificationToken from '@/models/VerificationToken';
import { sendVerificationEmail } from '@/lib/email-verification';
import { normalisePhoneInput } from '@/lib/phoneValidation';

export async function POST(request: NextRequest) {
  try {
    const { name, email, password, phone } = await request.json();

    // Validate required fields
    if (!name || !email || !password) {
      return NextResponse.json(
        { success: false, error: 'Name, email, and password are required' },
        { status: 400 }
      );
    }

    // Phone is required: shops call customers about their orders
    const phoneCheck = normalisePhoneInput(phone);
    if (!phoneCheck.ok) {
      return NextResponse.json({ success: false, error: phoneCheck.error }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Validate password strength
    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 6 characters long' },
        { status: 400 }
      );
    }

    await connectDB();

    // Check if user already exists
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ 
      email: normalizedEmail,
      provider: 'email'
    });

    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'User with this email already exists' },
        { status: 400 }
      );
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create new user
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      phone: phoneCheck.phone,
      provider: 'email',
      emailVerified: false,
    });

    // Generate verification token and store in MongoDB
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await VerificationToken.deleteMany({ email: normalizedEmail });
    await VerificationToken.create({
      token,
      email: normalizedEmail,
      expiresAt,
    });

    // Send verification email
    const emailSent = await sendVerificationEmail(
      normalizedEmail,
      name.trim(),
      token
    );

    if (!emailSent) {
      console.error('Failed to send verification email to:', email);
      // Don't fail registration if email sending fails, but log it
    }

    // Return user data (without password)
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      provider: user.provider,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    };

    return NextResponse.json({
      success: true,
      message: emailSent 
        ? 'User registered successfully. Please check your email to verify your account.'
        : 'User registered successfully, but verification email could not be sent. Please contact support.',
      user: userData,
      emailSent,
    });

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to register user' },
      { status: 500 }
    );
  }
}
