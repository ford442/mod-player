# Developer Context

> **Note to Future Agents:** This document is your primary source of truth. Read it first. It explains the "why" and "how" of the system, bypassing the need to reverse-engineer core architectural decisions.

## 1. High-Level Architecture & Intent

### Core Purpose
**XASM-1 Player** is a React-based web application for visualizing and playing audio tracker modules (MOD, XM, S3M, IT). Its key differentiator is a high-performance **WebGPU-based visualization engine** that renders tracker data as complex, hardware-accelerated grid patterns. It is designed to look and feel like a futuristic or retro-futuristic hardware device.

### Tech Stack
*   **Frontend:** React 18, TypeScript, Vite.
*   **Audio Engine:** `libopenmpt` (via WebAssembly) for accurate module playback.
*   **Graphics:** WebGPU (WGSL shaders) for the primary pattern visualization, with a multi-pass rendering architecture (Background/Chassis Pass -> Pattern Pass).
*   **Styling:** Tailwind CSS.

### Design Patterns
*   **React Hook-Based State:** Logic is centralized in custom hooks (e.g., `useLibOpenMPT`).
*   **Data-Driven Rendering:** The UI is a direct reflection of the audio engine's state (playhead, channel data, pattern matrix).
*   **Hybrid Shader UI:** In advanced modes (`v0.37+`), the UI controls (Play/Stop/Seek) are physically rendered by the shader and interactions are calculated via polar coordinate hit-testing on the canvas, blurring the line between "app" and "visualization".
*   **Strategy Pattern (Implicit):** `PatternDisplay.tsx` switches between different rendering strategies (Simple, Texture, Extended, High-Precision) based on the filename of the selected shader.

---

## 2. Feature Map

| Feature | Entry Point / Key File | Description |
| :--- | :--- | :--- |
| **Audio Playback** | `hooks/useLibOpenMPT.ts` | Handles WASM initialization, audio context. Tries `AudioWorkletNode` first, falls back to `ScriptProcessorNode`. |
| **Pattern Visualization** | `components/PatternDisplay.tsx` | The core visual component. Manages the WebGPU context, buffers, render loop, and shader hot-swapping. |
| **Shader Management** | `components/PatternDisplay.tsx` | Dynamically loads `.wgsl` files. Parses filenames to determine capabilities (e.g., `v0.37` implies circular layout + UI controls). |
| **User Controls** | `components/Controls.tsx` | Standard HTML UI for volume, play/pause, and file loading (fallback/auxiliary controls). |
| **Media Overlay** | `components/MediaOverlay.tsx` | Displays images/videos synced to playback (managed via `App.tsx`). |
| **HTML Fallback** | `components/PatternSequencer.tsx` | A DOM-based grid view used when WebGPU is unavailable. |

---

## 3. Complexity Hotspots ("Here be Dragons")

### A. The "Shader Versioning" Logic (`PatternDisplay.tsx`)
**Why it's complex:** The application supports dozens of historical and experimental shader variations. The `PatternDisplay` component parses the shader **filename string** (e.g., `patternv0.37.wgsl`) to determine:
*   **Layout Type:** `simple`, `texture`, or `extended`.
*   **Buffer Packing Strategy:** Standard vs. High Precision (splitting data into `PackedA`/`PackedB`).
*   **Canvas Dimensions:** Specific versions force specific resolutions (e.g., `v0.37` -> 1024x1024, `v0.26` -> 2048x2016) to align with background "chassis" textures.
*   **Input Handling:** `v0.37` intercepts canvas clicks to trigger UI actions based on hardcoded polar coordinates.

**Agent Warning:** **DO NOT** indiscriminately refactor the `if (shaderFile.includes('v0.XX'))` chains. They are load-bearing. Adding a new shader often requires manually updating these checks to ensure the correct uniforms and buffers are sent.

### B. High-Precision Data Packing
**Why it's complex:** To pass rich tracker data (Note, Instrument, VolCmd, VolVal, EffCmd, EffVal) to the GPU efficiently, we use bit-packing.
*   **Standard:** Packs note/instrument into one u32, effect data into another.
*   **High Precision (`v0.36+`):** Uses a specific bit layout:
    *   `PackedA`: `[Note(8) | Instr(8) | VolCmd(8) | VolVal(8)]`
    *   `PackedB`: `[Unused(16) | EffCmd(8) | EffVal(8)]`
**Agent Warning:** If you modify how data is packed in TypeScript, you **MUST** update the corresponding bit-shifting logic in the WGSL shaders.

### C. Audio Architecture (Worklet vs ScriptProcessor)
**Why it's complex:** `useLibOpenMPT` implements a dual-strategy audio graph.
1.  **Preferred:** `AudioWorkletNode` (for smoother performance on main thread).
2.  **Fallback:** `ScriptProcessorNode` (deprecated but necessary for compatibility).
**Agent Warning:** When debugging audio glitches, check which path is active. The data messaging structure differs slightly between the two.

### D. Audio-Visual Synchronization
**Why it's complex:** `useLibOpenMPT` runs a tight loop to extract channel state (`ChannelShadowState`). This data is double-buffered and sent to the GPU.
**Agent Warning:** Race conditions can occur between the WASM heap state and the React render cycle. The hook uses mutable refs (`channelStatesRef`) to bridge this gap without triggering excessive re-renders.

---

## 4. Inherent Limitations & Known Issues

### 1. WebGPU Browser Support
*   **Constraint:** The app fails gracefully to HTML mode if `navigator.gpu` is missing.
*   **Dev Note:** Automated testing of WebGPU features requires specific browser flags (headless Chrome with `--enable-unsafe-webgpu`).

