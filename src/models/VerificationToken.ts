import mongoose from 'mongoose';

export interface IVerificationToken {
  _id: string;
  token: string;
  email: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const verificationTokenSchema = new mongoose.Schema<IVerificationToken>(
  {
    token: { type: String, required: true, unique: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    // Indexed by the TTL index below; a second plain index on the same key would
    // conflict and could stop expired tokens from being deleted
    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: true,
  }
);

// TTL index so documents are removed automatically once expiresAt is in the past
verificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.VerificationToken ||
  mongoose.model<IVerificationToken>('VerificationToken', verificationTokenSchema);


