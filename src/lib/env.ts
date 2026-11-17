import 'server-only';
import { z } from 'zod';

/**
 * Server environment, validated with zod.
 *
 * `getServerEnv()` validates on first call and caches the result. It never runs at
 * import time, so `next build` works without production secrets. A missing or invalid
 * variable throws one readable error that lists every problem.
 *
 * Required: what every request path needs (database, auth, payments).
 * Optional: integrations that are checked where they are used.
 */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/\/+$/, '') : undefined))
  .pipe(z.string().url().optional());

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Core
  MONGODB_URI: z.string().trim().min(1, 'is required'),
  NEXTAUTH_SECRET: z.string().trim().min(16, 'must be at least 16 characters'),
  NEXTAUTH_URL: optionalUrl,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,

  // Admin access
  ADMIN_EMAILS: optionalString,
  ADMIN_EMAIL: optionalString,
  NEXT_PUBLIC_ADMIN_EMAIL: optionalString,

  // Payments
  RAZORPAY_KEY_ID: z.string().trim().min(1, 'is required'),
  RAZORPAY_KEY_SECRET: z.string().trim().min(1, 'is required'),
  RAZORPAY_WEBHOOK_SECRET: optionalString,
  RAZORPAYX_ACCOUNT_NUMBER: optionalString,

  // Email (src/lib/mailer.ts)
  EMAIL_HOST: optionalString,
  EMAIL_PORT: z.coerce.number().int().positive().optional(),
  EMAIL_HOST_USER: optionalString,
  EMAIL_HOST_PASSWORD: optionalString,
  EMAIL_USER: optionalString,

  // Jobs and partner dispatch
  CRON_SECRET: optionalString,
  WSS_API_URL: optionalUrl,
  WSS_DISPATCH_SECRET: optionalString,

  // Rate limiting
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalString,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid server environment:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/** Validates an env object. Exported for tests; app code uses getServerEnv(). */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      const message = issue.code === 'invalid_type' && source[key] === undefined ? 'is required' : issue.message;
      return `${key} ${message}`;
    });
    throw new EnvError(issues);
  }
  return result.data;
}

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (!cached) cached = parseServerEnv(process.env);
  return cached;
}

/** Test helper: clears the cache so the next call re-reads process.env. */
export function resetServerEnvCache(): void {
  cached = null;
}
