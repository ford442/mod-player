import { defineConfig, configDefaults } from 'vitest/config';

/**
 * Test projects (#535). Membership is by directory, so a test lands in a project by where it is written:
 *
 *   tests/unit/       pure TS — no real WASM, no Web Audio, no child processes     threads, 5 s
 *   tests/wasm/       instantiate the committed libopenmpt-*.wasm                  forks, 30 s, no isolation
 *   tests/webaudio/   render with node-web-audio-api (OfflineAudioContext)         forks, one file at a time, 60 s
 *   tests/build/      spawn child processes / inspect build outputs               forks, 120 s
 *
 * The slower projects get honest timeouts instead of a shared 5 s that only passed on an idle machine; the
 * webaudio project runs one file at a time because node-web-audio-api owns an audio backend and two renders
 * competing for it is what the old 20 s guard was really measuring. `VITEST_SKIP_BUILD=1` drops the build
 * project for local loops. ESLint keeps tests/unit/ from importing the heavy helpers (eslint.config.js).
 */
const skipBuild = process.env.VITEST_SKIP_BUILD === '1';

export default defineConfig({
  test: {
    // CI also writes JUnit XML (uploaded by the lint-and-build job), so a timeout names its test and project.
    reporters: process.env.CI ? ['default', ['junit', { outputFile: 'artifacts/vitest-junit.xml' }]] : ['default'],
    environment: 'node',
    globals: true,
    exclude: [
      ...configDefaults.exclude,
      'scripts/**',
      '**/_codeql_detected_source_root/**',
      '.claude/**',
    ],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          setupFiles: ['./tests/vitest.setup.ts'],
          pool: 'threads',
          testTimeout: 5_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'wasm',
          include: ['tests/wasm/**/*.test.ts'],
          setupFiles: ['./tests/vitest.setup.ts', './tests/wasm.setup.ts'],
          pool: 'forks',
          // One module registry per worker: the shared compiled WebAssembly.Module (tests/wasm.setup.ts) survives across files.
          isolate: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'webaudio',
          include: ['tests/webaudio/**/*.test.ts'],
          setupFiles: ['./tests/vitest.setup.ts'],
          pool: 'forks',
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      ...(skipBuild
        ? []
        : [
            {
              extends: true as const,
              test: {
                name: 'build',
                include: ['tests/build/**/*.test.ts'],
                setupFiles: ['./tests/vitest.setup.ts'],
                pool: 'forks' as const,
                testTimeout: 120_000,
                hookTimeout: 120_000,
              },
            },
          ]),
    ],
  },
});
