import { defineConfig, configDefaults } from 'vitest/config';

/**
 * The suite is four Vitest projects, chosen by the directory a test lives in (#541):
 *
 * - `unit`     tests/unit/     — pure TS. No WASM instantiation, no Web Audio, no child processes.
 *                                Thread pool, default 5 s timeout. `npm run test:unit` is the fast loop.
 * - `wasm`     tests/wasm/     — instantiate the committed real-WASM libopenmpt. Forks, 30 s, and one
 *                                process per worker reused across files (`isolate: false`) so the
 *                                compiled `WebAssembly.Module` (tests/helpers/wasmModuleCache.ts) is
 *                                compiled once per worker, not once per file.
 * - `webaudio` tests/webaudio/ — real `node-web-audio-api` contexts / offline renders. One file at a
 *                                time, 60 s, and after `unit` + `wasm` (groupOrder) so a render is not
 *                                racing other CPU-bound workers.
 * - `build`    tests/build/    — child processes (scripts, python, git). Forks, 120 s, run last;
 *                                `VITEST_SKIP_BUILD=1` drops it from a local loop.
 *
 * `tests/unit/` must not import the Web Audio / WASM harnesses — ESLint (`no-restricted-imports`
 * in eslint.config.js) and tests/unit/testProjectBoundaries.test.ts enforce it.
 */
const shared = {
  environment: 'node' as const,
  globals: true,
  setupFiles: ['./tests/vitest.setup.ts'],
};

const skipBuild = process.env.VITEST_SKIP_BUILD === '1';

export default defineConfig({
  test: {
    // On CI, also write JUnit so a timeout names its test and project in the uploaded artifact.
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    ...(process.env.CI ? { outputFile: { junit: 'test-results/junit.xml' } } : {}),
    exclude: [
      ...configDefaults.exclude,
      'scripts/**',
      '**/_codeql_detected_source_root/**',
      '.claude/**',
    ],
    projects: [
      {
        test: {
          ...shared,
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          pool: 'threads',
          testTimeout: 5_000,
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          ...shared,
          name: 'wasm',
          include: ['tests/wasm/**/*.test.ts'],
          pool: 'forks',
          isolate: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
          unstubGlobals: true,
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          ...shared,
          name: 'webaudio',
          include: ['tests/webaudio/**/*.test.ts'],
          pool: 'forks',
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 60_000,
          hookTimeout: 60_000,
          sequence: { groupOrder: 1 },
        },
      },
      ...(skipBuild
        ? []
        : [
            {
              test: {
                ...shared,
                name: 'build',
                include: ['tests/build/**/*.test.ts'],
                pool: 'forks' as const,
                testTimeout: 120_000,
                hookTimeout: 120_000,
                sequence: { groupOrder: 2 },
              },
            },
          ]),
    ],
  },
});
