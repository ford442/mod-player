# v0.30b Public Build — Diagnostic & Stabilization Outline

> **Goal:** Reliable note timing + playback first, then lock the visual behavior of `patternv0.30b.wgsl`, then ship a clean public build that exposes only that shader (or makes it the default).
>
> **Status:** Phase 0 complete — guardrails documented, baseline tests green (185 Vitest + registry/parity).

---

## Required reading (load before any edits)

| File | Why |
|------|-----|
| `AGENTS.md` | Audio architecture, renderer backends, CI gates |
| `docs/WORKLET_AUDIO_BUG.md` | #329/#330/#354 regression post-mortem + prevention checklist |
| `grok.md` | Project overview + shader-uniform coupling warning |
| `utils/playheadPrediction.ts` | Worklet → GPU fractional playhead extrapolation |
| `utils/gpuPacking.ts` | PackedA/PackedB + DURA/TRIG-001 CPU packing |
| `shaders/lib/dura.wgsl` | WGSL duration unpack (`unpackDurationInfo`) |
| `shaders/lib/packing.wgsl` | WGSL cell classification (`classifyCell`) |
| `shaders/patternv0.30b.wgsl` | **Target shader** — chrome disc + trigger/sustain LEDs |
| `utils/shaderRegistry.ts` → `patternv0.30b.wgsl` | Capabilities: `highPrecisionPacking`, `playheadRowAsFloat`, `strictPlayheadSustain` |
| `docs/planning/accurate_playback.md` | A/V sync measurement + acceptance criteria |

---

## Non-negotiables (audio path)

