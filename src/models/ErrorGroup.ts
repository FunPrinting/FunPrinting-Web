import mongoose, { Schema } from 'mongoose';

/**
 * One record per distinct error ("issue"), grouped by fingerprint.
 *
 * Each occurrence increments `count` and updates `lastSeenAt`; the latest few
 * occurrences are kept in `samples` for debugging. A resolved issue that happens
 * again is reopened (status → open, `regressedAt` set). Issues not seen for
 * 90 days are deleted by a TTL index.
 */
export const ERROR_SOURCES = ['server', 'client', 'wss', 'desktop', 'mobile'] as const;
export const ERROR_LEVELS = ['error', 'warning'] as const;
export const ERROR_STATUSES = ['open', 'resolved', 'ignored'] as const;

export type ErrorSource = (typeof ERROR_SOURCES)[number];
export type ErrorLevel = (typeof ERROR_LEVELS)[number];
export type ErrorStatus = (typeof ERROR_STATUSES)[number];

export interface ErrorSample {
  at: Date;
  message: string;
  stack?: string;
  url?: string;
  method?: string;
  route?: string;
  requestId?: string;
  userId?: string;
  partnerId?: string;
  release?: string;
  userAgent?: string;
  digest?: string;
  context?: Record<string, unknown>;
}

export interface IErrorGroup {
  fingerprint: string;
  source: ErrorSource;
  level: ErrorLevel;
  name: string;
  message: string;
  route?: string;
  status: ErrorStatus;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  firstRelease?: string;
  lastRelease?: string;
  resolvedAt?: Date;
  resolvedBy?: string;
  regressedAt?: Date;
  note?: string;
  samples: ErrorSample[];
}

export const MAX_SAMPLES = 5;
export const RETENTION_DAYS = 90;

const sampleSchema = new Schema<ErrorSample>(
  {
    at: { type: Date, required: true },
    message: { type: String, required: true },
    stack: String,
    url: String,
    method: String,
    route: String,
    requestId: String,
    userId: String,
    partnerId: String,
    release: String,
    userAgent: String,
    digest: String,
    context: Schema.Types.Mixed,
  },
  { _id: false }
);

const errorGroupSchema = new Schema<IErrorGroup>(
  {
    fingerprint: { type: String, required: true, unique: true },
    source: { type: String, enum: ERROR_SOURCES, required: true },
    level: { type: String, enum: ERROR_LEVELS, required: true },
    name: { type: String, required: true },
    message: { type: String, required: true },
    route: String,
    status: { type: String, enum: ERROR_STATUSES, default: 'open' },
    count: { type: Number, default: 0 },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    firstRelease: String,
    lastRelease: String,
    resolvedAt: Date,
    resolvedBy: String,
    regressedAt: Date,
    note: { type: String, maxlength: 2000 },
    samples: { type: [sampleSchema], default: [] },
  },
  { timestamps: true }
);

// Admin list: newest first within a status/source/level filter
errorGroupSchema.index({ status: 1, lastSeenAt: -1 });
errorGroupSchema.index({ source: 1, level: 1, lastSeenAt: -1 });
// Retention: drop issues not seen for RETENTION_DAYS
errorGroupSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 });

export default (mongoose.models.ErrorGroup as mongoose.Model<IErrorGroup>) ||
  mongoose.model<IErrorGroup>('ErrorGroup', errorGroupSchema);
