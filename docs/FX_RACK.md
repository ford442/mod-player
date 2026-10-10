# FX rack (#453)

A post-engine master FX rack that makes the XASM-1 sound like hardware:
**character** (tape saturation, Amiga 500/1200 LED filter, Paula-style crush),
a **3-band EQ**, a **glue compressor** and a convolution **room**. It works with
every engine (JS worklet, native, ScriptProcessor), per-song presets persist,
the v0.61 chassis shader shows the rack's settings, and WAV export renders
through the same rack — export equals what plays.

## Signal path

```
engine ─▶ masterInput(G1) ─┬─▶ masterDirect(G 1⇄0) ───────────────────────────────────┐
                           └─▶ rack.input ▶ slot ▶ slot ▶ slot ▶ slot ▶ rack.output(G 0⇄1) ┴─▶ analyser ▶ panner ▶ gain ▶ out

slot:  in ─┬─ dry(G) ─────────────────────────┬─ out          default order: character → eq → comp → room
           └─ module.in … module.out ─ wet(G) ─┘
```

- Every engine connects to `masterInputRef` — never to the analyser
  (CLAUDE.md pitfall 15). `ensureMasterOutputChain` is connect-only, so
  re-asserting it on play / hot reload keeps the rack's edges and the
  performance-capture tap.
- **Attach / collapse** is a complementary 10 ms fade of `masterDirect` and the
  rack's return gain, never an edge swap under signal. Chrome applies each
  `connect` / `disconnect` separately, so swapping edges while audio plays could
  double or drop a 2.7 ms quantum. With every slot bypassed, the two paths are
  identical and the fade is inaudible.
- **Bypass is bit-exact**: gains are exactly 0 or 1 outside fades, and a disabled
  module is unwired after its tail, so it costs no CPU.
- What sees the processed signal: AnalyserNode consumers (VU meters, CPU
  spectrum fallback, projectM bridge), performance capture, and what you hear.
  The **GPU spectrum (pcmBus → computeAnalysis) stays dry**. The engines publish
  PCM before Web Audio.

## Code map

| Where | What | Chunk |
|---|---|---|
| `audio/fx/types.ts`, `spec/` | State types, param specs (ranges / scales), zod schema, presets | main |
| `store/fxStore.ts` | Global + per-song state, user presets, persistence | main |
| `audio/fx/fxBootstrap.ts` | Imports the controller when a module is first enabled | main |
| `audio/fx/fxHost.ts` | The master-graph attachment point (published by `hooks/audioGraph/masterGraph.ts`) | main |
| `audio/fx/fxVisualState.ts` | Rack settings → v0.61 shader slots | main |
| `audio/fx/fxRackController.ts` | Live owner: builds / attaches / applies / collapses | **lazy** |
| `audio/fx/FxRack.ts`, `FxSlot.ts`, `automation.ts` | Rack, crossfading slots, append-only fades | lazy |
| `audio/fx/modules/` | `eq`, `comp`, `character` (worklet), `room` (convolver) | lazy |
| `audio/fx/room/` | IR manifest, catalog, lazy loader | lazy |
| `audio/fx/offline/renderFxOffline.ts` | WAV export through the rack | lazy (export) |
| `audio/fx/testing/` | Click metric, test signals, Chromium harness | not shipped |
| `audio-worklet/fxCharacterParams.ts` | Character processor contract (name, AudioParams, latency) | shared |
| `audio-worklet/js/fx-character-processor.ts`, `js/fx/` | The character worklet + DSP kernels | generated worklet |
| `components/fx/`, `components/Knob.tsx` | Panel (lazy) and accessible knob | lazy UI chunk |
| `public/ir/*.opus` | Room IRs (fetched on demand) | asset |

`FX_RACK_ENABLED` (`appConfig.ts`) is on in dev builds. Public builds opt in
with `VITE_FX_RACK=1`, pending a soak on Safari (Opus IRs) and mobile CPU. When
it's off, nothing of the rack loads and persisted FX state is ignored.

