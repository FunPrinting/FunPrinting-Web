import mongoose, { Schema } from 'mongoose';

export interface IPickupBroadcast {
  _id: string;
  partnerId: string;
  partnerName: string;
  pickupPointName: string;
  scheduledDate?: string;
  message: string;
  recipientCount: number;
  emailsSent: number;
  chatMessagesCreated: number;
  sentByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

const pickupBroadcastSchema = new Schema<IPickupBroadcast>(
  {
    partnerId: { type: String, required: true, index: true },
    partnerName: { type: String, required: true },
    pickupPointName: { type: String, required: true },
    scheduledDate: String,
    message: { type: String, required: true, maxlength: 1000 },
    recipientCount: { type: Number, required: true, default: 0 },
    emailsSent: { type: Number, required: true, default: 0 },
    chatMessagesCreated: { type: Number, required: true, default: 0 },
    sentByUserId: { type: String, required: true },
  },
  { timestamps: true }
);

pickupBroadcastSchema.index({ partnerId: 1, createdAt: -1 });

export default (mongoose.models.PickupBroadcast as mongoose.Model<IPickupBroadcast>) ||
  mongoose.model<IPickupBroadcast>('PickupBroadcast', pickupBroadcastSchema);

