import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Partner from '@/models/Partner';
import { courierReady } from '@/lib/delivery/options';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');

    await connectDB();

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    // Filters
    const reqColor = searchParams.get('color') === 'true';
    const reqBinding = searchParams.get('binding') === 'true';
    const reqA3 = searchParams.get('a3') === 'true';

    const andFilters: any[] = [];
    if (reqBinding) {
      andFilters.push({ $or: [{ 'servicesOffered.binding': true }, { 'servicesOffered.binding.enabled': true }] });
    }
    if (reqColor) {
      andFilters.push({ $or: [{ 'supportedPrinters.isColor': true }, { 'servicesOffered.printing.supportsColor': true }] });
    }
    if (reqA3) {
      andFilters.push({ $or: [{ 'supportedPrinters.paperSizes': 'A3' }, { 'servicesOffered.printing.maxPaperSize': 'a3' }] });
    }

    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    };

    const formatPartner = (p: any, userLat?: number, userLng?: number) => {
      const pLat = p.location?.coordinates?.[1] || 0;
      const pLng = p.location?.coordinates?.[0] || 0;
      const distance = userLat !== undefined && userLng !== undefined && pLat && pLng
        ? calculateDistance(userLat, userLng, pLat, pLng)
        : undefined;

      const deliveryPoints = (p.deliveryPoints || [])
        .filter((dp: any) => dp.isActive !== false)
        .map((dp: any) => {
          const dpLat = dp.location?.coordinates?.[1] || 0;
          const dpLng = dp.location?.coordinates?.[0] || 0;
          const dpDistance = userLat !== undefined && userLng !== undefined && dpLat && dpLng
            ? calculateDistance(userLat, userLng, dpLat, dpLng)
            : undefined;
          return {
            _id: dp._id?.toString(),
            name: dp.name,
            location: dp.location,
            contactNumber: dp.contactNumber,
            distance: dpDistance,
            isActive: dp.isActive,
          };
        });

      const { delivery, ...rest } = p;
      return {
        ...rest,
        distance,
        deliveryPoints,
        delivery: {
          courier: courierReady(p),
          self: delivery?.self?.enabled ? { radiusKm: delivery.self.radiusKm, fee: delivery.self.fee, etaMinutes: delivery.self.etaMinutes } : null,
        },
      };
    };

    const hasLocation = Boolean(lat && lng && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng)));
    const latitude = hasLocation ? parseFloat(lat!) : undefined;
    const longitude = hasLocation ? parseFloat(lng!) : undefined;

    // Query active & online partners
    const baseQuery: any = { isActive: true, isOnline: true };
    if (andFilters.length > 0) baseQuery.$and = andFilters;

    const selectFields = 'businessName location address.street address.city address.state address.zipCode pricing servicesOffered supportedPrinters deliveryPoints.name deliveryPoints.location deliveryPoints.isActive deliveryPoints.contactNumber phoneNumbers delivery';

    let partners = await Partner.find(baseQuery)
      .select(selectFields)
      .lean();

    // Fallback: If no partners are online, show active partners
    if (partners.length === 0) {
      const activeQuery: any = { isActive: true };
      if (andFilters.length > 0) activeQuery.$and = andFilters;
      partners = await Partner.find(activeQuery)
        .select(selectFields)
        .lean();
    }

    // Format and calculate distances
    const partnersList = partners.map((p) => formatPartner(p, latitude, longitude));

    // Sort by shop distance if location is provided
    if (hasLocation) {
      partnersList.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    }

    const totalCount = partnersList.length;
    const totalPages = Math.ceil(totalCount / limit) || 1;
    const paginatedPartners = partnersList.slice((page - 1) * limit, page * limit);

    return NextResponse.json({
      success: true,
      hasLocation,
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