## Lifecycle

1. The store holds the state (`effective` = the song's override, else global).
2. `fxBootstrap` imports `fxRackController` (one lazy chunk) the first time any
   module is effectively on, including on startup from persisted state.
3. The controller waits for a context; the master graph publishes one on the
   first play. It then builds a bypassed rack, attaches, and applies the state
   once the attach fade ends. Slots warm up (EQ 10 ms, comp 20 ms, character
   5 ms) at wet = 0, then crossfade in over 10 ms.
4. Edits re-apply: continuous params glide (`setTargetAtTime`, τ 15 ms).
   Character params step and the processor smooths them per sample.
5. When nothing is on, slots fade out, tails ring out, then the rack collapses
   and detaches. A new context (remount / HMR) rebuilds the rack.

Persisted FX on page load: the first play is dry for the moment it takes the
lazy chunk to arrive, then the rack fades in.

## Modules

| Module | Nodes | Latency | Warm-up | Tail | Notes |
|---|---|---|---|---|---|
| character | AudioWorklet `xasm-fx-character` | 23 frames (×2 halfband pair) | 5 ms | = latency | Sub-stages are always running, switched by 10 ms crossfades. State resets itself after a processing gap |
| eq | low shelf → peaking → high shelf → trim | 0 | 10 ms | 0 | |
| comp | DynamicsCompressor → makeup | ~6 ms look-ahead | 20 ms | look-ahead | |
| room | parallel send: mix → predelay → low-cut → convolver A/B | 0 (dry path) | 0 | IR + predelay | Send fades in after the slot swaps; fades out and rings before it swaps back. IR changes crossfade fresh convolvers over 50 ms |

The dry path is never latency-compensated (compensation would break bypass
identity). During a 10 ms fade, the compressor look-ahead or the resampler
delay blends as a brief comb, not a click.

### Character stage

Per channel: crush → A500 RC (4420 Hz, 6 dB/oct) → LED 2-pole Butterworth
(3275 Hz) → ×2 up (47-tap Kaiser halfband, polyphase, folded) → asymmetric
tanh tape + 10 Hz DC block → ×2 down → trim.

- **Crush:** sample-and-hold on an exact Hz accumulator, so 4000 Hz at 48 kHz
  holds for exactly 12 samples, plus a mid-tread `2^(1−bits)` quantizer.
- **Tape:** `(tanh(k(x+b)) − tanh(kb)) / norm`, where `norm` keeps full-scale
  input within ±1 at any drive. Drive 0 is nearly transparent (+0.12 dB).
- **Oversampling:** ×2 removes aliasing from harmonics between fs/2 and fs,
  about 8–12 dB less aliasing for a 5 kHz tone at moderate to full drive. Higher
  harmonics of a hard-driven tone still fold inside 2·fs.
- **`process()` never allocates:**
  - Staged block loops over preallocated Float64 scratch, with state in locals.
  - No per-sample call passes or returns a double. When TurboFan doesn't inline
    one, it boxes the double.
  - Every numeric field has a numeric initializer. The ES2020 bundle defines
    bare fields as `undefined`, and V8 then stores them as tagged values.
- **CPU:** 2.3–2.5 % of one core at 48 kHz stereo with everything on (headless
  Chrome, CI gate < 5 %).
- **Faust:** measured and rejected (1.2–1.3× the CPU). See
  `docs/ADR-fx-character-dsp.md`.
- **LED filter vs libopenmpt:** libopenmpt's own Amiga resampler
  (`render.resampler.emulate_amiga`) already models Paula's output filter and
  E0x LED commands for MODs. The rack's LED filter colors the whole master bus
  for any format and stacks on top.

### Room IRs

The IRs are synthesized deterministically (`scripts/lib/ir-synth.mjs`): wet-only
early reflections plus a two-band decaying tail, unit energy. Sizes are small
0.35 s, medium 0.7 s and large 1.0 s. Each is Opus-encoded at 160 kbps
(≈ 36 KB total).

- **Loading:** files are fetched only when the room is first enabled, once per
  page. Each context decodes them at its own rate (48 kHz live, 44.1 kHz export).
- **Failures:** a decode failure (e.g. Safari without Ogg Opus) marks the room
  *unavailable*. It reads as off, the panel offers Retry, and export skips it
  with a warning.
- **Commands:**
  - `npm run gen:irs` regenerates the files (needs ffmpeg/libopus; it's
    byte-reproducible with the same libopus). The outputs are committed.
  - `npm run verify:irs` checks files, hashes and the synth spec, with no ffmpeg.
    `tests/irAssets.test.ts` runs it.

## State, presets, persistence

- `localStorage["xasm1_fx_rack"]` = `{version: 1, globalPresetId, globalState,
  userPresets, songOverrides}`.
  - It's zod-validated on read: corrupt data falls back to defaults, numbers are
    clamped, and the module order is repaired.
  - Writes are debounced by 250 ms.
- **Per-song overrides** are full states keyed by the song fingerprint
  (`utils/songFingerprint.ts`). The fingerprint is SHA-256 of the whole file,
  falling back to FNV-1a-64 on plain-http hosts.
  - The cache is LRU-capped at 200 songs.
  - Edits go to the song override if the song has one (badge "This song"), else
    to global.
  - Shader per-song prefs still key on `computeModuleHash` (the first 16 bytes),
    which collides for every XM file. That's a follow-up.
- **Factory presets:** Flat, Amiga 500, Amiga 1200, Tape glue, Lo-fi crunch,
  Small room, Club. User presets are saved from the panel.

## Panel, commands, MIDI

- **Panel:** the FX Rack panel (left column, toggled by 🎛️ FX Rack) has preset,
  scope, save / reset, rack bypass, and per-module on/off, reorder and knobs.
- **Knobs:** `role="slider"`. Arrow keys step 1 %, Page Up/Down 10 %, Shift is
  fine; drag vertically; double-click resets. A focused knob counts as an input,
  so global shortcuts stand down.
- **Commands:**
  - `fx.toggle {module | 'rack', enabled?}`
  - `fx.setParam {module, param, value, normalized?}`
  - `fx.preset {presetId | step | index}`
- **MIDI:** the default mappings are CC91 → room mix, CC74 → EQ high shelf and
  CC71 → character drive. Custom mappings take `fxTarget`; see
  `docs/MIDI_CONTROLS.md`.

## Export

`useOfflineExport` with an FX snapshot (`exportSnapshot()`; null when nothing
is on, so the export is dry and exactly as before):

1. The worker renders dry float PCM (`output: 'pcm'`).
2. On the main thread, `renderFxOffline` runs the PCM through an
   OfflineAudioContext built by `buildFxGraph()` (the same builder as live).
   - The render is extended by latency + tail, and latency is kept.
   - The source is **zero-padded** to the full length, like the engine's
     silence. A source that ends mid-render puts Chrome's downstream nodes into
     tail handling, and the room tail then no longer matches playback.
3. The WAV is encoded on the main thread. The duration-parity check still uses
   the dry render.

Exports needing more than ~1.5 GB (≈ 20 min) are refused: export a range or
switch the rack off. The 6:47 default module exports in ~18 s with character +
EQ.

## Chassis shader (v0.61)

`patternv0.61.wgsl` is v0.60's LEDs over `bezel_fx.wgsl`.

- **Effects:** an amber rim glow with tape drive, a warm↔cool plate tilt with
  the EQ, a violet halo with room mix, and four module LEDs.
- **Data:**
  - The values are the rack's *settings*, eased on the CPU
    (`fxVisualState.ts`), in bezel uniform slots 24–27 (`ShaderMeta.fxUniforms`).
  - frameDraw zeroes those slots for other shaders.
  - The spectrum bars stay the dry FFT.

## Testing

**Vitest on real Web Audio** (`node-web-audio-api`, `tests/helpers/webAudioNode.ts`):

| Test file | Covers |
|---|---|
| `audioMasterGraph` | Null test: the new chain and a bypassed, attached, then collapsed rack match the pre-rack graph exactly |
| `fxCrossfade` | M1 / M2 click metric with its self-check |
| `fxRack`, `fxRoom` | Rack and room behaviour |
| `fxExportParity` | Every preset, export == live at 44.1 and 48 kHz; serialization completeness |
| `fxCharacter*` | Kernels, the bundle bit-exact against the kernels, zero allocation |

The fake-node scheduling tests, `fxStore`, `fxController` and `fxCommands`
cover the rest.

Two node-web-audio-api caveats, both documented in the helper:
- `suspend()` registers asynchronously, so it can race a fast render. Schedule
  automation ahead of time instead.
- `getChannelData()` views die with their AudioBuffer object. Copy them, or keep
  the buffer alive.

**Click metric** (`audio/fx/testing/clickMetric.ts`), for a 55 Hz / −12 dBFS
sine (+ DC) toggled on and off:

- **M1:** `max|y − [(1−g)·dry + g·wet]| ≤ 1e-3` (−60 dBFS). Here `g` is the
  spec'd fade, rendered by the same engine from a DC probe. Measured ≈ 1e-7.
- **M2:** the 8 kHz 4th-order high-passed peak around each toggle may exceed the
  static renders' by ≤ 1e-3. Measured ≤ 4.9e-4 for EQ / comp / character.
- **Self-check:** a hard switch (M1 0.99, M2 0.39) and a 1 ms fade
  (M1 0.94, M2 5.1e-3) must both fail.
- **Room:** gated on conformance to a hand-built send-ramp reference
  (8.9e-8 in Chrome). A reverb's own tail is broadband, so M2 can't judge it.

**Chromium harness** (`npm run smoke:fx:ci`, CI audio-smoke job) runs the same
null / crossfade / room / parity / export checks on Chrome's nodes. It also
decodes the real Opus IRs and gates the character CPU (< 5 %).

**Audio smoke** (`fx-rack` phase) checks the real app:
- character + EQ mid-playback keeps the counters advancing;
- no `/ir/` request happens until the room is enabled, then exactly one;
- switching everything off collapses the rack.

## Adding a module

1. Add the id and params to `audio/fx/types.ts` and specs to
   `spec/paramSpecs.ts`; the schema, panel knobs and MIDI scaling follow.
2. Write `modules/<id>Module.ts` implementing `FxModuleInstance`: latency,
   warm-up, tail and `setParams` (use `automation.ts`). Add `fadeIn` /
   `fadeOut` if, like the room, it needs an internal fade.
3. Register it in `modules/index.ts` and `DEFAULT_FX_ORDER`.
4. Extend `fxTailSeconds` (export length) if it has a tail or latency.
5. Add it to `tests/fxCrossfade.test.ts` and the harness, to presets if useful,
   and to `fxVisualState` if the chassis should show it.

## Known limitations / follow-ups

- **GPU spectrum stays dry.** The pcmBus is fed before Web Audio, while
  AnalyserNode consumers are post-FX.
- **Fade comb.** The compressor look-ahead / resampler delay combs briefly
  during fades.
- **Reorder dip.** A live reorder dips to dry for ~30 ms.
- **Safari.** Opus IR support varies; an AAC fallback set would be a follow-up.
- **Long exports** need ~28 B/frame. Chunked / streamed FX export is a
  follow-up.
- **Shader prefs** still key on the 16-byte module hash, which collides for XM
  files.
- **Pre-existing, out of scope:** the native engine applies volume twice
  (C++ and GainNode).
- **Public mode** is gated on `VITE_FX_RACK=1` until the soak.
