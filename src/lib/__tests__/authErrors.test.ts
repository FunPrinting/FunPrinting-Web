import { describe, expect, it, vi } from 'vitest';
import { authErrorMessage } from '@/lib/authErrors';
import { authOptions } from '@/lib/auth';

describe('authErrorMessage', () => {
  it('returns null when code is empty', () => {
    expect(authErrorMessage(null)).toBeNull();
    expect(authErrorMessage('')).toBeNull();
  });

  it('returns actionable message for OAuthCallback and AccessDenied', () => {
    expect(authErrorMessage('OAuthCallback')).toMatch(/cookie/i);
    expect(authErrorMessage('AccessDenied')).toMatch(/cancelled or blocked/i);
    expect(authErrorMessage('UnknownCode')).toMatch(/Could not sign you in/i);
  });
});

describe('authOptions logger & pages', () => {
  it('routes OAuth errors to /auth/signin', () => {
    expect(authOptions.pages?.error).toBe('/auth/signin');
  });

  it('downgrades access_denied to info and missing state cookie to warn without calling console.error', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      authOptions.logger?.error?.('OAUTH_CALLBACK_ERROR', new Error('access_denied'));
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).not.toHaveBeenCalled();

      authOptions.logger?.error?.('OAUTH_CALLBACK_ERROR', {
        error: new TypeError('State cookie was missing.'),
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).not.toHaveBeenCalled();

      authOptions.logger?.error?.('OAUTH_CALLBACK_ERROR', new Error('invalid_client'));
      expect(errSpy).toHaveBeenCalledTimes(1);
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });
});
