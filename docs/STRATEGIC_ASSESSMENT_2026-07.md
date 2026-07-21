# Strategic Assessment — XASM-1 / mod-player (2026-07-21)

Senior engineering review of repository health, foundation vs feature posture, and the prioritized GitHub issue set filed alongside this document.

---

## 1. Project Status & Architecture

**XASM-1 Player** is a mature browser tracker player (MOD/XM/S3M/IT) whose core value is accurate libopenmpt WASM playback paired with a WebGPU-first pattern visualizer that feels like retro-futurist hardware. Playback, three renderer backends (WebGPU → WebGL2 → HTML), shader registry, bloom, local/cloud libraries, MIDI, offline WAV export, and performance capture are all real and recently hardened (#329/#330 silent-audio fixes, #333 export, #318 WGSL includes, #312 Vitest). Incomplete / optional surfaces include the native C++ engine (progressive, gitignored artifacts), deep pattern editing, instrument inspection, full a11y, and runtime verification of several landed shaders. The product already works as a playable visualizer; the largest remaining risk is concentrated complexity plus verification lag, not missing core playback.

**Organization:** Clear conceptual split between main-thread audio (`hooks/useLibOpenMPT`, `useAudioGraph`, worklet) and GPU viz (`PatternDisplay`, `useWebGPURender`, `src/renderers/`). `utils/shaderRegistry.ts` is a successful SSOT for shader capabilities. Zustand is used narrowly (`store/libraryStore.ts`); most UI/player state still lives in `App.tsx` (~1168 LOC) and is drilled through `MainLayout` (~169 prop fields).

**Structural problems:**
- **God objects:** `App.tsx`, `MainLayout.tsx`, `useLibOpenMPT.ts` (~1187), `useWebGPURender.ts` (~1258).
- **Prop-drilling mega-layout:** every new panel adds more props through `MainLayout`.
- **Type cycles:** `types.ts` ↔ `src/renderers/types.ts` ↔ `hooks/useWebGPURender.ts` ↔ packing utils (madge).
- **Hooks folder overload:** audio + WebGPU + MIDI + export share one layer with weak boundaries.
- **Positive:** worklet isolation, packing invariants under Vitest, wasm hygiene CI, visual smoke for WebGL2/HTML.

---

## 2. Language & Technical Quality

| Area | Assessment |
|------|------------|
| **TypeScript** | Strict flags on (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). Sparse `any`; Zod for storage/share/MIDI. No production `@ts-ignore`. |
| **React** | Functional hooks only; mutable refs for high-frequency audio (correct). Composition root is overloaded. |
| **WGSL** | Versioned catalog + registry; include system landed for Night family; many older shaders still monolithic forks. |
| **C++ / Emscripten** | Small surface; dual-build hygiene good; full `build:emcc` weekly-only; position schema not fully unified with JS worklet. |
| **JS worklet** | Production path; wasm2js glue; aggressive cache (`WORKLET_VERSION`); postmortems document silent-playback classes. |
| **Build** | Vite + COOP/COEP `credentialless`; Tailwind content paths scoped (OOM guard); `sync:shaders` predev/prebuild. |
| **Tests** | **61 Vitest tests pass locally**; CI runs only `test:shader-registry` + visual smoke — largest process gap. Lint budget 100, ~30 warnings. |
| **Docs** | Strong `AGENTS.md` / `CLAUDE.md` / planning epics; some drift (`WORKLET_VERSION`, closed-issue references in weekly_plan). |

---

## 3. Foundation vs Features Decision

**Decision: strengthen a short foundation slice first, then resume features.**

Justification:
1. Core product value (play + visualize) works; recent merges (#329/#330/#333/#334) restored audio and shipped export.
2. The foundation is **not** broken end-to-end, but it is **fragile under change**: silent-playback classes lack automated guards; CI does not run the 61-test Vitest suite that already exists; every feature still pays the MainLayout prop tax.
3. Issues #1–#6 below are compounding: CI + audio harness protect the core; state/GPU decomposition unlocks feature velocity; sync + include migration reduce viz/audio churn.
4. Issues #7–#10 are grounded feature work already sketched in planning docs / prior tracker (#315/#317/#321/#322 / native epic) — safer once #1–#3 land.

Do **not** freeze all features indefinitely. Ship foundation P0s quickly (S/M), then parallelize P2 features behind the state refactor.

---

## 4. Long-term Vision (6–18 months)

If investment compounds, XASM-1 becomes the **reference web “hardware” for tracker culture**: a shareable player that is as faithful as desktop libopenmpt, as expressive as a modular LED chassis, and as creator-friendly as a lightweight studio — inspect instruments, edit patterns, export stems/clips, drive MIDI, and embed visualizations (Project-M / reactive chassis) without leaving the browser. Native engine and WebGPU remain progressive enhancements; WebGL2/HTML keep the floor. The moat is the tight audio↔GPU loop and the shader registry discipline, not a generic music site.

---

## 5. Issue set (filed on GitHub)

Exactly **10** issues, ordered highest → lowest priority. Full bodies live on GitHub; drafts mirrored under `.github/issues/2026-07-strategic/`.

| # | Priority | Type | Title (short) | Size |
|---|----------|------|---------------|------|
| 1 | P0 | DX / Foundation | Gate CI on full Vitest suite | S |
| 2 | P0 | Foundation / Test | Audio silent-playback regression harness | M |
| 3 | P1 | Refactor | Decompose MainLayout prop drilling (player UI store) | L |
| 4 | P1 | Refactor | Split useWebGPURender; break type cycles | L |
| 5 | P1 | Performance | Worklet A/V playhead sync hardening | L |
| 6 | P1 | DX | Finish WGSL include migration (prod shaders) | M |
| 7 | P2 | Feature | Accessibility pass | M |
| 8 | P2 | Feature | Instrument / sample inspector MVP | L |
| 9 | P2 | Foundation | Native engine platform (CI cache, schema, force-JS) | XL |
| 10 | P2 | Feature | Pattern editor completion (edit → export round-trip) | L |

---

## Evidence snapshot (2026-07-21)

- `npm test` → 61/61 pass; not invoked from `.github/workflows/ci.yml`.
- Hotspots: `useWebGPURender.ts` 1258, `useLibOpenMPT.ts` 1187, `App.tsx` 1168, `MainLayout.tsx` 931 (~169 props).
- Open issues at review start: **0** (prior #307–#322 wave largely closed; export landed as #333).
- Audio keep-alive present in `useLibOpenMPT.ts` (~709–710); regression guard still missing.
