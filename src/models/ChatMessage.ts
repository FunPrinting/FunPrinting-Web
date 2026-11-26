import mongoose, { Schema } from 'mongoose';

export type ChatSenderType = 'customer' | 'partner' | 'ai_bot' | 'system';

export interface IChatMessage {
  _id: string;
  conversationId: string;
  senderType: ChatSenderType;
  senderId: string;
  senderName: string;
  body: string;
  metadata?: Record<string, unknown>;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const chatMessageSchema = new Schema<IChatMessage>(
  {
    conversationId: { type: String, required: true, index: true },
    senderType: { type: String, enum: ['customer', 'partner', 'ai_bot', 'system'], required: true },
    senderId: { type: String, required: true },
    senderName: { type: String, required: true },
    body: { type: String, required: true, maxlength: 2000 },
    metadata: Schema.Types.Mixed,
    readAt: Date,
  },
  { timestamps: true }
);

chatMessageSchema.index({ conversationId: 1, createdAt: 1 });

export default (mongoose.models.ChatMessage as mongoose.Model<IChatMessage>) ||
  mongoose.model<IChatMessage>('ChatMessage', chatMessageSchema);

