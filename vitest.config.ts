import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // E2E hits real Honcho; default 5s is too tight for cold workspace setup.
    testTimeout: 30000,
    // Scaffold ships before Task 5 / Task 6 cases land; don't fail CI on empty.
    passWithNoTests: true,
  },
});
