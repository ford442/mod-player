import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * Source that runs inside the AudioWorkletGlobalScope: the processor and the two modules esbuild
 * bundles into public/worklets/openmpt-worklet.js (scripts/build-js-worklet.mjs).
 */
const WORKLET_FILES = [
  'audio-worklet/js/**/*.ts',
  'audio-worklet/workletProtocolConstants.ts',
  'audio-worklet/workletProtocolGuard.ts',
  'audio-worklet/positionRing.ts',
  'audio-worklet/positionRingWriter.ts',
  'audio-worklet/libRuntimeReady.ts',
  'audio-worklet/fxCharacterParams.ts', // bundled into fx-character-worklet.js (#453)
];

/** Window-only globals. AudioWorkletGlobalScope has none of them (CLAUDE.md: no DOM in the worklet). */
const DOM_ONLY_GLOBALS = [
  'window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location', 'history',
  'requestAnimationFrame', 'cancelAnimationFrame', 'alert', 'confirm', 'prompt', 'XMLHttpRequest',
];

/** What AudioWorkletGlobalScope adds on top of the ECMAScript builtins (not in the `globals` package). */
const audioWorkletGlobals = {
  AudioWorkletProcessor: 'readonly',
  registerProcessor: 'readonly',
  sampleRate: 'readonly',
  currentFrame: 'readonly',
  currentTime: 'readonly',
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'public/**',
      'vendor/**',
      'node_modules/**',
      'archive/**',
      'jules_patch/**',
      'subdir/**',
      // Agent worktrees live under .claude/; never lint a nested checkout from the outer one.
      '.claude/**',
      // Generated / non-app surfaces
      '**/*.cjs',
      // Emscripten --pre-js/--post-js snippets run in emcc's injected scope; tsconfig.scripts.json checks them.
      'cpp/**',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Warn-only for now; ratchet toward error once legacy call sites shrink.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Build tooling runs under Node, not in a browser.
    files: ['vite.config.ts', 'vitest.config.ts', 'vite-plugins/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // The worklet scope has no DOM. Enforced here rather than by convention alone.
    files: WORKLET_FILES,
    languageOptions: { globals: audioWorkletGlobals },
    rules: {
      'no-restricted-globals': [
        'error',
        ...DOM_ONLY_GLOBALS.map((name) => ({
          name,
          message: `'${name}' does not exist in AudioWorkletGlobalScope; communicate with the main thread via port.postMessage().`,
        })),
      ],
    },
  },
  {
    // Type-aware rules (#492: projectService, so each file is checked against the tsconfig that owns
    // it). Scoped to the async audio / GPU / engine code, where a dropped or misused promise is a real
    // bug (an unawaited start path, an async handler whose rejection nobody sees) rather than the
    // whole repo.
    files: [
      'audio/**/*.{ts,tsx}',
      'hooks/**/*.{ts,tsx}',
      'src/**/*.{ts,tsx}',
      'utils/**/*.{ts,tsx}',
      'audio-worklet/*.ts',
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    // The worklet sources live in their own tsconfig (no DOM lib), which the project service would not
    // pick for them; same rules.
    files: ['audio-worklet/js/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.worklet.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    // #492: the player engine core is framework-free. React observes it (hooks/usePlayerEngine.ts); it
    // never imports React or a React state library. This catches direct imports;
    // tests/playerEngineImports.test.ts walks the whole import graph from PlayerEngine.ts. The start
    // paths and action factories live under hooks/ only because their unit tests import them there.
    files: [
      'audio/engine/**/*.ts',
      'hooks/useAudioGraph.ts',
      'hooks/audioGraph/**/*.ts',
      'hooks/libOpenMPT/**/*.ts',
    ],
    ignores: ['hooks/libOpenMPT/useLibOpenMPTRefs.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: ['react', 'react-dom', 'zustand'].map((name) => ({
          name,
          message: 'The PlayerEngine core is framework-free (#492): React reads it through hooks/usePlayerEngine.ts.',
        })),
        patterns: [{
          group: ['react/*', 'react-dom/*', 'zustand/*', '@tanstack/*', '@react-three/*'],
          message: 'The PlayerEngine core is framework-free (#492): React reads it through hooks/usePlayerEngine.ts.',
        }],
      }],
    },
  },
  {
    // Node scripts. The Playwright ones also contain browser code inside page.evaluate callbacks,
    // so both global sets are declared. Type-checked separately (tsconfig.scripts.json).
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Ambient global declarations require `var` — `globalThis.foo` is only
    // typed when `foo` is declared with `var` (TS mirrors the real JS
    // semantics: `let`/`const` never become globalThis properties).
    files: ['**/*.d.ts'],
    rules: {
      'no-var': 'off',
    },
  },
  {
    // App code logs through utils/log.ts (scoped, diagnostics gated); console.warn/error stay available.
    // Exempt: tests and build config, the AudioWorklet sources (their own DEBUG-gated log; they must not
    // import the logger), and audio-worklet/diagnostics.ts, an explicit diagnostic printer.
    files: ['**/*.{ts,tsx}'],
    ignores: [
      '**/*.d.ts',
      'tests/**',
      'vite.config.ts',
      'vitest.config.ts',
      'vite-plugins/**',
      'audio-worklet/js/**',
      'audio-worklet/diagnostics.ts',
    ],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
);
