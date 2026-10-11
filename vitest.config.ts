import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/vitest.setup.ts'],
    include: ['**/*.test.ts'],
    exclude: [
      ...configDefaults.exclude,
      'scripts/**',
      '**/_codeql_detected_source_root/**',
    ],
  },
});
