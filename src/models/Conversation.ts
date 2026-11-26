import mongoose, { Schema } from 'mongoose';

export type ConversationStatus = 'open' | 'resolved';
export type CodApprovalStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface IConversation {
  _id: string;
  conversationId: string;
  /** Unique lookup key: "order:<orderId>" or "shop:<partnerId>:<customerEmail>" */
  key: string;
  orderId?: string;
  partnerId: string;
  partnerName: string;
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
  pickupPointName?: string;
  scheduledSlot?: {
    date: string;
    label: string;
  };
  status: ConversationStatus;
  codApprovalStatus: CodApprovalStatus;
  lastMessageAt: Date;
  lastMessagePreview: string;
  unreadCustomer: number;
  unreadPartner: number;
  aiPausedUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>(
  {
    conversationId: { type: String, required: true, unique: true },
    key: { type: String, required: true, unique: true },
    orderId: { type: String, index: true },
    partnerId: { type: String, required: true, index: true },
    partnerName: { type: String, required: true },
    customerEmail: { type: String, required: true, lowercase: true, index: true },
    customerName: { type: String, required: true },
    customerPhone: String,
    pickupPointName: String,
    scheduledSlot: {
      _id: false,
      date: String,
      label: String,
    },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    codApprovalStatus: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
    lastMessageAt: { type: Date, required: true, default: () => new Date() },
    lastMessagePreview: { type: String, default: '' },
    unreadCustomer: { type: Number, default: 0 },
    unreadPartner: { type: Number, default: 0 },
    aiPausedUntil: Date,
  },
  { timestamps: true }
);

conversationSchema.index({ partnerId: 1, lastMessageAt: -1 });
conversationSchema.index({ customerEmail: 1, lastMessageAt: -1 });

export default (mongoose.models.Conversation as mongoose.Model<IConversation>) ||
  mongoose.model<IConversation>('Conversation', conversationSchema);

