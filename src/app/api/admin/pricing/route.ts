import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import Pricing from '@/models/Pricing';

export async function GET(_request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    
    const pricing = await Pricing.findOne();
    
    if (!pricing) {
      return NextResponse.json(
        { success: false, error: 'No pricing found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      pricing,
    });
  } catch (error) {
    console.error('Error fetching pricing:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch pricing' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    
    const body = await request.json();
    const { pricing: newPricing, updatedBy } = body;
    
    console.log('Received pricing data:', JSON.stringify(newPricing, null, 2));
    
    // Validate required fields
    if (!newPricing || !updatedBy) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate delivery charges structure
    if (!newPricing.deliveryCharges?.delivery || typeof newPricing.deliveryCharges.delivery !== 'object') {
      console.log('Delivery charges validation failed:', {
        hasDeliveryCharges: !!newPricing.deliveryCharges,
        deliveryType: typeof newPricing.deliveryCharges?.delivery,
        deliveryValue: newPricing.deliveryCharges?.delivery
      });
      return NextResponse.json(
        { success: false, error: 'Invalid delivery charges structure' },
        { status: 400 }
      );
    }
    
    // Find existing pricing or create new one
    let pricing = await Pricing.findOne();
    
    // Validate and clamp templateCommissionPercent
    const templateCommissionPercent = Math.min(50, Math.max(0, Number(newPricing.templateCommissionPercent) || 20));
    
    if (pricing) {
      // Update existing pricing with proper structure validation
      pricing.basePrices = {
        A4: newPricing.basePrices.A4,
        A3: newPricing.basePrices.A3,
      };
      pricing.multipliers = {
        color: newPricing.multipliers.color,
        doubleSided: newPricing.multipliers.doubleSided,
      };
      pricing.deliveryCharges = {
        pickup: newPricing.deliveryCharges.pickup,
        delivery: newPricing.deliveryCharges.delivery,
      };
      pricing.additionalServices = {
        binding: newPricing.additionalServices.binding,
        resumeTemplate: newPricing.additionalServices.resumeTemplate,
        minServiceFee: newPricing.additionalServices.minServiceFee,
        minServiceFeePageLimit: newPricing.additionalServices.minServiceFeePageLimit,
      };
      pricing.templateCommissionPercent = templateCommissionPercent;
      pricing.updatedBy = updatedBy;
      pricing.updatedAt = new Date();
      
      await pricing.save();
    } else {
      // Create new pricing
      pricing = await Pricing.create({
        ...newPricing,
        templateCommissionPercent,
        updatedBy,
      });
    }
    
    return NextResponse.json({
      success: true,
      pricing,
      message: 'Pricing updated successfully',
    });
  } catch (error) {
    console.error('Error updating pricing:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update pricing' },
      { status: 500 }
    );
  }
}
