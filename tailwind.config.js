/** @type {import('tailwindcss').Config} */
import typography from '@tailwindcss/typography';

export default {
  content: [
    // Explicit source paths only — the previous "./**/*.{js,ts,jsx,tsx}" glob
    // accidentally matched every file in node_modules (three.js, fiber, etc.)
    // and caused a JS heap-OOM during production builds.
    "./index.html",
    "./index.tsx",
    "./App.tsx",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./hooks/**/*.{js,ts,jsx,tsx}",
    "./utils/**/*.{js,ts,jsx,tsx}",
    "./audio-worklet/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [
    typography,
  ],
}
