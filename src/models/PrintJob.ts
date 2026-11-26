import mongoose, { Schema } from 'mongoose';

/**
 * The print work for one paid order, and who is responsible for it.
 *
 * Lifecycle (src/lib/jobs/service.ts). A job always stays with the shop the
 * customer chose:
 *   pending_acceptance ─accept→ queued ─claim→ claimed ─→ printing ─→ printed
 *   (auto-accept shops start at queued)
 *   pending_acceptance | queued ─decline / refund / cancel→ cancelled
 *
 * Deadlines apply only until the shop accepts or a device claims the job:
 *   acceptBy  = assignment + 10 min → customer may refund now or keep waiting
 *   refundBy  = payment + 24 h      → automatic refund
 * A claim is a lease: a device that stops reporting loses the job after the lease,
 * and another device of the same partner can pick it up.
 */
export const JOB_STATUSES = ['pending_acceptance', 'queued', 'claimed', 'printing', 'printed', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** States a partner device can still act on. */
export const ACTIVE_JOB_STATUSES: JobStatus[] = ['pending_acceptance', 'queued', 'claimed', 'printing', 'failed'];
/** States where nobody has started printing yet, so deadlines still apply. */
export const WAITING_JOB_STATUSES: JobStatus[] = ['pending_acceptance', 'queued'];

export interface JobFile {
  url: string;
  /** The PDF partner apps print (see src/lib/jobs/printReady.ts). */
  printUrl?: string;
  name: string;
  mime?: string;
  pages?: number;
  pageSize: 'A4' | 'A3';
  color: 'color' | 'bw' | 'mixed';
  sided: 'single' | 'double';
  copies: number;
  colorPages?: number[];
}

export interface JobEvent {
  at: Date;
  type: string;
  actor: string; // 'system', 'partner:<id>', 'device:<id>', 'admin:<email>', 'customer'
  detail?: string;
}

export interface IPrintJob {
  _id: mongoose.Types.ObjectId;
  jobId: string; // "J" + orderId
  orderId: string;
  paymentRef?: string;
  deliveryType: 'pickup' | 'delivery';
  partnerId?: string;
  acceptanceMode?: 'auto' | 'manual';
  status: JobStatus;
  files: JobFile[];
  service?: string[];
  deliveryNumber?: string;

  customerInfo?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  deliveryOption?: {
    type?: string;
    method?: string;
    partnerDeliveryPoint?: string;
    recipientName?: string;
    recipientPhone?: string;
    address?: string;
    flatBuilding?: string;
    city?: string;
    state?: string;
    pinCode?: string;
    scheduledSlot?: {
      date: string;
      slotId: string;
      label: string;
      startTime: string;
      endTime: string;
      target: 'store' | 'pickup_point';
    };
  };
  amount?: number;
  expectedDate?: string;

  assignedAt?: Date;
  acceptedAt?: Date;
  acceptBy?: Date;
  refundBy?: Date; // unset for jobs created by admins for orders paid before Phase 3
  firstClaimedAt?: Date;
  printedAt?: Date;

  claim?: { deviceId: string; leaseUntil: Date; printer?: string };
  /** Where it was printed, for the shop's records (set on the "printed" report). */
  printedBy?: { deviceId: string; deviceName?: string; printer?: string };
  rejections: Array<{ partnerId: string; reason?: string; at: Date }>;
  // Sent to the customer when the shop is late: refund now or keep waiting
  customerChoice?: { tokenHash: string; sentAt: Date };
  lastError?: string;
  needsAttention?: string;
  version: number;
  history: JobEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const fileSchema = new Schema<JobFile>(
  {
    url: { type: String, required: true },
    printUrl: String,
    name: { type: String, required: true },
    mime: String,
    pages: Number,
    pageSize: { type: String, enum: ['A4', 'A3'], default: 'A4' },
    color: { type: String, enum: ['color', 'bw', 'mixed'], default: 'bw' },
    sided: { type: String, enum: ['single', 'double'], default: 'single' },
    copies: { type: Number, default: 1, min: 1 },
    colorPages: [Number],
  },
  { _id: false }
);

const printJobSchema = new Schema<IPrintJob>(
  {
    jobId: { type: String, required: true, unique: true },
    orderId: { type: String, required: true, unique: true },
    paymentRef: String,
    deliveryType: { type: String, enum: ['pickup', 'delivery'], required: true },
    partnerId: String,
    acceptanceMode: { type: String, enum: ['auto', 'manual'] },
    status: { type: String, enum: JOB_STATUSES, required: true },
    files: { type: [fileSchema], default: [] },
    service: [String],
    deliveryNumber: String,

    customerInfo: {
      name: String,
      phone: String,
      email: String,
    },
    deliveryOption: {
      type: { type: String },
      method: String,
      partnerDeliveryPoint: String,
      recipientName: String,
      recipientPhone: String,
      address: String,
      flatBuilding: String,
      city: String,
      state: String,
      pinCode: String,
      scheduledSlot: {
        _id: false,
        date: String,
        slotId: String,
        label: String,
        startTime: String,
        endTime: String,
        target: String,
      },
    },
    amount: Number,
    expectedDate: String,

    assignedAt: Date,
    acceptedAt: Date,
    acceptBy: Date,
    refundBy: Date,
    firstClaimedAt: Date,
    printedAt: Date,

    claim: { deviceId: String, leaseUntil: Date, printer: String },
    printedBy: { deviceId: String, deviceName: String, printer: String },
    rejections: { type: [new Schema({ partnerId: String, reason: String, at: Date }, { _id: false })], default: [] },
    customerChoice: { tokenHash: String, sentAt: Date },
    lastError: String,
    needsAttention: String,
    version: { type: Number, default: 0 },
    history: {
      type: [new Schema<JobEvent>({ at: Date, type: String, actor: String, detail: String }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true, collection: 'print_jobs' }
);

printJobSchema.index({ partnerId: 1, status: 1, createdAt: -1 });
// Deadline sweeps
printJobSchema.index({ status: 1, acceptBy: 1 });
printJobSchema.index({ status: 1, refundBy: 1 });
printJobSchema.index({ 'customerChoice.tokenHash': 1 }, { sparse: true });

export default (mongoose.models.PrintJob as mongoose.Model<IPrintJob>) || mongoose.model<IPrintJob>('PrintJob', printJobSchema);
