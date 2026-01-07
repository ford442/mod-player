# AGENTS.md

## Project Context
**mod-player** is a browser-based MOD/tracker music player that combines retro audio emulation with modern graphics.
* **Frontend:** React (TypeScript) + Vite + Tailwind CSS.
* **Audio Engine:** `libopenmpt` (WASM) running inside a customized **AudioWorklet**.
* **Visualization:** **WebGPU** (WGSL shaders) for the background "Chassis" and "Pattern" visualizers.

## Key Directives

### 1. Audio Architecture (The "Two Worlds")
The audio logic is split between the **Main Thread** and the **Audio Worklet Thread**.
* **Main Thread:** Managed by `hooks/useLibOpenMPT.ts`. Handles UI state, loading files, and sending messages (play/pause) to the worklet.
* **Worklet Thread:** Located in `public/worklets/openmpt-processor.js`. This runs the actual audio rendering loop.
* **Rule:** You cannot use React state or DOM APIs inside the worklet. Communication happens strictly via `port.postMessage()`.

### 2. WebGPU & Shaders
* **Language:** WGSL (WebGPU Shading Language).
* **Location:** Source shaders are in `/shaders`.
* **Pipeline:** Shaders are loaded as raw strings/assets. If you modify a shader file (e.g., `chassisv0.37.wgsl`), ensure the `MediaOverlay.tsx` or relevant component is referencing that specific version.
* **Compatibility:** This project uses WebGPU, not WebGL. Ensure any new graphics code targets the `navigator.gpu` API.

### 3. Build & Assets
* **Worklets:** The audio processor lives in `public/worklets/`. Vite serves this directory as static assets.
* **WASM:** `libopenmpt.js` and `.wasm` files are loaded dynamically.
* **Deployment:** The build artifact is the `dist/` folder.

## Directory Map
* **`/src`**: React application source.
    * **`/components`**: UI elements (Sequencer, Header, Controls).
    * **`/hooks`**: `useLibOpenMPT.ts` (Core audio bridge).
    * **`/utils`**: `bloomPostProcessor.ts` (WebGPU render passes) and `remoteMedia.ts` (Module fetching).
* **`/shaders`**: WGSL shader source files.
    * *Note:* There are many versions (e.g., `patternv0.39.wgsl`). Always check which one is currently imported in the code.
* **`/public`**: Static assets.
    * **`/worklets`**: The AudioWorklet processor code.
* **`/docs`**: Technical guides (`SHADER_UI_GUIDE.md`, `BLOOM.md`).

## Available Tools & Commands

### Development
* **Start Dev Server:** `npm run dev`
    * *Note:* Requires a browser with WebGPU enabled (Chrome/Edge/Arc).
* **Lint/Type Check:** `tsc` (via IDE or build step).

### Deployment
* **Command:** `python3 deploy.py`
* **Action:** Builds the project (`npm run build`) and uploads the `dist/` directory to the server via SFTP.
* **Pre-requisite:** Ensure `dist/` is generated before running the python script if not handled automatically.

## Common Pitfalls
1.  **Worklet Caching:** Browsers cache AudioWorklet files aggressively. If you edit `openmpt-processor.js`, you may need to hard-refresh or disable cache in DevTools to see changes.
2.  **Shader Imports:** If you rename a shader file, you MUST update the import path in the TypeScript file (usually `MediaOverlay.tsx` or `viewWebGPU.ts`).
3.  **CORS:** Loading MOD files or WASM from external URLs can trigger CORS errors. Ensure `remoteMedia.ts` handles fetch requests correctly.
