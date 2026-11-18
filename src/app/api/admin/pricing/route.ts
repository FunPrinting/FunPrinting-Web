import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import { z } from 'zod';
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

const money = z.number().min(0).max(100000);
const bodySchema = z.object({
  pricing: z.object({
    basePrices: z.object({ A4: money, A3: money }),
    multipliers: z.object({ color: z.number().min(1).max(20), doubleSided: z.number().min(1).max(20) }),
    additionalServices: z.object({ binding: money }),
    templateCommissionPercent: z.number().min(0).max(50),
  }),
});

/**
 * PUT /api/admin/pricing: the prices the order page and checkout use.
 * Only these fields are editable; the shop's own delivery fee and live courier rates replace the old distance table.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
  }
  const p = parsed.data.pricing;
  try {
    await connectDB();
    const pricing = await Pricing.findOneAndUpdate(
      {},
      {
        $set: {
          'basePrices.A4': p.basePrices.A4,
          'basePrices.A3': p.basePrices.A3,
          'multipliers.color': p.multipliers.color,
          'multipliers.doubleSided': p.multipliers.doubleSided,
          'additionalServices.binding': p.additionalServices.binding,
          templateCommissionPercent: p.templateCommissionPercent,
          updatedBy: auth.email,
          updatedAt: new Date(),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return NextResponse.json({ success: true, pricing, message: 'Pricing updated successfully' });
  } catch (error) {
    console.error('Error updating pricing:', error);
    return NextResponse.json({ success: false, error: 'Failed to update pricing' }, { status: 500 });
  }
}
