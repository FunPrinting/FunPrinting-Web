import type { Instrumentation } from 'next';

/**
 * Next.js instrumentation hooks. The work is in instrumentation-node.ts (env check,
 * error tracking). Next also builds this file for the edge runtime; the
 * `process.env.NEXT_RUNTIME === 'nodejs'` tests must stay inline so the bundler
 * drops the Node-only import (mongoose, pino) from that build.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node');
    await registerNode();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { onRequestErrorNode } = await import('./instrumentation-node');
    await onRequestErrorNode(...args);
  }
};
