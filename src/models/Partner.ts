import mongoose from 'mongoose';

export interface IPartner {
  _id: string;
  userId: string; // Reference to User
  businessName: string;
  location: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
  };
  isActive: boolean;
  isOnline: boolean;
  supportedPrinters: Array<{
    name: string;
    isColor: boolean;
    paperSizes: string[];
  }>;
  earnings: {
    totalRevenue: number;
    pendingPayout: number;
  };
  servicesOffered: {
    printing: boolean;
    binding: boolean;
    cashOnDelivery: boolean;
  };
  razorpayAccountId?: string; // Connected account ID for Razorpay Route (Split Payments)
  createdAt: Date;
  updatedAt: Date;
}

const partnerSchema = new mongoose.Schema<IPartner>({
  userId: { type: String, required: true, unique: true },
  businessName: { type: String, required: true, trim: true },
  location: {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  address: {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zipCode: { type: String, required: true },
  },
  isActive: { type: Boolean, required: true, default: true },
  isOnline: { type: Boolean, required: true, default: false },
  supportedPrinters: [{
    name: { type: String, required: true },
    isColor: { type: Boolean, required: true, default: false },
    paperSizes: [{ type: String, required: true }],
  }],
  earnings: {
    totalRevenue: { type: Number, required: true, default: 0 },
    pendingPayout: { type: Number, required: true, default: 0 },
  },
  servicesOffered: {
    printing: { type: Boolean, default: true },
    binding: { type: Boolean, default: false },
    cashOnDelivery: { type: Boolean, default: false },
  },
  razorpayAccountId: { type: String, required: false },
}, {
  timestamps: true,
});

// Geospatial index for $near queries
partnerSchema.index({ location: '2dsphere' });

export default mongoose.models.Partner || mongoose.model<IPartner>('Partner', partnerSchema);
