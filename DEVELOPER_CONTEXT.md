# Developer Context

> **Note to Future Agents:** This document is your primary source of truth. Read it first. It explains the "why" and "how" of the system, bypassing the need to reverse-engineer core architectural decisions.

## 1. High-Level Architecture & Intent

### Core Purpose
**XASM-1 Player** is a React-based web application for visualizing and playing audio tracker modules (MOD, XM, S3M, IT). Its key differentiator is a high-performance **WebGPU-based visualization engine** that renders tracker data as complex, hardware-accelerated grid patterns. It is designed to look and feel like a futuristic or retro-futuristic hardware device.

### Tech Stack
*   **Frontend:** React 18, TypeScript, Vite.
*   **Audio Engine:** `libopenmpt` (via WebAssembly) for accurate module playback.
*   **Graphics:** WebGPU (WGSL shaders) for the primary pattern visualization, with an HTML/CSS fallback.
*   **Styling:** Tailwind CSS.

### Design Patterns
*   **React Hook-Based State:** Logic is centralized in custom hooks (e.g., `useLibOpenMPT`).
*   **Data-Driven Rendering:** The UI is a direct reflection of the audio engine's state (playhead, channel data, pattern matrix).
*   **Shader-Based UI:** In advanced modes (`v0.37+`), the UI controls (Play/Stop/Seek) are rendered and handled directly within the shader and canvas, blurring the line between "app" and "visualization".
*   **Strategy Pattern (Implicit):** `PatternDisplay.tsx` switches between different rendering strategies (Simple, Texture, Extended, High-Precision) based on the filename of the selected shader.

---

## 2. Feature Map

| Feature | Entry Point / Key File | Description |
| :--- | :--- | :--- |
| **Audio Playback** | `hooks/useLibOpenMPT.ts` | Handles WASM initialization, audio context, playback loop, and state extraction (bpm, rows, channels). |
| **Pattern Visualization** | `components/PatternDisplay.tsx` | The core visual component. Manages the WebGPU context, buffers, and render loop. |
| **Shader Management** | `components/PatternDisplay.tsx` | dynamically loads `.wgsl` files, determines layout types (circular vs linear), and packs data accordingly. |
| **User Controls** | `components/Controls.tsx` | Standard HTML UI for volume, play/pause, and file loading. |
| **Media Overlay** | `components/MediaOverlay.tsx` | Displays images/videos synced to playback (managed via `App.tsx`). |
| **HTML Fallback** | `components/PatternSequencer.tsx` | A DOM-based grid view used when WebGPU is unavailable. |

---

## 3. Complexity Hotspots ("Here be Dragons")

### A. The "Shader Versioning" Logic (`PatternDisplay.tsx`)
**Why it's complex:** The application supports dozens of historical and experimental shader variations. The `PatternDisplay` component parses the shader **filename string** (e.g., `patternv0.37.wgsl`) to determine:
*   **Layout Type:** `simple`, `texture`, or `extended`.
*   **Buffer Packing Strategy:** Standard vs. High Precision (splitting data into `PackedA`/`PackedB`).
*   **Canvas Dimensions:** Specific versions force specific resolutions (e.g., 1024x1024, 2048x2016) to align with background textures ("bezel").
*   **Input Handling:** `v0.37` intercepts canvas clicks to trigger UI actions based on hardcoded polar coordinates.

**Agent Warning:** **DO NOT** indiscriminately refactor the `if (shaderFile.includes('v0.XX'))` chains. They are load-bearing. Adding a new shader often requires manually updating these checks to ensure the correct uniforms and buffers are sent.

### B. High-Precision Data Packing
**Why it's complex:** To pass rich tracker data (Note, Instrument, VolCmd, VolVal, EffCmd, EffVal) to the GPU efficiently, we use bit-packing.
*   **Standard:** Packs note/instrument into one u32, effect data into another.
*   **High Precision (`v0.36+`):** Uses a specific bit layout:
    *   `PackedA`: `[Note(8) | Instr(8) | VolCmd(8) | VolVal(8)]`
    *   `PackedB`: `[Unused(16) | EffCmd(8) | EffVal(8)]`
**Agent Warning:** If you modify how data is packed in TypeScript, you **MUST** update the corresponding bit-shifting logic in the WGSL shaders, or the visualization will break.

### C. Audio-Visual Synchronization
**Why it's complex:** `useLibOpenMPT` runs a tight loop to extract channel state (`ChannelShadowState`) like volume, frequency, and triggers. This data is double-buffered and sent to the GPU.
**Agent Warning:** Race conditions can occur between the WASM heap state and the React render cycle. The hook uses mutable refs (`channelStatesRef`) to bridge this gap without triggering excessive re-renders.

---

## 4. Inherent Limitations & Known Issues

### 1. WebGPU Browser Support
*   **Constraint:** The app fails gracefully to HTML mode if `navigator.gpu` is missing.
*   **Dev Note:** Automated testing of WebGPU features requires specific browser flags (headless Chrome with `--enable-unsafe-webgpu`).

### 2. Manual Video Looping
*   **Hacky:** Video textures for shaders are managed via a manual `requestAnimationFrame` loop in `PatternDisplay.tsx` to handle "ping-pong" playback (forward then reverse) because standard HTML5 video looping wasn't smooth enough for the desired aesthetic.

### 3. Shader Coupling
*   **Technical Debt:** The shaders are not pure assets; they are tightly coupled to the TypeScript host code. Changing a shader's uniform struct requires a matching change in `createUniformPayload`.

---

## 5. Dependency Graph & Key Flows

### Critical Path: Playback & Render
1.  **User Action:** User loads a `.mod` file.
2.  **Logic:** `App.tsx` calls `loadModule` in `useLibOpenMPT.ts`.
3.  **Audio:** `libopenmpt` WASM decodes the file and begins filling the AudioContext buffer.
4.  **State Sync:** `useLibOpenMPT`'s internal loop reads the current row/channel state from WASM memory.
5.  **Render Trigger:** React updates `sequencerMatrix` state.
6.  **Visualization:** `PatternDisplay` receives the new matrix.
    *   It packs the data into `Uint32Array` buffers.
    *   It writes these to the GPU (`device.queue.writeBuffer`).
    *   It submits a draw call to render the frame.

### Key Data Structures
*   **`PatternMatrix`**: A 2D array of cells representing the current pattern window.
*   **`ChannelShadowState`**: Real-time instantaneous data (volume, pan, frequency) for visual effects (e.g., lighting up a column when a note plays).
