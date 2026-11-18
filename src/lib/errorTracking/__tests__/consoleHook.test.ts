import { describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('@/lib/errorTracking/server', () => ({
  captureInBackground: (input: Record<string, unknown>) => captured.push(input),
  isCapturing: () => false,
  describeThrown: (e: Error) => ({ name: e.name, message: e.message, stack: e.stack }),
}));

import { formatConsoleArgs, installConsoleHook } from '@/lib/errorTracking/consoleHook';

describe('console hook', () => {
  it('formats mixed arguments and picks up the thrown error', () => {
    const err = new RangeError('bad range');
    expect(formatConsoleArgs(['Failed to save', { id: 1 }, err])).toMatchObject({
      message: 'Failed to save {"id":1} bad range',
      name: 'RangeError',
    });
  });

  it('captures console.error as error, console.warn and Node warnings as warning, skips noise', () => {
    const printed: unknown[][] = [];
    const origError = console.error;
    const origWarn = console.warn;
    console.error = (...a: unknown[]) => printed.push(a);
    console.warn = (...a: unknown[]) => printed.push(a);
    try {
      installConsoleHook();
      installConsoleHook(); // idempotent
      console.error('❌ Payment verify failed', new Error('timeout'));
      console.warn('PRINTER_API_URLS not configured');
      console.error('(node:123) [MONGOOSE] Warning: Duplicate schema index');
      console.error('(node:5) ExperimentalWarning: something');
      console.error('[error-tracking] capture failed');
    } finally {
      console.error = origError;
      console.warn = origWarn;
    }
    expect(printed).toHaveLength(5); // output unchanged
    expect(captured.map((c) => [c.level, c.name])).toEqual([
      ['error', 'Error'],
      ['warning', 'ConsoleWarning'],
      ['warning', 'NodeWarning'],
    ]);
  });
});
