# React libopenmpt Viewer

A small React + TypeScript web app for loading and previewing tracker module files (MOD/IT/S3M/XM, etc.) using libopenmpt compiled to WebAssembly. The app also includes a visual pattern viewer (HTML and optional WebGPU/WGSL shaders) and a simple media overlay for images / GIFs / video.

Key features

Recent changes
- v0.35: added "Donut & Night Mode" shader `shaders/patternv0.35_bloom.wgsl` (channel invert toggle, white center island, studio dim + UV ring); also includes previous bloom helpers in `utils/bloomPostProcessor.ts`.

- Play tracker modules in the browser using libopenmpt (WASM).
- Pattern view with three renderer backends: **WebGPU** (WGSL shaders), **WebGL2** (GLSL reference renderer), and **HTML** fallback.
- Simple media panel & overlay for images, GIFs, and videos synchronized with playback.
- Built with Vite, React, and TypeScript. Tailwind CSS is used for styling.

Quick start

Prerequisites

- Node.js (16+ recommended) and npm or a compatible package manager.
- A modern browser. WebGPU is the default renderer (Chrome 113+, Edge 113+, Arc). WebGL2 and HTML fallbacks work in any modern browser.

Install dependencies

```bash
npm install
```

Run the development server

```bash
npm run dev
```

Open your browser to the address printed by Vite (typically http://localhost:5173) and load a tracker module using the UI.

Build for production

```bash
npm run build
npm run preview
```

Usage

- Click "Load" or drag-and-drop a tracker module file (.mod, .it, .s3m, .xm, etc.) to load it.
- Use the playback controls to play/stop and toggle looping.
- Switch pattern renderers via URL param, debug panel, or devtools:
  - `?renderer=webgpu` (default when available)
  - `?renderer=webgl2` — GLSL 3.00 ES reference renderer for debugging and CI screenshots
  - `?renderer=html` — lightweight DOM grid (`PatternSequencer`)
  - `window.DEBUG_RENDERER = 'webgl2'` or `localStorage.setItem('xasm1_pattern_renderer', 'webgl2')`
- Add media files via the media panel to display them in the overlay while a module plays.

Project structure (important files)

- `index.html` — application entry. Loads libopenmpt WASM/JS and sets up a readiness promise used by the React app.
- `index.tsx`, `App.tsx` — React entry and main application UI.
- `hooks/useLibOpenMPT.ts` — primary integration with the libopenmpt runtime and playback state.
- `components/` — UI components (Controls, Header, PatternDisplay, PatternSequencer, MediaPanel, etc.).
- `src/renderers/` — Pattern renderer abstraction (`webgl2/`, `html/`, selection + global API).
- `shaders/` — WGSL shader files used by the WebGPU pattern renderer.
- `public/` — static assets.
- `package.json` — scripts and dependency list. Uses Vite for dev and build.

Notes and configuration

- libopenmpt: The project loads libopenmpt from an external script (see `index.html`). If you're working offline or need a local copy, host the `libopenmptjs.js` and its WASM assets locally and update `index.html` accordingly.
- Tailwind: A CDN helper script is present in `index.html` to bring in utility styles quickly in development. For production builds you may want to use the PostCSS/Tailwind config in the repo.
- **Pattern renderers:** WebGPU → WebGL2 → HTML automatic fallback chain. Use WebGL2 (`?renderer=webgl2`) to iterate on shader/effect logic with GLSL and `window.currentPatternRenderer.readPixels()` for Playwright pixel tests. Alt+D (dev) cycles WebGL2 debug modes (wireframe, UV, playhead heatmap).
- **WebGPU → WebGL2 porting:** Shared packing lives in `utils/gpuPacking.ts`; WebGL2 GLSL mirrors `hooks/webGLShaders.ts` (three-emitter lens caps). Chassis/night mode/bloom approximations are in `src/renderers/webgl2/shaders/`.

Contributing

Contributions and fixes are welcome. Open an issue or pull request; keep changes small and focused. If you add dependencies, update `package.json` and include a brief rationale in the PR.

Credits

- libopenmpt (WASM build) — playback engine for tracker modules.
- Project originally linked to: https://github.com/ford442/react-dom (see app footer for repository link).

License

This repository does not include an explicit license file. Add a LICENSE file if you want to permit reuse.
