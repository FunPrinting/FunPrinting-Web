import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // 'server-only' throws outside a React Server Component build; tests run in plain Node
      { find: /^server-only$/, replacement: fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)) },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  test: {
    environment: 'node',
    env: { LOG_LEVEL: 'silent' },
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: { provider: 'v8', include: ['src/lib/**'] },
  },
});
