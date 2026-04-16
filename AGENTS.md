# AGENTS.md

## Project Overview
**mod-player** (package name `react-libopenmpt-viewer`) is a browser-based MOD/tracker music player that combines retro audio emulation with modern graphics. It plays tracker module files (.mod, .xm, .s3m, .it, etc.) using `libopenmpt` compiled to WebAssembly, and renders real-time pattern visualizations via WebGPU WGSL shaders. The app also includes a 3D studio mode (React Three Fiber), a media overlay for images/video, and PWA support.

## Technology Stack
- **Frontend:** React 18 (TypeScript 5.4), JSX via `react-jsx`
- **Bundler / Dev Server:** Vite 5
- **Styling:** Tailwind CSS 3.3 + PostCSS + Autoprefixer, with custom scrollbars in `index.css`
- **3D Graphics:** `@react-three/fiber` + `@react-three/drei` + `three`
- **Visualization:** WebGPU (WGSL shaders), *not* WebGL
- **Audio Backend:** `libopenmpt` (WASM) inside a customized AudioWorklet
- **Native Audio Engine:** C++17 → Emscripten (`scripts/build-wasm.sh`)
- **Module System:** ES modules (`"type": "module"` in `package.json`)

## Audio Architecture (Three Tiers)
The audio logic is split across the **Main Thread** and the **Audio Worklet Thread**, with an optional high-performance native C++ worklet.

### 1. Main Thread
Managed by `hooks/useLibOpenMPT.ts`. Responsibilities:
- Initialize `libopenmpt` (loaded from CDN in `index.html` via `window.libopenmptReady`)
- Load module files, extract pattern matrices (`utils/patternExtractor.ts`)
- Maintain React UI state (play/pause, volume, pan, loop, seek position)
- Send commands to the worklet via `port.postMessage()`
- Read high-frequency playback data via a mutable ref (`playbackStateRef`) to avoid 60 Hz re-renders

### 2. JS AudioWorklet Engine
File: `public/worklets/openmpt-worklet.js`
- This is an `AudioWorkletProcessor` that dynamically `import()`s `./libopenmpt-audioworklet.js` inside the worklet thread.
- Dynamic import is used instead of static import to maintain compatibility with Chrome 113–116 (the WebGPU baseline) without requiring `addModule({ type: 'module' })`.
- Runs the `libopenmpt` render loop, reports position (~60 Hz) back to the main thread, and handles seek/load messages.
- **Rule:** You cannot use React state or DOM APIs inside the worklet. Communication is strictly via `port.postMessage()`.

### 3. Native C++/Wasm AudioWorklet Engine (Optional)
Files: `audio-worklet/OpenMPTWorkletEngine.ts`, `cpp/openmpt_wrapper.cpp`, `cpp/worklet_processor.cpp`
- Built with `scripts/build-wasm.sh` (requires Emscripten SDK).
- Emscripten flags: `-sAUDIO_WORKLET=1`, `-sWASM_WORKERS=1`, `-sMODULARIZE=1`, `-sEXPORT_NAME=createOpenMPTModule`.
- Outputs: `public/worklets/openmpt-native.js`, `.wasm`, `.aw.js` (these are `.gitignore`d until built).
- `useLibOpenMPT.ts` probes for `openmpt-native.js` at startup; if present, it instantiates `OpenMPTWorkletEngine`, which creates its own `AudioContext` + worklet thread in C++ land.
- The native engine polls a shared-memory `PositionInfo` struct for row/BPM/channel VU data.

### Fallback Path
If the JS AudioWorklet fails to initialize WASM, `hooks/useAudioGraph.ts` falls back to a `ScriptProcessorNode` on the main thread (deprecated but functional). This is triggered by the worklet posting an `error` message.

## WebGPU & Shaders
- **Language:** WGSL (WebGPU Shading Language).
- **Location:** Source shaders live in `/shaders`. There are 50+ versioned files (e.g., `patternv0.50.wgsl`, `chassisv0.40.wgsl`).
- **Shader Groups (in `App.tsx`):**
  - **Square:** v0.44, v0.43, v0.40, v0.39, v0.21
  - **Circular:** v0.50, v0.49, v0.48, v0.47, v0.46, v0.45, v0.42, v0.38, v0.35_bloom, v0.30
  - **Video:** v0.23 (Clouds), v0.24 (Tunnel)
- **Pipeline:** Shaders are fetched as raw text strings (often via `fetch()` or bundled strings) and passed into the WebGPU render pipeline in components like `PatternDisplay.tsx` and `Studio3D.tsx`.
- **Bloom:** Post-processing bloom passes live in `utils/bloomPostProcessor.ts`; presets are defined in `types/bloomPresets.ts`.
- **Compatibility:** WebGPU support is required for the shader visualizer. If unavailable, the app falls back to an HTML pattern renderer.

## Directory Map
- **`/components`** – React UI elements (`App.tsx`, `PatternDisplay.tsx`, `Controls.tsx`, `Studio3D.tsx`, `MediaOverlay.tsx`, `ChannelMeters.tsx`, etc.)
- **`/hooks`** – Core logic hooks
  - `useLibOpenMPT.ts` – Main audio bridge and state
  - `useAudioGraph.ts` – Audio graph construction and playback start
  - `useWorkletLoader.ts` – AudioWorklet module loading with retry/diagnostics
  - `usePlaylist.ts`, `useKeyboardShortcuts.ts`, `useWebGPURender.ts`, `useWebGLOverlay.ts`
