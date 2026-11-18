/**
 * Password rules for reset and set-up. One list, used by the API routes (to enforce)
 * and by the forms (to show what is still missing).
 */
export const PASSWORD_RULES = [
  { id: 'length', label: 'At least 8 characters', test: (p: string) => p.length >= 8, error: 'Password must be at least 8 characters long' },
  { id: 'upper', label: 'One uppercase letter (A-Z)', test: (p: string) => /[A-Z]/.test(p), error: 'Password must contain at least one uppercase letter' },
  { id: 'lower', label: 'One lowercase letter (a-z)', test: (p: string) => /[a-z]/.test(p), error: 'Password must contain at least one lowercase letter' },
  { id: 'number', label: 'One number (0-9)', test: (p: string) => /[0-9]/.test(p), error: 'Password must contain at least one number' },
  { id: 'special', label: 'One special character (!@#$%^&*)', test: (p: string) => /[!@#$%^&*]/.test(p), error: 'Password must contain at least one special character (!@#$%^&*)' },
] as const;

/** The first unmet rule's message, or null if the password is acceptable. */
export function passwordError(password: string): string | null {
  return PASSWORD_RULES.find((r) => !r.test(password))?.error ?? null;
}
