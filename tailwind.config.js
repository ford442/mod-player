/** @type {import('tailwindcss').Config} */
import typography from '@tailwindcss/typography';

export default {
  content: [
    // Explicit source paths only — the previous "./**/*.{js,ts,jsx,tsx}" glob
    // accidentally matched every file in node_modules (three.js, fiber, etc.)
    // and caused a JS heap-OOM during production builds.
    //
    // `.tsx` only, and only directories that render JSX: Tailwind's scanner reads comments
    // too, so scanning hooks/, utils/ or audio-worklet/ turned bit-layout notes like
    // `[inst:8]` into bogus arbitrary-property rules (and the build's
    // `"inst" is not a known CSS property` warning). tests/tailwindContent.test.ts keeps this
    // list in sync with the directories that actually contain .tsx files.
    "./index.html",
    "./index.tsx",
    "./App.tsx",
    "./app/**/*.tsx",
    "./components/**/*.tsx",
    "./context/**/*.tsx",
    "./src/**/*.tsx",
  ],
  theme: {
    extend: {
      colors: {
        panel: {
          base:   'var(--panel-base)',
          raised: 'var(--panel-raised)',
          inset:  'var(--panel-inset)',
        },
        edge: {
          highlight: 'var(--edge-highlight)',
          shadow:    'var(--edge-shadow)',
        },
        accent: 'var(--text-accent)',
        glow:   'var(--glow-color)',
      },
      borderColor: {
        panel:        'var(--panel-border)',
        'panel-strong': 'var(--panel-border-strong)',
      },
      boxShadow: {
        'panel':
          '0 1px 0 0 var(--edge-highlight) inset, 0 -1px 0 0 var(--edge-shadow) inset, 0 4px 6px -1px rgba(0,0,0,0.1)',
        'panel-inset':
          '0 1px 0 0 var(--edge-shadow) inset, 0 -1px 0 0 var(--edge-highlight) inset',
        'glow': '0 0 20px var(--glow-color)',
      },
    },
  },
  plugins: [
    typography,
  ],
}
