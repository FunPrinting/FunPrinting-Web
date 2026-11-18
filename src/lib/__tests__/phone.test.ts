import { describe, expect, it } from 'vitest';
import { normalisePhoneInput } from '@/lib/phoneValidation';

describe('normalisePhoneInput', () => {
  it.each([
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+44 7911 123456', '+447911123456'],
  ])('%s -> %s', (input, phone) => {
    expect(normalisePhoneInput(input)).toEqual({ ok: true, phone });
  });

  it.each(['', '12345', '+91 12345 67890', '55555 55555', 'abc', undefined])('rejects %s', (input) => {
    expect(normalisePhoneInput(input).ok).toBe(false);
  });
});
