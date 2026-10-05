import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Partner from '@/models/Partner';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    // Authorization: Only admin can access
    const isAdmin = session?.user?.email?.toLowerCase() === (process.env.ADMIN_EMAIL || process.env.NEXT_PUBLIC_ADMIN_EMAIL)?.toLowerCase();
    
    if (!isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Admin access required.' },
        { status: 401 }
      );
    }

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
