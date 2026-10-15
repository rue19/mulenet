import { defineConfig } from 'vitest/config';

// Integration tests run against the live local network, one file at a time (shared chain and sponsor).
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 900_000, hookTimeout: 900_000, fileParallelism: false },
});
