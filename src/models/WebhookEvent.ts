import mongoose, { Schema } from 'mongoose';

/**
 * Razorpay webhook deliveries already processed, keyed by the `x-razorpay-event-id`
 * header. Razorpay retries a delivery until it gets a 2xx, and may deliver the same
 * event more than once; this lets the handler skip duplicates. Kept for 30 days.
 */
export interface IWebhookEvent {
  eventId: string;
  event: string;
  status: 'processing' | 'processed' | 'failed';
  error?: string;
  receivedAt: Date;
  processedAt?: Date;
}

const webhookEventSchema = new Schema<IWebhookEvent>({
  eventId: { type: String, required: true, unique: true },
  event: { type: String, required: true },
  status: { type: String, enum: ['processing', 'processed', 'failed'], default: 'processing' },
  error: String,
  receivedAt: { type: Date, required: true },
  processedAt: Date,
});

webhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default (mongoose.models.WebhookEvent as mongoose.Model<IWebhookEvent>) ||
  mongoose.model<IWebhookEvent>('WebhookEvent', webhookEventSchema);
