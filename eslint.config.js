import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

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
      // Generated / non-app surfaces
      '**/*.cjs',
      'scripts/**',
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