### 2. Manual Video Looping
*   **Hacky:** Video textures for shaders are managed via a manual `requestAnimationFrame` loop in `PatternDisplay.tsx` (often implementing "ping-pong" playback) because standard HTML5 video looping wasn't smooth enough for the desired aesthetic.

### 3. Shader Coupling
*   **Technical Debt:** The shaders are not pure assets; they are tightly coupled to the TypeScript host code. Changing a shader's uniform struct requires a matching change in `createUniformPayload`.

### 4. GPU Buffer Size Mismatches
*   **Known Issue:** WebGPU buffer size mismatch occasionally causes a pipeline crash when switching between modules with different channel counts. Invariants have been added to prevent regressions.

---

## 5. Dependency Graph & Key Flows

### Critical Path: Playback & Render
1.  **User Action:** User loads a `.mod` file.
2.  **Logic:** `App.tsx` calls `loadModule` in `useLibOpenMPT.ts`.
3.  **Audio:** `libopenmpt` WASM decodes the file and fills AudioContext buffer (via Worklet or ScriptProcessor).
4.  **State Sync:** `useLibOpenMPT`'s internal loop reads the current row/channel state from WASM memory.
5.  **Render Trigger:** React updates `sequencerMatrix` state.
6.  **Visualization:** `PatternDisplay` receives the new matrix.
    *   **Pass 1 (Chassis):** Renders background bezel/chassis texture (e.g., `chassisv0.37.wgsl`).
    *   **Pass 2 (Pattern):** Renders the data grid on top.
    *   It packs the data into `Uint32Array` buffers.
    *   It writes these to the GPU (`device.queue.writeBuffer`).
    *   It submits a draw call to render the frame.

### Key Data Structures
*   **`PatternMatrix`**: A 2D array of cells representing the current pattern window.
*   **`ChannelShadowState`**: Real-time instantaneous data (volume, pan, frequency) for visual effects (e.g., lighting up a column when a note plays).

---

## 6. Production, COEP, and External Dependencies

### Cross-Origin Isolation (COOP / COEP)

The app needs **cross-origin isolation** so Emscripten can use `SharedArrayBuffer` / WASM workers (audio worklet + parser worker).

| Header | Dev (`vite.config.ts`) | Production (`public/.htaccess` → `dist/.htaccess`) |
|--------|------------------------|-----------------------------------------------------|
| `Cross-Origin-Opener-Policy` | `same-origin` | `same-origin` |
| `Cross-Origin-Embedder-Policy` | `credentialless` | `credentialless` |

**Keep dev and production aligned on `credentialless`.** Older Apache configs used `require-corp`, which blocks any cross-origin script, WASM, or worker asset that does not send `Cross-Origin-Resource-Policy` (CORP) or proper CORS. That can break:

- Main-thread `libopenmptjs.js` from CDN
- The same script fetched again inside `openmpt-parser.worker`
- esm.sh React importmap modules

If production must use `require-corp`, every external dependency below must satisfy CORP **and** you should self-host libopenmpt under `/xm-player/` with explicit headers.

### External CDN Chain (load order)

1. Vite bundle (`index-*.js`, `index-*.css`)
2. esm.sh React importmap (`react`, `react-dom/client`)
3. `https://wasm.noahcohn.com/libmpt/libopenmptjs.js` (main thread, `index.html`)
4. Same CDN URL inside `workers/openmpt-parser.worker.ts` (worker thread)
5. Audio worklet scripts under `/xm-player/worklets/`

`index.html` includes `preconnect` hints for `wasm.noahcohn.com` and `esm.sh`.

### CORP / CORS Requirements

| Resource | URL | Required for `credentialless` | Required for `require-corp` |
|----------|-----|------------------------------|----------------------------|
| libopenmpt JS + WASM | `wasm.noahcohn.com/libmpt/*` | CORS or CORP `cross-origin` (current CDN ✅) | CORP `cross-origin` on JS **and** `.wasm` |
| React (importmap) | `esm.sh/react@18.2.0` | Typically works under `credentialless` | Verify CORP on each esm.sh response |
| App static assets | `/xm-player/assets/*` | Same-origin | Same-origin |
| Worklets | `/xm-player/worklets/*` | Same-origin | Same-origin |

**Operational risk:** If the CDN drops `Cross-Origin-Resource-Policy: cross-origin`, parser worker or main-thread WASM init can fail under strict COEP. The parser path falls back to main-thread parse when the worker errors, but audio still depends on the CDN script in `index.html`.

### Self-hosting libopenmpt (recommended for reproducible deploys)

To remove CDN dependency:

1. Copy `libopenmptjs.js` and its `.wasm` sibling into `public/libmpt/` (or vendor from a pinned libopenmpt release).
2. Point `index.html` and `workers/openmpt-parser.worker.ts` at `${import.meta.env.BASE_URL}libmpt/libopenmptjs.js`.
3. Serve with `Cross-Origin-Resource-Policy: cross-origin` if COEP is ever `require-corp`.
4. Optionally add SRI (`integrity=`) on the script tag once the file hash is pinned.

### Stale `/assets/` on the server

Vite emits hashed filenames (`index-<hash>.js`, `index-<hash>.css`). Incremental deploys that only upload new files leave **orphaned** bundles (`modplayer.1iss`, old `index-*.js`). Always deploy with pruning enabled (default). See `docs/DEPLOY.md`.

### Stylesheet contract

Production CSS must be a Vite-extracted `assets/index-<hash>.css` linked from `index.html`. Names ending in `.1iss` or missing from `dist/` indicate a stale or corrupt deploy — `npm run verify:build` rejects these before upload.
