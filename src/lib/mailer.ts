import 'server-only';
import nodemailer, { Transporter } from 'nodemailer';
import { logger } from '@/lib/logger';

/**
 * Shared SMTP transporter.
 *
 * Credentials come from env only (EMAIL_HOST_USER / EMAIL_HOST_PASSWORD).
 * The transporter is created lazily so a missing config never crashes at import time.
 */
let cachedTransporter: Transporter | null = null;

export function isMailConfigured(): boolean {
  return Boolean(process.env.EMAIL_HOST_USER && process.env.EMAIL_HOST_PASSWORD);
}

/**
 * Returns the transporter, or throws a clear error if email is not configured.
 * Callers already wrap sends in try/catch and return false on failure.
 */
export function getMailTransporter(): Transporter {
  if (!isMailConfigured()) {
    const message = 'Email is not configured: EMAIL_HOST_USER and EMAIL_HOST_PASSWORD must be set';
    logger.error(message);
    throw new Error(message);
  }
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_HOST_USER,
        pass: process.env.EMAIL_HOST_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }
  return cachedTransporter;
}
