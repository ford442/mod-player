# React libopenmpt Viewer

A small React + TypeScript web app for loading and previewing tracker module files (MOD/IT/S3M/XM, etc.) using libopenmpt compiled to WebAssembly. The app also includes a visual pattern viewer (HTML and optional WebGPU/WGSL shaders) and a simple media overlay for images / GIFs / video.

Key features

Recent changes
- v0.31: added HDR + bloom-ready shader `shaders/patternv0.31.wgsl` and bloom postprocessing helpers (`/shaders/bloom_*.wgsl`, `utils/bloomPostProcessor.ts`).

- Play tracker modules in the browser using libopenmpt (WASM).
- Pattern view with two modes: HTML fallback and optional WebGPU (WGSL shaders included in /shaders).
- Simple media panel & overlay for images, GIFs, and videos synchronized with playback.
- Built with Vite, React, and TypeScript. Tailwind CSS is used for styling.

Quick start

Prerequisites

- Node.js (16+ recommended) and npm or a compatible package manager.
- A modern browser. WebGPU pattern rendering requires a browser with WebGPU support (e.g. recent Chrome/Edge with the flag enabled or experimental builds).

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
- Toggle the pattern view between HTML and WGSL (WebGPU) when your browser supports it.
- Add media files via the media panel to display them in the overlay while a module plays.

Project structure (important files)

- `index.html` — application entry. Loads libopenmpt WASM/JS and sets up a readiness promise used by the React app.
- `index.tsx`, `App.tsx` — React entry and main application UI.
- `hooks/useLibOpenMPT.ts` — primary integration with the libopenmpt runtime and playback state.
- `components/` — UI components (Controls, Header, PatternDisplay, PatternSequencer, MediaPanel, etc.).
- `shaders/` — WGSL shader files used by the WebGPU pattern renderer.
- `public/` — static assets.
- `package.json` — scripts and dependency list. Uses Vite for dev and build.

Notes and configuration

- libopenmpt: The project loads libopenmpt from an external script (see `index.html`). If you're working offline or need a local copy, host the `libopenmptjs.js` and its WASM assets locally and update `index.html` accordingly.
- Tailwind: A CDN helper script is present in `index.html` to bring in utility styles quickly in development. For production builds you may want to use the PostCSS/Tailwind config in the repo.
- WebGPU: WGSL shaders are provided, but WebGPU support varies between browsers and platforms. If WebGPU is not available, the app falls back to an HTML pattern renderer.

Contributing

Contributions and fixes are welcome. Open an issue or pull request; keep changes small and focused. If you add dependencies, update `package.json` and include a brief rationale in the PR.

Credits

- libopenmpt (WASM build) — playback engine for tracker modules.
- Project originally linked to: https://github.com/ford442/react-dom (see app footer for repository link).

License

This repository does not include an explicit license file. Add a LICENSE file if you want to permit reuse.
