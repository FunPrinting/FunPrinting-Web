import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import Partner from '@/models/Partner';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {

    await connectDB();

    // Fetch all partners, sorted by most recent
    const partners = await Partner.find({}).sort({ createdAt: -1 });

    return NextResponse.json({
      success: true,
      count: partners.length,
      partners
    });

  } catch (error) {
    console.error('Error fetching admin partners:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch partners' },
      { status: 500 }
    );
  }
}
