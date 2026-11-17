import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import PickupLocation from '@/models/PickupLocation';

// GET - Fetch all pickup locations
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    
    const locations = await PickupLocation.find().sort({ isDefault: -1, createdAt: -1 });
    
    return NextResponse.json({
      success: true,
      locations,
    });
  } catch (error) {
    console.error('Error fetching pickup locations:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch pickup locations' },
      { status: 500 }
    );
  }
}

// POST - Create new pickup location
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    
    const body = await request.json();
    const { name, address, lat, lng, description, contactPerson, contactPhone, operatingHours } = body;
    
    // Validate required fields
    if (!name || !address || lat === undefined || lng === undefined) {
      return NextResponse.json(
        { success: false, error: 'Name, address, latitude, and longitude are required' },
        { status: 400 }
      );
    }
    
    // Create new location
    const location = new PickupLocation({
      name,
      address,
      lat,
      lng,
      description,
      contactPerson,
      contactPhone,
      operatingHours,
      isActive: true,
      isDefault: false, // New locations are not default by default
    });
    
    await location.save();
    
    return NextResponse.json({
      success: true,
      location,
      message: 'Pickup location created successfully',
    });
  } catch (error) {
    console.error('Error creating pickup location:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create pickup location' },
      { status: 500 }
    );
  }
}

// PUT - Update pickup location
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    
    const body = await request.json();
    const { id, updates } = body;
    
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Location ID is required' },
        { status: 400 }
      );
    }
    
    const location = await PickupLocation.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    );
    
    if (!location) {
      return NextResponse.json(
        { success: false, error: 'Pickup location not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      location,
      message: 'Pickup location updated successfully',
    });
  } catch (error) {
    console.error('Error updating pickup location:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update pickup location' },
      { status: 500 }
    );
  }
}

// DELETE - Delete pickup location
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Location ID is required' },
        { status: 400 }
      );
    }
    
    const location = await PickupLocation.findById(id);
    
    if (!location) {
      return NextResponse.json(
        { success: false, error: 'Pickup location not found' },
        { status: 404 }
      );
    }
    
    // Prevent deletion of default location
    if (location.isDefault) {
      return NextResponse.json(
        { success: false, error: 'Cannot delete default pickup location' },
        { status: 400 }
      );
    }
    
    await PickupLocation.findByIdAndDelete(id);
    
    return NextResponse.json({
      success: true,
      message: 'Pickup location deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting pickup location:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete pickup location' },
      { status: 500 }
    );
  }
}
