/** "18 Nov 2026, 11:00 pm" (short) or "18 November 2026 at 11:00 pm" (long), in Indian format. */
export function formatDate(dateString: string, format: 'short' | 'long' = 'short'): string {
  return new Date(dateString).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: format === 'long' ? 'long' : 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** When an order is expected if the shop has not set a date: one day after it was placed. */
export function getDefaultExpectedDate(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
}
