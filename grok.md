# grok.md — Grok AI Assistant Guide for mod-player (XASM-1 Player)

> Read this first. Complements the existing AGENTS.md and CLAUDE.md.

## Project Overview
**mod-player** is a high-end browser-based tracker music player (MOD, XM, S3M, IT, etc.) with real-time WebGPU-powered visualizations. It combines accurate libopenmpt WASM audio with stunning pattern displays, 3D studio mode, and media overlays. Feels like a futuristic hardware device.

- **Live Demo**: https://test.1ink.us/xm-player
- **Core Strengths**: Extremely polished audio-visual sync, deep shader system (50+ WGSL files), native C++ worklet option, PWA support.

## Technology Stack (Summary)
- React 18 + TypeScript + Vite
- libopenmpt (WASM) via AudioWorklet (JS + optional native C++)
- WebGPU + WGSL (pattern visualizer, bloom, chassis)
- Three.js / React Three Fiber (optional 3D mode)
- Tailwind + custom CSS variables

## Key Architecture Notes
- Strict separation between Main Thread and Audio Worklet Thread
- Shader versioning logic in PatternDisplay.tsx is load-bearing — do not refactor lightly
- Data packing (Uint32Array) must stay in sync with WGSL shaders
- COOP/COEP headers required for SharedArrayBuffer + WASM workers

## Grok Guidelines
- **Respect the existing structure**: The AGENTS.md and CLAUDE.md already contain deep technical detail. Use them as primary reference.
- **Shader changes**: Any modification to a shader’s Uniforms struct requires matching changes in createUniformPayload().
- **Performance & Polish**: This project is already very high quality — focus on refinement, new shader variants, or quality-of-life improvements.
- **Audio-Visual Sync**: Be extremely careful with timing and drift correction.
- **Future Features**: Music-reactive visuals, more 3D modes, better playlist management, or new tracker formats are welcome.

## Build & Deploy
```bash
npm run dev
npm run build          # (uses 4GB heap)
npm run build:emcc       # for native C++ worklet
python3 deploy.py
```

This is one of your most impressive and complete projects. Let’s keep it at the highest level. 🎛️✨