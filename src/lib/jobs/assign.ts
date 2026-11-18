import 'server-only';
import connectDB from '@/lib/mongodb';
import Partner from '@/models/Partner';

/**
 * The shop that prints a job: always the one the customer chose at checkout (the
 * platform's own shop is an ordinary partner). Jobs are never moved between shops.
 */
export interface PartnerSummary {
  _id: string;
  businessName: string;
  acceptanceMode: 'auto' | 'manual';
  razorpayAccountId?: string;
}

function summary(p: Record<string, any>): PartnerSummary {
  return {
    _id: String(p._id),
    businessName: p.businessName,
    acceptanceMode: p.acceptanceMode === 'manual' ? 'manual' : 'auto',
    razorpayAccountId: p.razorpayAccountId,
  };
}

export async function getActivePartner(partnerId: string): Promise<PartnerSummary | null> {
  if (!/^[0-9a-fA-F]{24}$/.test(partnerId)) return null;
  await connectDB();
  const p = await Partner.findOne({ _id: partnerId, isActive: true }).lean<Record<string, any> | null>();
  return p ? summary(p) : null;
}
