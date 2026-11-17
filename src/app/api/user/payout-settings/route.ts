import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { getCurrentUser } from '@/lib/templateAuth';
import bcrypt from 'bcryptjs';

// Validate UPI ID format (basic validation)
const isValidUpi = (upi?: string): boolean => {
  if (!upi) return true; // Optional field
  // Basic UPI format: username@provider
  return /^[\w.-]+@[\w.-]+$/.test(upi) && upi.length <= 100;
};

// Validate IFSC code format
const isValidIfsc = (ifsc?: string): boolean => {
  if (!ifsc) return true; // Optional field
  // IFSC format: 4 letters + 0 + 6 alphanumeric
  return /^[A-Z]{4}0[A-Z0-9]{6}$/i.test(ifsc);
};

// Validate account number (basic)
const isValidAccountNumber = (acc?: string): boolean => {
  if (!acc) return true; // Optional field
  // Account number: 9-18 digits
  return /^\d{9,18}$/.test(acc);
};

export async function GET() {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser?.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    await connectDB();
    const user = await User.findOne({ email: sessionUser.email.toLowerCase() });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      payoutSettings: {
        upiId: user.upiId || '',
        bankDetails: {
          accountHolderName: user.bankDetails?.accountHolderName || '',
          accountNumber: user.bankDetails?.accountNumber || '',
          ifscCode: user.bankDetails?.ifscCode || '',
          bankName: user.bankDetails?.bankName || '',
        },
      },
    });
  } catch (error) {
    console.error('Error fetching payout settings:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch payout settings' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser?.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { upiId, bankDetails, password } = body;

    // Require password for security
    if (!password) {
      return NextResponse.json(
        { success: false, error: 'Password is required to update payout settings' },
        { status: 400 }
      );
    }

    await connectDB();
    const user = await User.findOne({ email: sessionUser.email.toLowerCase() });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // Verify password
    if (!user.password) {
      return NextResponse.json(
        { success: false, error: 'No password set. Please set up a password first.' },
        { status: 400 }
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return NextResponse.json(
        { success: false, error: 'Incorrect password' },
        { status: 401 }
      );
    }

    // Validate UPI ID
    if (upiId && !isValidUpi(upiId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid UPI ID format. Use format: username@provider' },
        { status: 400 }
      );
    }

    // Validate bank details if provided
    if (bankDetails) {
      if (bankDetails.accountNumber && !isValidAccountNumber(bankDetails.accountNumber)) {
        return NextResponse.json(
          { success: false, error: 'Invalid account number. Must be 9-18 digits.' },
          { status: 400 }
        );
      }

      if (bankDetails.ifscCode && !isValidIfsc(bankDetails.ifscCode)) {
        return NextResponse.json(
          { success: false, error: 'Invalid IFSC code format.' },
          { status: 400 }
        );
      }
    }

    // Update payout settings
    user.upiId = upiId?.trim() || undefined;
    user.bankDetails = {
      accountHolderName: bankDetails?.accountHolderName?.trim() || undefined,
      accountNumber: bankDetails?.accountNumber?.trim() || undefined,
      ifscCode: bankDetails?.ifscCode?.trim()?.toUpperCase() || undefined,
      bankName: bankDetails?.bankName?.trim() || undefined,
    };

    await user.save();

    console.log(`✅ Payout settings updated for user: ${user._id}`);

    return NextResponse.json({
      success: true,
      message: 'Payout settings updated successfully',
      payoutSettings: {
        upiId: user.upiId || '',
        bankDetails: {
          accountHolderName: user.bankDetails?.accountHolderName || '',
          accountNumber: user.bankDetails?.accountNumber || '',
          ifscCode: user.bankDetails?.ifscCode || '',
          bankName: user.bankDetails?.bankName || '',
        },
      },
    });
  } catch (error) {
    console.error('Error updating payout settings:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update payout settings' },
      { status: 500 }
    );
  }
}