These invariants are **hard gates**. Violating any of them has caused three production regressions (#329 → #330 → #354).

| Rule | Rationale | Guard |
|------|-----------|-------|
| **Never re-init libopenmpt** on every `play()` / module switch | XM silence, runaway `ended → seek 0` | `ensureSharedLibOpenMPT` singleton; `canReuseWorkletNode`; `shouldPostInitLib` |
| **Never `AudioContext.suspend()`** on normal `stopMusic(false)` / reload | UI "Playing" but no audio until fresh gesture | `tests/workletAudioLifecycle.test.ts` source invariant |
| **Position reports ≤ ~60 Hz** | ~350 Hz flood → MOD hiccups / main-thread jank | Worklet `positionReportInterval = 1/60`; main thread extrapolates via `playheadPrediction.ts` |
| **Bump `WORKLET_VERSION`** in `hooks/useWorkletLoader.ts` on any `openmpt-worklet.js` change | Browsers cache AudioWorklet aggressively | Currently `8` |
| **Hot reload: reuse node, ignore stale `loaded` acks** | XM silence after second `loadModule` | `workletModuleTokenRef` + `shouldAcceptWorkletLoadedAck` |
| **Never `node.disconnect()`** on hot module reload | Audible glitch / reconnect race | `planJsWorkletHotReloadPlay` |

### Non-negotiables (visual / packing path)

| Rule | Rationale |
|------|-----------|
| **PackedA/PackedB + duration must match WGSL** | Any `gpuPacking.ts` bit-shift change requires matching `dura.wgsl` / `packing.wgsl` / target shader |
| **Use `shaderRegistry.ts` capabilities** — no new `shaderFile.includes('v0.XX')` chains | Single source of truth for layout, packing, canvas size, hit-test |
| **Uniform struct changes** require `fillUniformPayload` + `createUniformPayload` updates | Shaders are not pure assets |
| **Run `npm run sync:shaders`** after editing `shaders/` | Never hand-edit `public/shaders/` |

---

## Diagnostic URL & test modules

### Canonical diagnostic session

```
http://localhost:5173/?engine=js&renderer=webgpu&shader=patternv0.30b.wgsl
```

| Param | Value | Why |
|-------|-------|-----|
| `engine=js` | Force JS worklet | Deterministic path; avoids native dual-`AudioContext` quirks during diagnosis |
| `renderer=webgpu` | WebGPU backend | v0.30b is a WGSL shader; production target |
| `shader=patternv0.30b.wgsl` | Pin target shader | Bypasses localStorage shader memory |

**Cloud VM fallback** (no WebGPU): append `renderer=webgl2` instead. Visual semantics are ported but pixel-identical checks use WebGPU.

### Known-good test modules

| Module | Path | Role |
|--------|------|------|
| **4-mat_madness.mod** | `public/4-mat_madness.mod` | Default auto-load; 4-channel MOD; DURA sustain tails |
| **test.xm** | `public/test.xm` | XM format switch test; instrument/sample coverage |
| libopenmpt-test.mod | `public/libopenmpt-test.mod` | Minimal sanity module |

### Manual audible checklist (required after audio-path edits)

1. Fresh tab → default MOD plays after Play
2. File picker → load `.mod` / `.xm` → play → stop → play
3. MOD ↔ XM switch while playing (no silence, no `ended → seek 0` spam)
4. Stop → play (no extra gesture beyond initial unlock)

See `docs/WORKLET_AUDIO_BUG.md` § Manual audible checklist.

---

## Phase 0 — Setup & guardrails ✅

- [x] Read guardrail docs (see table above)
- [x] Confirm `WORKLET_VERSION` = `8` (`hooks/useWorkletLoader.ts`)
- [x] Baseline CI gates green:
  - `npm test` — 185 tests
  - `npm run test:duration-parity` — DURA CPU packing
  - `npm run test:shader-registry` — v0.30b registered with `strictPlayheadSustain: true`
- [x] Test modules present in `public/`
- [x] v0.30b in `smoke:visual:ci` shader set (`scripts/lib/visual-smoke-config.mjs`)

---

## Phase 1 — Audio timing & playback lock

**Priority:** Fix before any visual polish. A player with drifting or silent audio cannot ship.

### 1.0 Worklet lifecycle audit ✅ (2026-08-01)

Systematic code + test verification of the three #329/#354 guards.

#### A. `ensureSharedLibOpenMPT` singleton

| Location | Status | Detail |
|----------|--------|--------|
| `public/worklets/openmpt-worklet.js:94–177` | ✅ | Returns existing `globalThis.__openmptWorkletLib` if `_openmpt_module_create_from_memory2` exists; otherwise one shared `__openmptWorkletLibInitPromise` |
| `openmpt-worklet.js:231–239` | ✅ | New processor nodes attach to pre-initialised lib (`Attached to pre-initialised shared libopenmpt`) |
| `utils/workletLibSingleton.ts` | ✅ | Testable mirror; 3 unit tests assert single eval + concurrent promise sharing |
| `hooks/useAudioGraph.ts:751` | ✅ | `shouldPostInitLib(reuseWorkletNode, …)` — **no `initLib` on hot reload** |

#### B. Hot-reload reuses `AudioWorkletNode` (no disconnect/reconnect)

| Location | Status | Detail |
|----------|--------|--------|
| `utils/workletAudioLifecycle.ts:16–22` | ✅ | `canReuseWorkletNode` — true when `activeEngine==='worklet' && workletLoaded && hasWorkletNode` |
| `hooks/useAudioGraph.ts:232–245` | ✅ | `shouldDisconnectWorkletOnPlay` — only disconnects when reuse is **false** |
| `hooks/useAudioGraph.ts:772–780` | ✅ | Hot path logs `Hot reload — keeping existing audio graph wiring`; skips `node.connect()` |
| `hooks/useLibOpenMPT.ts:387–388` | ✅ | `processModuleData` bumps token then `stopMusic(false)` — node kept alive |
| `hooks/useLibOpenMPT.ts:846–861` | ✅ | `getStopMusicWorkletActions(false, …)` → `disconnectNode: false`, `clearNodeRef: false` |

#### C. Module token + stale `loaded` ack rejection

| Location | Status | Detail |
|----------|--------|--------|
| `hooks/useLibOpenMPT.ts:288–289` | ✅ | `workletModuleTokenRef` bumped on every `processModuleData` |
| `hooks/useAudioGraph.ts:127–131` | ✅ | `shouldForceWorkletModuleLoad` gates hot `load` while already playing |
| `hooks/useAudioGraph.ts:765` | ✅ | `lastWorkletModuleTokenSentRef` set **before** `postLoad` |
| `audio-worklet/jsWorkletDispatch.ts:91–100` | ✅ | `shouldAcceptWorkletLoadedAck(current, lastSent)` — mismatch → `loaded-stale` |
| `hooks/useAudioGraph.ts:616–618` | ✅ | Stale ack logged and ignored; does **not** flip `isPlaying` |

#### D. Automated guards (run 2026-08-01)

```bash
npm test -- tests/workletAudioLifecycle.test.ts tests/workletRegressionGuards.test.ts
# → 2 files, 35 tests passed
```

| Test file | Coverage |
|-----------|----------|
| `tests/workletAudioLifecycle.test.ts` | #329 reuse/`initLib`, #330 no suspend, singleton eval-once, source invariants |
| `tests/workletRegressionGuards.test.ts` | #354 ≤60 Hz throttle simulation, two-load session (1 node, 0 disconnects), stale-ack tokens, source invariants |

**Verdict:** All three lifecycle guards are present in production code and locked by 35 regression tests. No code changes required for this sub-phase.

### 1.1 Position reporting & playhead clock ✅ (2026-08-01)

#### Worklet throttle (production)

```javascript
// public/worklets/openmpt-worklet.js
this.positionReportInterval = 1 / 60;
if (currentTime - this.lastPositionReportTime >= this.positionReportInterval) {
  this.port.postMessage({ type: WT.position, rowFraction, audioTime, … });
  this.lastPositionReportTime = currentTime;
}
```

Verified by `tests/workletRegressionGuards.test.ts` — simulated 1 s of audio quanta caps reports at ≤~61 Hz (unthrottled would be >300 Hz).

#### Playhead extrapolation chain

```
worklet position (~60 Hz)
  → applyWorkletPositionSample (playheadPrediction.ts)
  → predictPlayheadFromSample(sample, heardTime, rowsPerSec)   // allows negative dt for latency
  → light EMA (WORKLET_ROW_SMOOTHING = 0.98)
  → playbackStateRef.playheadRow → GPU uniform (f32 for v0.30b)
```

#### Diagnostic logging (temporary, debug-gated)

Enable with `?playheadDebug=1` or `localStorage.xasm1_playhead_debug='1'` (always on in `import.meta.env.DEV`):

| Surface | Fields |
|---------|--------|
| `window.__PLAYHEAD_DEBUG__` | `sampleRow`, `predictedRow`, `smoothedRow`, `predictionLagRows`, `maxAbsLagRows`, `positionReportHz` |
| Console `[Playhead]` warnings | Sustained lag > 1.5 rows for ~0.75 s; growing drift > 1.5 rows/s; position flood > 75 Hz |

Pure helpers: `utils/playheadLagMonitor.ts` (+ `tests/playheadLagMonitor.test.ts`).

#### Automated acceptance

```bash
npm run smoke:playhead
# square v0.44 @ 125 BPM: median |lagRows| = 0.532, max = 0.777 (< 1.0 threshold) — PASS
```

#### Manual audible checklist

See **`docs/PHASE1_AUDIBLE_CHECKLIST.md`** — 5-minute script covering default play, file picker, MOD↔XM switch, seek/loop, and playhead sync.

### 1.2 Reproduce & measure (manual)

```bash
npm run dev
# Open diagnostic URL (above), click Play, watch order/row counters + console [Worklet] logs
```

| Check | Pass criteria | Tool |
|-------|---------------|------|
| Worklet init | Console: `libopenmpt ready ✅`, `Module loaded ✅` | DevTools |
| Position throttle | No main-thread flood; smooth counters | Network/Performance tab |
| Playhead lag | Median \|lagRows\| < 1 row @ 125 BPM | `npm run smoke:playhead` |
| MOD ↔ XM switch | Audio continues; no silent output | Manual |
| Stop → play | Audio resumes on first Play click | Manual |

### 1.2 Automated regression suite (must stay green)

```bash
npm test                                    # includes workletAudioLifecycle + workletRegressionGuards
npm run test:playhead                       # playheadPrediction unit tests
```

Key test files:
- `tests/workletAudioLifecycle.test.ts` — #329/#330 invariants
- `tests/workletRegressionGuards.test.ts` — #354 throttle + hot-reload token
- `tests/playheadPrediction.test.ts` — extrapolation math
- `tests/workletProtocol.test.ts` — typed postMessage boundary

### 1.3 Files in scope (audio only)

```
public/worklets/openmpt-worklet.js
hooks/useLibOpenMPT.ts
hooks/useAudioGraph.ts
hooks/useWorkletLoader.ts
utils/playheadPrediction.ts
utils/workletAudioLifecycle.ts
audio-worklet/*  (native path audit only)
```

**Do not touch** `shaders/`, `PatternDisplay.tsx`, `useWebGPURender.ts` during Phase 1.

---

## Phase 2 — v0.30b visual behavior lock

**Priority:** Once audio is stable, lock the Note-On Disc look.

### 2.1 v0.30b shader contract

Registry (`utils/shaderRegistry.ts`):

```typescript
'patternv0.30b.wgsl': {
  highPrecisionPacking: true,      // DURA-002 packedA duration byte
  playheadRowAsFloat: true,        // fractional playhead in uniform[2]
  strictPlayheadSustain: true,     // playhead-scrolled sustain arc
  layoutMode: 'circular',
  canvasSize: 1024,
  patternTexture: 'button-v30',
  bezelTexture: 'round',
  // ...
}
```

### 2.2 Visual acceptance criteria (manual + automated)

| Behavior | Expected | Backlog ref |
|----------|----------|-------------|
| Note-on trigger | Instant full brightness (no fade-in ramp) | #286–#291 |
| Cyan activity LED | Holds through sustain; fades at note end | #291 |
| Idle triggers | Dim pitch preview (`IDLE_NOTE_GLOW = 0.22`) | #289 |
| Muted channels | Subdued glow (`× 0.35`) | shader FS |
| Outer indicator ring (ch 0) | Tracks playhead position | v0.30 chrome |
| Note-off row | Brief neutral pulse at playhead | FS `note >= NOTE_OFF_MIN` |

Automated:
```bash
npm run build && npm run preview -- --port 4173 &
SMOKE_PROFILE=ci SHADER_FILES=patternv0.30b.wgsl npm run smoke:visual
npm run capture:trigger-tail   # sustain tail capture
```

### 2.3 Packing ↔ shader sync verification

```bash
npm run test:duration-parity   # CPU calculateNoteDurations ↔ packPatternMatrixHighPrecision
npm run test:trigger-tail      # TRIG-001 flag semantics
npm run test:shader-includes   # dura.wgsl / packing.wgsl expanded into public/shaders/
```

**Critical coupling chain:**

```
patternExtractor → calculateNoteDurations (gpuPacking.ts)
                 → packPatternMatrixHighPrecision (PackedA/PackedB)
                 → GPU buffer upload (useWebGPURender.ts)
                 → unpackDurationInfo (dura.wgsl)
                 → fs() sustain/trigger logic (patternv0.30b.wgsl)
```

Channel shadow state (`noteAge`, `trigger`) must align with shader's `isCurrentNote` check:
```wgsl
let isCurrentNote = abs(noteRelativeAge - ch.noteAge) < NOTE_AGE_TOLERANCE;
```

### 2.4 Files in scope (visual only)

```
shaders/patternv0.30b.wgsl
shaders/lib/{dura,packing,notes,pitch,sdf}.wgsl
utils/gpuPacking.ts
utils/shaderRegistry.ts
hooks/useWebGPURender.ts
src/renderers/webgpu/WebGPURenderer.ts
```

**Do not touch** worklet files during Phase 2 unless audio regression appears.

---

## Phase 3 — Public build (v0.30b only)

**Priority:** Ship after Phases 1–2 pass.

### 3.1 Public mode mechanics (existing)

- `?public=1` or `?demo=1` → `IS_PUBLIC_MODE` in `appConfig.ts`
- Hides shader selector panel (`MainLayout.tsx` line ~389)
- Does **not yet** force v0.30b as default shader

### 3.2 Required changes (planned)

| Change | File | Detail |
|--------|------|--------|
| Public default shader | `appConfig.ts` | `PUBLIC_DEFAULT_SHADER = 'patternv0.30b.wgsl'`; use when `IS_PUBLIC_MODE` |
| Shader prefs init | `store/shaderPrefsStore.ts` | Seed `storedShader` from public default when `IS_PUBLIC_MODE` |
| Hide non-essential debug UI | `MainLayout.tsx` | Already gated; audit remaining panels |
| Build profile | `package.json` / deploy | Optional `build:public` script |
| CI smoke | `scripts/lib/visual-smoke-config.mjs` | v0.30b already in CI set |

### 3.3 Public build verification

```bash
npm run build
npm run preview -- --port 4173
# http://localhost:4173/?public=1&engine=js&renderer=webgpu
```

Checklist:
- [ ] Only v0.30b visual (no shader picker)
- [ ] Default module loads and plays
- [ ] File upload still works
- [ ] Transport controls functional
- [ ] No console errors / WGSL parse failures
- [ ] PWA / service worker unaffected

### 3.4 Deploy

```bash
# Subdirectory deploy (production):
VITE_APP_BASE_PATH=/xm-player/ npm run build
python3 deploy.py

# Or root deploy for Cursor Cloud / preview:
npm run build && npm run preview
```

---

## Quick reference — command matrix

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Full test suite | `npm test` |
| Audio regression | `npm test -- worklet` |
| Playhead math | `npm run test:playhead` |
| DURA packing | `npm run test:duration-parity` |
| Shader includes | `npm run test:shader-includes` |
| Sync public shaders | `npm run sync:shaders` |
| Visual smoke (CI) | `SMOKE_PROFILE=ci npm run smoke:visual` |
| Playhead acceptance | `npm run smoke:playhead` |
| Production build | `npm run build` |

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Audio regression on worklet edit | Bump `WORKLET_VERSION`; run `npm test -- worklet`; manual audible checklist |
| Packing/shader drift | `test:duration-parity` + `test:trigger-tail`; never edit `public/shaders/` by hand |
| WebGPU unavailable in CI/Cloud | Use `?renderer=webgl2` for functional checks; WebGPU for pixel-accurate v0.30b |
| localStorage shader override | Use `?shader=patternv0.30b.wgsl` or clear `xasm1_last_shader` |
| Stale worklet cache | Hard refresh; check Network tab shows `openmpt-worklet.js?v=8` |

---

## Agent session bootstrap

When starting a new Cursor session on this workstream, paste:

```
Working on v0.30b public stabilization. Read docs/V030B_STABILIZATION.md first.
Non-negotiables: no libopenmpt re-init per play; no AudioContext.suspend on stop;
position ≤60Hz; bump WORKLET_VERSION on worklet edits; packing must match WGSL.
Diagnostic: ?engine=js&renderer=webgpu&shader=patternv0.30b.wgsl
Test modules: public/4-mat_madness.mod + public/test.xm
Current phase: [1|2|3]
```
