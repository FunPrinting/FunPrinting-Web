import mongoose, { Schema } from 'mongoose';

/**
 * One-time sign-in code for the partner apps (authorization code + PKCE).
 * Valid for 60 seconds, usable once, bound to the PKCE challenge the app sent.
 * Only the hash of the code is stored.
 */
export interface IDeviceAuthCode {
  codeHash: string;
  challenge: string; // base64url(SHA-256(code_verifier))
  partnerId: string;
  userId: string;
  callback: string;
  expiresAt: Date;
  usedAt?: Date;
}

const codeSchema = new Schema<IDeviceAuthCode>(
  {
    codeHash: { type: String, required: true, unique: true },
    challenge: { type: String, required: true },
    partnerId: { type: String, required: true },
    userId: { type: String, required: true },
    callback: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { collection: 'device_auth_codes' }
);

// Removed by MongoDB shortly after expiry
codeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 300 });

export default (mongoose.models.DeviceAuthCode as mongoose.Model<IDeviceAuthCode>) ||
  mongoose.model<IDeviceAuthCode>('DeviceAuthCode', codeSchema);
