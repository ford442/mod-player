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
  'audio-worklet/libRuntimeReady.ts',
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
      // Dead tier-A shader-migration tools (one is not even parseable); removed from the repo in
      // the dead-code cleanup, at which point these two entries go too.
      'scripts/apply-tier-a-includes.mjs',
      'scripts/migrate-tier-a.mjs',
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
    // Type-aware rules (need type information, so scoped to the directories where a dropped
    // promise is a real bug rather than the whole repo). The worklet sources are outside the root
    // tsconfig, hence the second project.
    files: ['src/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}', 'audio-worklet/**/*.ts', 'utils/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.worklet.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
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
);
