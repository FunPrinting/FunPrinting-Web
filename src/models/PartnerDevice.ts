import mongoose, { Schema } from 'mongoose';

/**
 * One signed-in partner app installation (desktop or phone).
 *
 * The refresh token is stored only as a SHA-256 hash and rotates on every use. The
 * previous hash is kept: if it is presented again, the token was copied, so the
 * device is revoked (refresh token reuse detection).
 */
export interface IPartnerDevice {
  _id: mongoose.Types.ObjectId;
  deviceId: string; // random id generated at sign-in, embedded in access tokens as `did`
  partnerId: string;
  userId: string;
  name: string;
  platform: 'desktop' | 'mobile' | 'other';
  appVersion?: string;
  /** Printers this computer uses, reported by the desktop app (PATCH /api/partner/printers). */
  printers?: Array<{ name: string; color: boolean; duplex: boolean; a3: boolean }>;
  printersReportedAt?: Date;
  refreshTokenHash: string;
  previousRefreshTokenHash?: string;
  rotatedAt?: Date; // when the refresh token last rotated (grace window for retries)
  refreshExpiresAt: Date;
  lastSeenAt: Date;
  lastIp?: string;
  revokedAt?: Date;
  revokedReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const deviceSchema = new Schema<IPartnerDevice>(
  {
    deviceId: { type: String, required: true, unique: true },
    partnerId: { type: String, required: true },
    userId: { type: String, required: true },
    name: { type: String, required: true, maxlength: 100 },
    platform: { type: String, enum: ['desktop', 'mobile', 'other'], default: 'other' },
    appVersion: { type: String, maxlength: 40 },
    printers: {
      type: [{ _id: false, name: { type: String, maxlength: 120 }, color: Boolean, duplex: Boolean, a3: Boolean }],
      default: undefined,
    },
    printersReportedAt: Date,
    refreshTokenHash: { type: String, required: true },
    previousRefreshTokenHash: String,
    rotatedAt: Date,
    refreshExpiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    lastIp: String,
    revokedAt: Date,
    revokedReason: String,
  },
  { timestamps: true, collection: 'partner_devices' }
);

deviceSchema.index({ refreshTokenHash: 1 });
deviceSchema.index({ previousRefreshTokenHash: 1 }, { sparse: true });
deviceSchema.index({ partnerId: 1, revokedAt: 1 });

export default (mongoose.models.PartnerDevice as mongoose.Model<IPartnerDevice>) ||
  mongoose.model<IPartnerDevice>('PartnerDevice', deviceSchema);
