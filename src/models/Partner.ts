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
    printing: {
      enabled: boolean;
      maxPaperSize: 'a4' | 'a3' | 'letter' | 'legal'; // A3 printer can also print A4, Letter, Legal
      supportsColor: boolean;
      supportsBlackAndWhite: boolean;
      supportsDoubleSided: boolean;
    };
    binding: {
      enabled: boolean;
      types: {
        spiral: boolean;
        perfect: boolean;
        staple: boolean;
      };
    };
    lamination: {
      enabled: boolean;
      maxSize: 'a4' | 'a3'; // A3 laminator can also do A4
    };
    scanning: {
      enabled: boolean;
    };
    photocopying: {
      enabled: boolean;
      supportsColor: boolean;
    };
    plasticFiles: {
      enabled: boolean;
    };
    delivery: {
      enabled: boolean;
    };
    customServices: Array<{
      name: string;
      enabled: boolean;
      priceUnit: 'per_page' | 'per_item' | 'per_order';
    }>;
  };
  pricing: {
    perPageBW?: number;
    perPageColor?: number;
    printing?: {
      a4: {
        blackAndWhite: { singleSided: number; doubleSided: number };
        color: { singleSided: number; doubleSided: number };
      };
      a3: {
        blackAndWhite: { singleSided: number; doubleSided: number };
        color: { singleSided: number; doubleSided: number };
      };
      letter: {
        blackAndWhite: { singleSided: number; doubleSided: number };
        color: { singleSided: number; doubleSided: number };
      };
      legal: {
        blackAndWhite: { singleSided: number; doubleSided: number };
        color: { singleSided: number; doubleSided: number };
      };
    };
    binding: {
      spiral?: number; // per order
      perfect?: number; // per order
      staple?: number; // per order
    } | number;
    lamination?: {
      a4: number; // per page
      a3: number; // per page
    };
    scanning?: number; // per page
    photocopying?: {
      blackAndWhite: number; // per page
      color: number; // per page
    };
    plasticFiles?: number; // per item
    customServices?: Array<{
      name: string;
      price: number;
    }>;
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
  // auto: paid orders go straight to the print queue; manual: the partner accepts each order
  acceptanceMode: 'auto' | 'manual';
  /**
   * How this shop can get orders to customers' homes. Both are off by default:
   * a shop without either offers pickup only.
   * - courier: a Shiprocket courier collects parcels from the shop's address
   * - self: the shop's own person delivers within radiusKm for its own fee
   */
  delivery?: {
    courier?: {
      enabled: boolean;
      pickupName?: string; // Shiprocket pickup_location nickname, set once registered
      registeredAt?: Date;
      lastError?: string;
    };
    self?: {
      enabled: boolean;
      radiusKm: number;
      fee: number; // rupees, kept by the shop
      etaMinutes: number; // typical time from printed to delivered
    };
  };
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
    printing: {
      enabled: { type: Boolean, default: true },
      maxPaperSize: { type: String, enum: ['a4', 'a3', 'letter', 'legal'], default: 'a4' },
      supportsColor: { type: Boolean, default: true },
      supportsBlackAndWhite: { type: Boolean, default: true },
      supportsDoubleSided: { type: Boolean, default: false },
    },
    binding: {
      enabled: { type: Boolean, default: false },
      types: {
        spiral: { type: Boolean, default: false },
        perfect: { type: Boolean, default: false },
        staple: { type: Boolean, default: false },
      },
    },
    lamination: {
      enabled: { type: Boolean, default: false },
      maxSize: { type: String, enum: ['a4', 'a3'], default: 'a4' },
    },
    scanning: {
      enabled: { type: Boolean, default: false },
    },
    photocopying: {
      enabled: { type: Boolean, default: false },
      supportsColor: { type: Boolean, default: false },
    },
    plasticFiles: {
      enabled: { type: Boolean, default: false },
    },
    delivery: {
      enabled: { type: Boolean, default: false },
    },
    customServices: [{
      name: { type: String },
      enabled: { type: Boolean, default: true },
      priceUnit: { type: String, enum: ['per_page', 'per_item', 'per_order'], default: 'per_item' },
    }],
  },
  pricing: {
    perPageBW: { type: Number },
    perPageColor: { type: Number },
    printing: {
      a4: {
        blackAndWhite: { singleSided: { type: Number, default: 2 }, doubleSided: { type: Number, default: 3 } },
        color: { singleSided: { type: Number, default: 5 }, doubleSided: { type: Number, default: 8 } },
      },
      a3: {
        blackAndWhite: { singleSided: { type: Number, default: 4 }, doubleSided: { type: Number, default: 6 } },
        color: { singleSided: { type: Number, default: 10 }, doubleSided: { type: Number, default: 15 } },
      },
      letter: {
        blackAndWhite: { singleSided: { type: Number, default: 2 }, doubleSided: { type: Number, default: 3 } },
        color: { singleSided: { type: Number, default: 5 }, doubleSided: { type: Number, default: 8 } },
      },
      legal: {
        blackAndWhite: { singleSided: { type: Number, default: 2 }, doubleSided: { type: Number, default: 3 } },
        color: { singleSided: { type: Number, default: 5 }, doubleSided: { type: Number, default: 8 } },
      },
    },
    binding: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ spiral: 30, perfect: 50, staple: 10 }),
    },
    lamination: {
      a4: { type: Number, default: 20 },
      a3: { type: Number, default: 40 },
    },
    scanning: { type: Number, default: 5 },
    photocopying: {
      blackAndWhite: { type: Number, default: 2 },
      color: { type: Number, default: 10 },
    },
    plasticFiles: { type: Number, default: 10 },
    customServices: [{
      name: { type: String },
      price: { type: Number, default: 0 },
    }],
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
  acceptanceMode: { type: String, enum: ['auto', 'manual'], default: 'auto' },
  delivery: {
    courier: {
      enabled: { type: Boolean, default: false },
      pickupName: String,
      registeredAt: Date,
      lastError: String,
    },
    self: {
      enabled: { type: Boolean, default: false },
      radiusKm: { type: Number, default: 3, min: 0.5, max: 25 },
      fee: { type: Number, default: 30, min: 0, max: 1000 },
      etaMinutes: { type: Number, default: 120, min: 15, max: 24 * 60 },
    },
  },
}, {
  timestamps: true,
});

// Geospatial index for $near queries
partnerSchema.index({ location: '2dsphere' });
partnerSchema.index({ 'deliveryPoints.location': '2dsphere' });

export default mongoose.models.Partner || mongoose.model<IPartner>('Partner', partnerSchema);
