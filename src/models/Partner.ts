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
  phoneNumbers: string[]; // Shop contact numbers
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
  pricing?: {
    perPageBW: number;
    perPageColor: number;
    binding: number;
  };
  deliveryPoints: Array<{
    name: string;
    location: {
      type: 'Point';
      coordinates: [number, number]; // [longitude, latitude]
    };
    contactNumber?: string;
    isActive: boolean;
  }>;
  razorpayAccountId?: string; // Connected account ID for Razorpay Route (Split Payments)
  createdAt: Date;
  updatedAt: Date;
}

const partnerSchema = new mongoose.Schema<IPartner>({
  userId: { type: String, required: true, unique: true },
  businessName: { type: String, required: true, trim: true },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number] }, // [lng, lat]
  },
  address: {
    street: { type: String },
    city: { type: String },
    state: { type: String },
    zipCode: { type: String },
  },
  phoneNumbers: { type: [String], default: [] },
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
  pricing: {
    perPageBW: { type: Number, default: 2 },
    perPageColor: { type: Number, default: 10 },
    binding: { type: Number, default: 30 },
  },
  deliveryPoints: [{
    name: { type: String, required: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    contactNumber: { type: String },
    isActive: { type: Boolean, default: true }
  }],
  razorpayAccountId: { type: String, required: false },
}, {
  timestamps: true,
});

// Geospatial index for $near queries
partnerSchema.index({ location: '2dsphere' });
partnerSchema.index({ 'deliveryPoints.location': '2dsphere' });

export default mongoose.models.Partner || mongoose.model<IPartner>('Partner', partnerSchema);
