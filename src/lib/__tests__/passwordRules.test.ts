import { describe, expect, it } from 'vitest';
import { passwordError, PASSWORD_RULES } from '@/lib/passwordRules';

describe('passwordError', () => {
  it('accepts a password that meets every rule', () => {
    expect(passwordError('Sunny#2026')).toBeNull();
  });
  it('reports the first rule that is not met', () => {
    expect(passwordError('Ab1!')).toMatch(/8 characters/);
    expect(passwordError('lowercase1!')).toMatch(/uppercase/);
    expect(passwordError('UPPERCASE1!')).toMatch(/lowercase/);
    expect(passwordError('NoNumbers!!')).toMatch(/number/);
    expect(passwordError('NoSpecial123')).toMatch(/special/);
  });
  it('has a label for each rule', () => {
    expect(PASSWORD_RULES.map((r) => r.id)).toEqual(['length', 'upper', 'lower', 'number', 'special']);
  });
});
