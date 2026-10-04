import mongoose from 'mongoose';

export interface IUser {
  _id: string;
  name: string;
  email: string;
  password?: string; // Optional for OAuth users
  phone?: string;
  profilePicture?: string;
  provider: 'email' | 'google';
  providerId?: string; // For OAuth providers
  emailVerified: boolean;
  isActive: boolean;
  role?: 'customer' | 'partner' | 'admin';
  lastLogin?: Date;
  defaultLocationId?: string; // Reference to PickupLocation
  // Optional payout details for creator monetization
  upiId?: string;
  bankDetails?: {
    accountHolderName?: string;
    accountNumber?: string;
    ifscCode?: string;
    bankName?: string;
  };
  // Template preferences
  favoriteTemplateIds?: string[]; // Array of template IDs user has favorited
  templateBorderPreference?: {
    style: string; // solid, dashed, dotted, double, groove, ridge, inset, outset
    color: string; // blue, green, purple, gold, red, orange, etc.
    width: string; // 1px, 2px, 3px, 4px, 5px
  };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new mongoose.Schema<IUser>({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: false }, // Optional for OAuth users
  phone: { type: String, required: false, trim: true },
  profilePicture: { type: String, required: false },
  provider: { type: String, enum: ['email', 'google'], required: true, default: 'email' },
  providerId: { type: String, required: false }, // For OAuth providers
  emailVerified: { type: Boolean, required: true, default: false },
  isActive: { type: Boolean, required: true, default: true },
  role: { type: String, enum: ['customer', 'partner', 'admin'], default: 'customer' },
  lastLogin: { type: Date, required: false },
  defaultLocationId: { type: String, required: false, trim: true },
  upiId: { type: String, required: false, trim: true },
  bankDetails: {
    accountHolderName: { type: String, required: false, trim: true },
    accountNumber: { type: String, required: false, trim: true },
    ifscCode: { type: String, required: false, trim: true },
    bankName: { type: String, required: false, trim: true },
  },
  favoriteTemplateIds: [{ type: String, required: false }],
  templateBorderPreference: {
    style: { type: String, required: false, default: 'solid' },
    color: { type: String, required: false, default: 'blue' },
    width: { type: String, required: false, default: '2px' },
  },
}, {
  timestamps: true,
});

// Index for faster queries (email already has unique index from schema)
userSchema.index({ providerId: 1 });
// Note: Removed unique index on phone field to allow multiple null values

export default mongoose.models.User || mongoose.model<IUser>('User', userSchema);
