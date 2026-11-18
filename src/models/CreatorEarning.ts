import mongoose from 'mongoose';

export interface ICreatorEarning {
  _id: string;
  creatorUserId: mongoose.Types.ObjectId;
  templateId: string;
  orderId: string;
  razorpayPaymentId?: string;
  amount: number; // Amount to be paid to creator (INR)
  platformShareAmount?: number; // Platform earnings for this order (for reporting)
  status: 'pending' | 'processing' | 'paid' | 'failed' | 'cancelled';
  payoutMethod?: 'upi' | 'bank';
  payoutDestination?: string; // e.g. UPI ID or masked account details
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const creatorEarningSchema = new mongoose.Schema<ICreatorEarning>({
  creatorUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  templateId: {
    type: String,
    required: true,
  },
  orderId: {
    type: String,
    required: true,
  },
  razorpayPaymentId: {
    type: String,
    required: false,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  platformShareAmount: {
    type: Number,
    required: false,
    min: 0,
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'paid', 'failed', 'cancelled'],
    default: 'pending',
    required: true,
  },
  payoutMethod: {
    type: String,
    enum: ['upi', 'bank'],
    required: false,
  },
  payoutDestination: {
    type: String,
    required: false,
  },
  notes: {
    type: String,
    required: false,
  },
}, {
  timestamps: true,
});

creatorEarningSchema.index({ creatorUserId: 1, createdAt: -1 });
creatorEarningSchema.index({ templateId: 1, createdAt: -1 });
creatorEarningSchema.index({ orderId: 1 }, { unique: true });
creatorEarningSchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.CreatorEarning || mongoose.model<ICreatorEarning>('CreatorEarning', creatorEarningSchema);