- **`/audio-worklet`** – TypeScript wrapper for the native C++ engine (`OpenMPTWorkletEngine.ts`, `types.ts`, `diagnostics.ts`)
- **`/cpp`** – C++ source for the native worklet (`openmpt_wrapper.cpp`, `openmpt_wrapper.h`, `worklet_processor.cpp`, `pre.js`)
- **`/public/worklets`** – AudioWorklet JS processors served as static assets
  - `openmpt-worklet.js` – JS worklet processor (tracked in git)
  - `libopenmpt-audioworklet.js` – WASM glue for the JS worklet
  - `openmpt-native.js` / `.wasm` / `.aw.js` – Generated by Emscripten (ignored in git)
- **`/shaders`** – WGSL shader source files
- **`/utils`** – `patternExtractor.ts`, `bloomPostProcessor.ts`, `remoteMedia.ts`, `colorSchemes.ts`, `gpuPacking.ts`, etc.
- **`/types`** – Shared TS types, including `bloomPresets.ts`
- **`/src`** – Supplementary code (`src/lib/paths.ts`, `src/shaders/`, `src/utils/shaderHelpers.ts`)
- **`/docs`** – Technical guides (`BLOOM.md`, `planning/`, `agent-swarm/`)
- **`/scripts`** – `build-wasm.sh`, `benchmark_loadFromURL.cjs`, `make_bezel_transparent.py`
- **`/dist`** – Vite production build output (deployment artifact)

## Build, Dev, Test & Deploy Commands

### Development
```bash
npm install
npm run dev        # Vite dev server (needs WebGPU-enabled browser, e.g., Chrome/Edge/Arc)
```

### Build
```bash
npm run build           # tsc && vite build (uses 4GB max-old-space-size)
npm run typecheck       # tsc --noEmit
npm run lint            # Currently exits 0 (no active linting rules)
npm run preview         # Preview the production build locally
```

### Native Audio Engine Build
```bash
npm run build:worklet   # Alias for bash ./build-wasm.sh
npm run build:emcc      # Alias for bash scripts/build-wasm.sh
```
- **Prerequisite:** Emscripten SDK (emsdk) 4.0+ activated in your shell.
- The script auto-clones and builds `libopenmpt` from GitHub if headers are missing.
- Outputs go to `public/worklets/openmpt-native.js`, `.wasm`, and `.aw.js`.

### Deployment
```bash
python3 deploy.py
```
- Builds the project with `VITE_APP_BASE_PATH` automatically derived from the `REMOTE_DIRECTORY` variable inside `deploy.py`.
- SFTP-uploads the `dist/` folder to the configured remote server.
- For manual subdirectory deployment: `VITE_APP_BASE_PATH=/xm-player/ npm run build`

## Code Style & Conventions
- **TypeScript strictness is high:** `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- **File naming:** PascalCase for components (`PatternDisplay.tsx`), camelCase for hooks/utilities (`useLibOpenMPT.ts`, `patternExtractor.ts`).
- **Tailwind content paths are explicit** (not a broad `**/*` glob) to avoid build OOMs caused by `node_modules` matches.
- **Fix comments:** The codebase prefixes engineering fixes with identifiers like `AUDIO-001 FIX` and `TIMING FIX`.
- **Base URL awareness:** Almost all asset URLs are constructed with `import.meta.env.BASE_URL` so the app works when deployed under a subdirectory.

## CI / Testing
- **No unit-test framework** is currently installed (no Jest/Vitest/Playwright tests in `package.json`).
- **GitHub Actions** (`.github/workflows/ci.yml`) runs two jobs:
  1. `lint-and-build` – `npm install` → `npm run lint` → `tsc --noEmit` → `npm run build` → verifies `dist/index.html` and `dist/assets` exist.
  2. `wasm-smoke-test` – Installs Emscripten, verifies `build-wasm.sh` exists, and runs `shellcheck` (or `bash -n`) for syntax validation.

## Security & CORS Considerations
- **COOP/COEP headers:** `vite.config.ts` sets:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: credentialless`
  - This unlocks `SharedArrayBuffer` / Atomics for Emscripten WASM workers while still allowing cross-origin CDN resources (e.g., the esm.sh React importmap and the libopenmpt script).
- **CORS:** Loading MOD files or WASM from external URLs can trigger CORS errors. `utils/remoteMedia.ts` handles remote fetching; ensure servers send proper CORS headers.
- **Service Worker:** `public/sw.js` is scope-aware and works under any base path. It caches module files (`.mod`, `.xm`, `.s3m`, `.it`, `.mptm`, `.wasm`) with a cache-first strategy.
- **PWA:** `public/manifest.json` and `sw.js` provide installability. SW registration only happens in production builds (`import.meta.env.PROD`).

## Common Pitfalls
1. **Worklet Caching:** Browsers cache AudioWorklet files aggressively. If you edit `openmpt-worklet.js` or any worklet asset, hard-refresh or disable cache in DevTools.
2. **Shader Imports:** If you rename a shader file in `/shaders`, you **must** update the reference in `App.tsx` (the `SHADER_GROUPS` constant) and in any component that fetches the file by name (e.g., `PatternDisplay.tsx`).
3. **Base Path Mismatch:** Deploying to a subdirectory without setting `VITE_APP_BASE_PATH` will break shader fetches, worklet loads, and the default module fetch. Use `deploy.py` or set the env var manually before building.
4. **Missing Native Engine:** `openmpt-native.js` does not exist in the repo by default. If you want the native C++ worklet option, run `npm run build:emcc` after installing the Emscripten SDK.
5. **Node OOM during build:** The Tailwind config was intentionally narrowed to explicit paths. Do not broaden the `content` glob to `"./**/*.{js,ts,jsx,tsx}"` or production builds may run out of heap memory.
