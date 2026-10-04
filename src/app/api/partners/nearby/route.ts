import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Partner from '@/models/Partner';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');
    const radius = searchParams.get('radius') || '10'; // Default 10km radius

    if (!lat || !lng) {
      return NextResponse.json(
        { success: false, error: 'Latitude and longitude are required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Convert to numbers
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radiusInRadians = parseFloat(radius) * 1000 / 6378100; // Earth radius in meters

    // Use MongoDB geospatial query to find nearby online partners
    // $geoWithin with $centerSphere supports $or operator, unlike $near
    const nearbyPartners = await Partner.find({
      isActive: true,
      isOnline: true,
      $or: [
        {
          location: {
            $geoWithin: { $centerSphere: [[longitude, latitude], radiusInRadians] }
          }
        },
        {
          'deliveryPoints.location': {
            $geoWithin: { $centerSphere: [[longitude, latitude], radiusInRadians] }
          }
        }
      ]
    }).select('-earnings -__v'); // Exclude sensitive info

    return NextResponse.json({
      success: true,
      count: nearbyPartners.length,
      partners: nearbyPartners
    });

  } catch (error) {
    console.error('Error fetching nearby partners:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch nearby partners' },
      { status: 500 }
    );
  }
}
