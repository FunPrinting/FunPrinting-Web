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

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    
    // Filters
    const reqColor = searchParams.get('color') === 'true';
    const reqBinding = searchParams.get('binding') === 'true';
    const reqA3 = searchParams.get('a3') === 'true';

    // Use MongoDB geospatial query to find nearby online partners
    const query: any = {
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
    };

    if (reqBinding) {
      query['servicesOffered.binding'] = true;
    }
    if (reqColor) {
      query['supportedPrinters.isColor'] = true;
    }
    if (reqA3) {
      query['supportedPrinters.paperSizes'] = 'A3';
    }

    const nearbyPartners = await Partner.find(query).select('-earnings -__v').lean();

    // Calculate distance and sort
    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
      return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
    };

    const partnersWithDistance = nearbyPartners.map((p: any) => {
      const pLat = p.location?.coordinates[1] || 0;
      const pLng = p.location?.coordinates[0] || 0;
      const distance = calculateDistance(latitude, longitude, pLat, pLng);
      return { ...p, distance };
    });

    partnersWithDistance.sort((a, b) => a.distance - b.distance);

    const totalCount = partnersWithDistance.length;
    const totalPages = Math.ceil(totalCount / limit);
    const paginatedPartners = partnersWithDistance.slice((page - 1) * limit, page * limit);

    return NextResponse.json({
      success: true,
      count: paginatedPartners.length,
      partners: paginatedPartners,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages
      }
    });

  } catch (error) {
    console.error('Error fetching nearby partners:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch nearby partners' },
      { status: 500 }
    );
  }
}
