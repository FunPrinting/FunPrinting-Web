import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import AdminInfo from '@/models/AdminInfo';

export const dynamic = 'force-dynamic';

// GET - Fetch admin information
export async function GET() {
  try {
    await connectDB();
    
    const admin = await AdminInfo.findOne({ isActive: true }).lean();
    
    if (!admin) {
      return NextResponse.json({
        success: false,
        message: 'No admin information found'
      }, { status: 404 });
    }
    
    return NextResponse.json({
      success: true,
      admin,
      message: 'Admin information fetched successfully'
    });
  } catch (error) {
    console.error('Error fetching admin info:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch admin information' },
      { status: 500 }
    );
  }
}

// POST - Create or update admin information
export async function POST(request: NextRequest) {
  try {
    await connectDB();
    
    const body = await request.json();
    
    // Check if admin already exists
    const existingAdmin = await AdminInfo.findOne({ isActive: true });
    
    if (existingAdmin) {
      // Update existing admin
      const updatedAdmin = await AdminInfo.findByIdAndUpdate(
        existingAdmin._id,
        { ...body, isActive: true },
        { new: true, runValidators: true }
      );
      
      return NextResponse.json({
        success: true,
        admin: updatedAdmin,
        message: 'Admin information updated successfully'
      });
    } else {
      // Create new admin
      const admin = new AdminInfo({ ...body, isActive: true });
      await admin.save();
      
      return NextResponse.json({
        success: true,
        admin,
        message: 'Admin information created successfully'
      });
    }
  } catch (error) {
    console.error('Error saving admin info:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to save admin information' },
      { status: 500 }
    );
  }
}

// PUT - Update admin information
export async function PUT(request: NextRequest) {
  try {
    await connectDB();
    
    const body = await request.json();
    const { id, ...updateData } = body;
    
    if (!id) {
      return NextResponse.json(
        { success: false, message: 'Admin ID is required' },
        { status: 400 }
      );
    }
    
    const updatedAdmin = await AdminInfo.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!updatedAdmin) {
      return NextResponse.json(
        { success: false, message: 'Admin not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      admin: updatedAdmin,
      message: 'Admin information updated successfully'
    });
  } catch (error) {
    console.error('Error updating admin info:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update admin information' },
      { status: 500 }
    );
  }
}

// DELETE - Delete admin information
export async function DELETE(request: NextRequest) {
  try {
    await connectDB();
    
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json(
        { success: false, message: 'Admin ID is required' },
        { status: 400 }
      );
    }
    
    const deletedAdmin = await AdminInfo.findByIdAndDelete(id);
    
    if (!deletedAdmin) {
      return NextResponse.json(
        { success: false, message: 'Admin not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: 'Admin information deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting admin info:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete admin information' },
      { status: 500 }
    );
  }
}
