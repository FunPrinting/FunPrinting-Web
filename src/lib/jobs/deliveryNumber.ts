import crypto from 'crypto';

/**
 * Human-readable code printed on the parcel and quoted at pickup:
 * one letter, the date (YYYYMMDD, India time) and 4 random characters,
 * e.g. "A20261117K7Q2". Unique enough per day for manual handover.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function generateDeliveryNumber(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const date = ist.toISOString().slice(0, 10).replace(/-/g, '');
  const bytes = crypto.randomBytes(5);
  const suffix = Array.from(bytes.subarray(1), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${ALPHABET[bytes[0] % 24]}${date}${suffix}`;
}
