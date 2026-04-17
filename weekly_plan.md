# Weekly Plan - XASM-1 (patternv0.50 "Trap Frosted Lens")

## Today's focus
**Fix First — channel-count buffer mismatch in the pattern packing pipeline.**
The packer (`packPatternMatrixHighPrecision`) emits `64 × 5 = 320` cells while `PatternDisplay` allocates `64 × 4 = 256`. Fifth-channel / metadata-row data is silently dropped or overruns the buffer, which directly blocks the note-duration visualization feature (the DURA pipeline writes duration/rowOffset/isNoteOff into exactly that column). Land a verified fix today so downstream shader work can trust its inputs.

## Ideas
<!-- User-written ideas Noah accumulates during the week. Routine prioritizes these. -->
- [ ] Amber-vs-blue emitter differentiation for expression-only steps (narrative §Note-Duration and §Graphical 2; partial groundwork in v0.50 three-LED rewrite Apr 12)
- [ ] Animated playhead scan-line arc at the current row in circular shaders (narrative §Graphical 4)
- [ ] Fractional-row interpolation for smooth 144 Hz playhead (`smoothPlayhead = row + fraction`) via `useRef`, bypass React state (narrative §Advanced 1)
- [ ] SharedArrayBuffer oscilloscope pipeline from worklet → GPU texture (narrative §Advanced 4)
- [ ] Move initial module parse off the main thread into a Web Worker to avoid 300 ms–1 s freezes on large `.it` files (narrative §Advanced 3)
- [ ] Darker-chassis toggle + drop shadow for white-chassis contrast (narrative §Graphical 6)
- [ ] Collapsible / default-hidden PatternDisplay debug panel (narrative §Graphical 8)
- [ ] Keyboard shortcut set: space/arrows/1–9 for play/seek/order jump (narrative §UI/UX)
- [ ] Persist last-used shader in localStorage + per-module memory (narrative §Quick wins)
- [ ] Thumbnail previews + favorites in shader selector (narrative §Shader UI)
- [ ] Multi-layer bloom: separate passes for triggers / sustains / expression (narrative §Shader 2)

## Backlog
<!-- Unfinished items, known bugs, deferred work. -->
- [ ] **[in progress — 2026-04-17]** Bug 1: 5-channel packer vs 4-channel buffer mismatch — today's Fix First
- [ ] Bug 3: PatternDisplay debug panel shows `Mode: NONE` while v0.50 renders (UI/state disconnect)
- [ ] Bug 4: ▶️ Play button scrolls canvas off-screen (focus/scroll side effect)
- [ ] Verify Bug 5 (shader `.bak`/`.kate-swp` files) actually cleaned — current `ls` shows 58 `.wgsl` files with no backups visible; confirm and add `.gitignore` patterns if missing
- [ ] Verify Bug 2 (ScriptProcessor fallback) fully resolved by #131 `refactor(worklet): remove registerProcessor hack` — spot-check on prod
- [ ] CRT scanline / phosphor post-process shader (narrative §Shader)
- [ ] Dynamic per-instrument color palettes (narrative §Shader / §UI)
- [ ] Compute-shader port of note-duration calculation (narrative §Performance)
- [ ] Mobile "lite" render mode (narrative §Performance)
- [ ] Storage-manager integration: `/api/shaders`, `/api/songs`, rating hookup (narrative §Integration)

## Done
- [x] 2026-04-17 — WebGL2 overlay coordinate alignment with WebGPU shader steps (#132)
- [x] 2026-04-17 — Outstanding TypeScript errors swept (#133)
- [x] 2026-04-16 — Worklet registerProcessor hack removed, formal `processorOptions` path (#131)
- [x] 2026-04-16 — BloomPostProcessor BindGroup creation optimized (#130)
- [x] 2026-04-16 — Lazy-load pattern matrices (#129)
- [x] 2026-04-16 — Note duration calc O(N³) → O(N)
- [x] 2026-04-16 — PatternSequencer regex optimization
- [x] 2026-04-16 — v0.45 circle bottom-cutoff fix + max-radius clamp
- [x] 2026-04-15 — LED indicator consistency across pattern shaders (#123)
- [x] 2026-04-15 — Large public assets restored after history cleanup
- [x] 2026-04-13 — WebGL cap alignment + LED sustain/expression color states (initial cut)
- [x] 2026-04-12 — v0.50 "Trap Frosted Lens" three-emitter rewrite (RG32UI cells, RGBA32F channel state, additive blend)
- [x] 2026-04-10 — Stale channel buffer + bind-group refresh fix; shader animation on second-song-load fix

## Last run
Date: 2026-04-17 (first run under new routine template)
Mode: Fix First
Focus: 5-channel / 4-channel buffer mismatch in `packPatternMatrixHighPrecision` ↔ `PatternDisplay` cells buffer.
Outcome: kickoff dispatch generated; kimi-cli swarm task, Copilot issue draft, 3 chat-model expansions, Claude Code deploy-dry-run task, and Jules wrap-up template all queued. Awaiting kimi-cli run.

---

## Overview (archival analysis — pre-routine notes)
The XASM-1 (patternv0.50 "Trap Frosted Lens") is a WebGPU-rendered circular tracker note display. It already has a sophisticated three-emitter LED system per step. Here is everything I found — bugs, missing features, and graphical improvement ideas.

---

## 🐛 Bugs Found

### 1. Channel count mismatch (data corruption bug — most critical)
The console consistently shows this every pattern update:

- `packPatternMatrixHighPrecision` says: "Packed N notes into 256 cells (64 rows x 5 channels)"
- `PatternDisplay` says: "Updating cells buffer: rows=64, channels=4" and "Packed data contains N notes in 320 cells"

The packer is computing 64×5 = 320 cells, but PatternDisplay allocates a 256-cell buffer (64×4). This means the 5th channel's data is being written beyond the buffer boundary, causing either a silent overflow or the fifth channel being silently dropped. Since the track has 4 channels, the "5th" column may be a metadata row (effect/expression), and its data is not being correctly received by the shader. This is the most critical bug and directly blocks note duration/expression display.

### 2. Audio engine falling back to ScriptProcessor
The status bar says "Playing (ScriptProcessor fallback)..." instead of AudioWorklet. ScriptProcessor is deprecated and introduces latency. The "⚡ Worklet" button is visible but the worklet is not activating. This may be a timing/CORS/WASM loading issue on the deployment server. The visualization→audio sync suffers as a result.

### 3. PatternDisplay Mode shows "NONE" despite v0.50 being selected
The debug panel shows Mode: NONE even while the circular shader "v0.50 (Trap Frosted Lens)" is actively rendering. This means either the debug panel is not being updated when the shader loads, or the mode state is being tracked in a separate variable from the actual GPU pipeline state. It's a misleading UI bug — the visual clearly works (WebGPU canvas confirmed present, no 2D context), but the debug panel lies about the mode.

### 4. Scroll anchor problem
Clicking "▶️ Play" scrolls the page to the bottom of the canvas (the controls area), hiding the visualization. After clicking play, the visual is off-screen and the user has to manually scroll back up. The play button should not cause a scroll jump — this is a focus/scroll behavior side effect from how the button is wired.

### 5. Redundant/stale shader files in the repo
The `/shaders` directory has 63 files including .kate-swp swap files, .bak backups, and "patternv0.14.wgsl back" files committed to main. These are editor artifacts that should be in .gitignore and removed.

---

## 🎨 Note Duration as Steps — The Feature You Want

Right now each step cell is a single static rectangle glowing at one brightness. What you want is:

- **Blue LED emitter (top):** The note-on trigger position — glows bright blue when a note starts on that step.
- **Full-brightness colored cells across N steps:** The note's duration — shows how many rows the note sustains, so it "fills" those steps with the note's color.
- **Amber LED emitter:** Only expression/effect-only rows (volume slide, portamento, etc. — steps with no note pitch, only effect column data) should glow amber.

### How to implement this in the shader:
The current system already encodes per-cell data via `packPatternMatrixHighPrecision`. You need to add a `noteDuration` field to the packed cell struct (currently it packs pitch, instrument, volume, effect, param but the duration/sustain count is not passed). On the JS side, libopenmpt via `pattern_get_row_channel_note_delay` / manual row scanning can compute note duration (number of rows until the next note or note-off). This gets packed into the 5th channel "metadata row" (which has the channel-count bug above). The shader then reads the duration to decide how many consecutive cells glow at full note color (the sustain tail), vs. note-on (bright blue top emitter), vs. expression-only (amber top emitter).

---

## 🖼️ Graphical Improvements

### 1. Step cell visual detail
Currently each cell is a rounded rectangle with a colored fill and a dark outline (the "LED housing"). The cells look good but:

- The frosted lens effect is doing some work, but the cell edges look uniformly dark. A brighter chrome-like inner bevel on the housing would make them feel more physical — like real injection-molded LED covers.
- The LED glow bloom is present but weak on inactive (grey/white) cells. Those cells all look the same — a slight grey glow would distinguish "empty but present channel" from a completely unpopulated step.

### 2. Three-emitter layout clarity
In v0.50, the top and bottom emitters (the small dots above/below each cell) are very subtle — in the zoomed views they look like small grey circular domes. They need more differentiation:

- The top (note-on) emitter should be distinctly bright royal blue (#0080FF) with a visible halo when active.
- The bottom emitter serves an unclear purpose right now — it could be used as a note-off flash or to show volume/velocity (brighter = louder).
- Expression-only steps should skip the note-color fill and show only the amber emitter (#FFA500) as their dominant visual signal.

### 3. Note duration "tail" rendering
The sustain steps following a note-on should show the note's pitch-class color at roughly 40–60% brightness (to distinguish from the full-bright note-on step), with no top-emitter blue. This creates a natural visual "tail" that communicates duration. The color should fade slightly toward the end of the note's sustain — a short linear fade over the last 2–3 rows feels natural.

### 4. Playhead indicator at 12-o'clock
The current playhead is the three amber/orange emitters visible at the top-center of the circle (between the XASM-1 label and the first ring). These look good, but when playing, the pattern data is already displayed statically with the playhead position. There's no animated sweep — the ring doesn't rotate. This is a design choice, but adding a subtle illuminated "scan line" arc at the current row position (like a clock hand or radar sweep) would make it far more legible which row is actually playing.

### 5. Inner rings (channel depth)
Channels radiate outward — outermost ring = CH1 (or innermost, depending on direction). The inner rings near the black center have tiny cells due to the circle's geometry and look sparse and washed out (grey/white). Suggestions:

- Add a ring label (CH1, CH2, CH3, CH4) as a very small text arc inside the black center or a subtle radial line with a tiny label at the center edge.
- The innermost ring cells could use a slightly larger step height to compensate for the perspective compression.

### 6. White chassis vs. dark ring contrast
The white XASM-1 chassis is very clean, but against the browser's light grey background, the edges dissolve. Either a subtle drop shadow on the outer chassis, or a darker (#1a1a1a instead of white) chassis option as a toggle would dramatically improve the sense of depth and make the LEDs pop more.

### 7. Header / UI area
The page title "libopenmpt Note Viewer" is plain left-aligned body text in a light-grey page. It contrasts oddly with the polished hardware aesthetic of the canvas. Options:

- Move to a dark full-bleed header that matches the canvas border color.
- The three buttons (3D Mode, Dark, Worklet) use inconsistent styling — the Dark button has a light/white background while the other two are colored. They should share a consistent button style, ideally matching the industrial XASM-1 aesthetic (dark metal, bright accent text).

### 8. PatternDisplay debug panel
The 🔍 PatternDisplay Debug floating panel in the top-right overlaps the canvas. It should be collapsible (it has a ✕ button) but is permanently visible on load. It should default to hidden and only show when pressing 'D' as stated, or at minimum not overlap the main render.

### 9. The "TRACKER GPU-9000" label
This label rendered inside the canvas (top-right) is a nice touch but uses a very thin, low-contrast font that's hard to read on the dark background. Using a slightly larger, spaced-out monospace font (like `letter-spacing: 3px; font-weight: 600; opacity: 0.6`) would make it feel more like an authentic hardware silkscreen label.

---

## 📋 Additional Technical Analysis

### Project Description
The xm-player at https://test.1ink.us/xm-player/index.html is a slick, modern web tracker module player (MOD/S3M/IT/XM via libopenmpt.js WASM + AudioWorklet) with a standout WebGPU pattern/note display powered by WGSL shaders. It also includes a media overlay panel for synced images/GIFs/videos, playback controls, looping, and shader toggling. The overall aesthetic is a retro-futuristic tracker interface—clean grid layout with Tailwind styling, responsive design, and GPU-accelerated visuals that feel premium compared to classic trackers.

### Current Note Display (Color-Coded + LED Style)

Pattern viewer renders as a scrollable/channelized grid (rows × channels) showing standard tracker cell data: note (e.g., C-4), instrument, volume/expression, and effects.

WebGPU mode (default when supported; falls back to HTML canvas/table) uses a series of patternv0.X.wgsl shaders (v0.21 up to v0.50+, with bloom variants like v0.33_bloom, v0.35_bloom, etc.). These pack pattern data into GPU buffers for fast rendering.

Color coding: Notes are rendered with per-note colors (restored/enhanced in recent commits around Apr 7, 2026). This is likely hue-shifted by pitch/octave, instrument, or channel for quick visual parsing at a glance. Each active note step appears as a distinct "LED" or pixel/block in the grid.

Glow/LED effects: Strong emphasis on LED-style visibility with bloom post-processing (bloom_threshold.wgsl, bloom_blur.wgsl, bloom_composite.wgsl, plus bloomPostProcessor.ts). This creates soft, emissive glow around lit steps. Additional shaders add bezel/chassis effects, night mode, donut/UV rings, studio dimming, channel inversion, etc., for a polished, hardware-emulating look.

Playback integration: The current row is highlighted in real time; the display scrolls or follows the playhead. No static text overlays on the shader canvas beyond the grid itself.

It looks great already—modern yet faithful to tracker roots, with smooth performance and nice glows. (The live demo loads quickly and plays modules responsively.)

### Problems Found (or Potential Issues)

**No native note duration visualization:** Current display is purely per-step (standard for trackers). A sustained note (e.g., a long C-4 that rings for 8 rows) only lights its trigger row in color/LED form. There's no indication of how long the note holds across rows, nor distinction for "expression-only" rows (volume slides, vibrato, pan, etc., without a new note trigger). This is the exact gap described above.

**Minor rendering quirks (from recent GitHub activity):**
- Past shader versions had artifacts (e.g., v0.46 fixes mentioned).
- Occasional bottom cutoff or sizing issues on canvas (fixed in App.tsx).
- WebGPU fallback to HTML is functional but loses the bloom/glow polish.
- Performance optimizations (removing redundant note counting loops) were needed, suggesting the data-packing step can get heavy on complex patterns.

**Other small nits:**
- Shader switching sometimes requires a remount (forced in recent code).
- Media overlay is cool but could conflict visually with dense patterns if not toggled.
- No offline libopenmpt bundling (relies on external script).
- Color-per-note is good but could be more customizable (e.g., per-instrument palettes).

No major crashes or breakage on analysis—it's actively maintained and stable.

### How to Add Note Durations (Blue LED for Notes + Amber for Expression-Only)

This would be a killer upgrade and fits perfectly with the existing WebGPU pipeline. Here's the high-level implementation plan:

**Data layer enhancement** (in `useLibOpenMPT.ts` or a new pattern processor):
- libopenmpt already exposes full pattern row data (getPatternRow, note events per channel with note, instrument, volume, effect).
- Pre-scan (or incrementally compute during playback) active note spans per channel:
  - On a note trigger (non-empty note field) → start of a "note event".
  - Continue glowing until a new note, note-off/cut, or end of pattern.
  - Flag "expression-only" rows (volume/effect present but no new note).
- Output enriched per-row data: `{ noteActive: true, durationSpan: 4, isExpressionOnly: false }` etc. Pack this into the existing GPU buffers (add a couple of float/int attributes).

**Shader/visual upgrade** (WGSL + bloom):
- In the pattern shader (patternv0.XX.wgsl or a new variant):
  - Render full-step rectangles/LEDs instead of single pixels.
  - Blue LED emitter glow for steps inside a note duration (use your existing bloom pipeline; modulate intensity by remaining duration or volume for a "fading" sustain feel).
  - Amber glow for expression-only steps (different hue in the fragment shader, perhaps softer bloom or different threshold).
  - Keep per-note color coding on top (e.g., blue base with note-specific tint).
- Add a subtle "LED emitter" effect: stronger center highlight + radial falloff (already doable with your bloom shaders).
- Current row could have an extra scanline or brighter pulse.

**UI/UX:**
- Toggle in the pattern controls: "Duration Glow" (on by default).
- Optional: show duration bars on hover or a mini timeline view.

This would make long sustains pop visually (especially useful for melodic lines or ambient modules) while keeping the classic tracker grid intact.

### Graphical Detail & Look Improvements (Beyond Durations)

The app already has strong foundations (bloom, shaders, LED focus). Here are targeted upgrades to make it even more visually stunning:

**Glow/LED polish:**
- Layered bloom: stronger for note triggers, subtler for sustains.
- Add subtle chromatic aberration or scanline overlay (retro CRT vibe) via an extra post-process shader.
- Dynamic intensity: tie glow brightness to actual volume/expression data from libopenmpt.

**Overall aesthetic:**
- Chassis/bezel enhancements: Your existing chassis*.wgsl and bezel.wgsl are great—lean into a physical "hardware tracker" look (e.g., frosted glass, subtle reflections, RGB edge lighting that reacts to playback).
- Darker night-mode default with higher contrast LEDs.
- Animated playhead: glowing cursor with particle trail or soft trail fade.
- Font/overlay: If any text is drawn on-canvas, use a crisp monospace with subtle glow (or keep it HTML overlay for readability).

**Performance & polish:**
- Canvas DPI scaling (already partially addressed) + higher internal resolution for sharper LEDs on high-DPI screens.
- Shader variants: Add a "minimal" mode for lower-end devices.
- Responsive grid: auto-scale row count visible based on screen size.

**Bonus ideas:**
- Instrument-specific color palettes (editable in UI).
- Hover tooltips on steps showing full cell data.
- Exportable "screenshot" of the glowing pattern (with bloom baked in).
- Tie into your storage_manager backend: load patterns/notes/shaders directly via the API endpoints you already have (/api/songs, /api/shaders, etc.).

---

## 🔧 Technical Implementation Details

### 1. Feature: Amber LEDs for Expression-Only Steps

Currently, the visualizer likely relies only on the note value to determine if a cap should light up. Because tracker modules (MOD/XM) heavily utilize rows that contain no note but contain volume slides, panning, or effect commands, these steps currently look "dead" even though data is executing.

**The Fix:** We need to unpack the volume and effect commands in your WebGL fragment shader (`PatternDisplay.tsx`) and assign them the Amber color.

Look inside `components/PatternDisplay.tsx` at the WebGL `fsSource` (Fragment Shader). Assuming your texture uses the RG32UI bitpacking format from your previous iterations, update the color logic like this:

```glsl
// Inside PatternDisplay.tsx -> fsSource main()

// 1. Unpack the data
uint packedA = texelFetch(u_noteData, ivec2(trackIndex, stepIndex), 0).r;
uint packedB = texelFetch(u_noteData, ivec2(trackIndex, stepIndex), 0).g;

uint note = (packedA >> 24u) & 255u;
uint volCmd = (packedA >> 8u) & 255u;
uint effCmd = (packedB >> 8u) & 255u;

// 2. Define colors
vec3 ledBlue = vec3(0.1, 0.6, 1.0);  // Note emitter
vec3 ledAmber = vec3(1.0, 0.5, 0.0); // Expression emitter
vec3 capColor = vec3(0.05);          // Default dark glass
float glowIntensity = 0.0;

// 3. Determine LED state
if (note > 0u && note < 97u) {
    // Primary Note triggers Blue LED
    capColor = ledBlue;
    glowIntensity = 1.0;
} else if (volCmd > 0u || effCmd > 0u) {
    // Expression-only triggers Amber LED
    capColor = ledAmber;
    glowIntensity = 0.6; // Slightly dimmer so it doesn't overpower the notes
}

// Apply subsurface scattering and light diffusion...
```

### 2. Feature: Blue LED Trails for Note Durations

Trackers don't store "duration" as a single number; notes simply play until they decay, are replaced, or hit a Note-Off command (usually note 97 or == in XM). To draw a glowing trail, you have to pre-process this state in JavaScript before sending it to the GPU.

**The Fix:** Modify `getPatternMatrix` in `hooks/useLibOpenMPT.ts` to track sustained notes.

```typescript
// Inside useLibOpenMPT.ts -> getPatternMatrix()

const numRows = lib._openmpt_module_get_pattern_num_rows(modPtr, patternIndex);
const numChannels = lib._openmpt_module_get_num_channels(modPtr);
const rows: any[][] = [];

// Keep track of which channels currently have a playing note
const activeSustains = new Array(numChannels).fill(false);

for (let r = 0; r < numRows; r++) {
  const rowData: any[] = [];
  for (let c = 0; c < numChannels; c++) {
    const note = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 0);
    const effCmd = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 4);

    // Note 97 is Note-Off. Effect 0x0C (Volume) / 0x0E (Envelope) might also cut notes.
    if (note > 0 && note < 97) {
        activeSustains[c] = true; // Start sustain
    } else if (note === 97) {
        activeSustains[c] = false; // Cut sustain
    }

    rowData.push({
      type: note > 0 ? 'note' : 'empty',
      text: "",
      note, 
      // ... other commands
      isSustained: activeSustains[c] && note === 0 // True if dragging out, but no new trigger
    });
  }
  rows.push(rowData);
}
```

Next, in `PatternDisplay.tsx` (`packPatternMatrix`), pack this `isSustained` boolean into an unused bit (e.g., the top bit of inst). In the GLSL shader, read that bit. If true, emit a faint blue glow:

```glsl
// GLSL Fragment Shader
if (isSustained) {
    capColor = ledBlue;
    glowIntensity = 0.2; // Faint glow indicating the note is still ringing
}
```

### 3. Graphical Detail & Look Improvements

The concept is trying to emulate high-end synthesizer hardware. Right now, some of the shaders look a bit "flat." Here is how to upgrade the optical physics:

**A. Subsurface Scattering (The Frosted Glass Look)**

Right now, the caps likely jump between a dark color and a flat bright color. Real frosted plastic absorbs and scatters light.

**Fix in Fragment Shader:** Use a radial gradient to make the center of the cap the hottest point, fading out towards the edges, but keep the edges sharp.

```glsl
// Assuming v_uv goes from 0.0 to 1.0 across the cap
vec2 centerDist = v_uv - 0.5;
float radial = length(centerDist) * 2.0; // 0.0 at center, 1.0 at edge

// Core hotspot
float hotSpot = exp(-radial * 4.0) * glowIntensity;

// Ambient diffusion inside the plastic
float diffusion = smoothstep(1.0, 0.2, radial) * glowIntensity * 0.5;

vec3 finalLight = capColor * (hotSpot + diffusion);
```

**B. Fresnel Rim Lighting**

Hardware buttons catch light on their beveled edges regardless of whether the LED inside is on.

**Fix:** Add a subtle white rim to the caps based on the SDF (Signed Distance Field) distance from the edge.

```glsl
float distToEdge = ... // Your SDF box function
float bevel = smoothstep(0.05, 0.0, abs(distToEdge)); // Highlights the edge boundary
finalColor += vec3(0.15) * bevel; // Permanent ambient rim reflection
```

**C. Chromatic Aberration & Lens Distortion**

To make it feel like you are looking at hardware through a camera lens, add a post-processing pass (or build it into the WGSL bloom_composite.wgsl). Split the RGB channels slightly near the edges of the screen.

---

## 🏗️ Technical / Architecture Feedback

### Vite Dynamic Import Paths
Double-check your AudioWorklet loading. If you ever see a 404 for `openmpt-worklet.js` in production, ensure you are using `/* @vite-ignore */` in your dynamic imports or explicitly pulling from the `?url` Vite suffix. Web Workers/Worklets get mangled by bundlers easily.

### Render Loop Decoupling
You are passing `sequencerCurrentRow` via React state. React state updates are asynchronous and batched. If your song hits 150 BPM at 6 Ticks/Row, React will struggle to re-render the components fast enough, causing visual stuttering while the audio remains fine.

**Improvement:** In `useLibOpenMPT.ts`, write the current `playheadRow` to a `useRef`. Have your WebGL/WebGPU `requestAnimationFrame` loop read directly from `playheadRef.current` bypassing React entirely. This guarantees 144hz butter-smooth scrolling regardless of React's lifecycle.

---

## 🚀 Comprehensive Upgrade Roadmap

More upgrade notes for xm-player (mod-player). Here's a deeper, prioritized list of upgrades beyond the note-duration visualization. These build directly on the current state (as of Apr 9–10 2026 commits: color-per-note restored, LED visibility boosted, media lookup optimized, v0.50 default shader, etc.). Everything stays true to the retro-futuristic tracker aesthetic while making the WebGPU pattern display feel next-level.

### 1. Note Duration Visualization (Highest ROI – do this first)

You specifically asked about blue LED emitter steps for full note durations + amber glow for expression-only rows. This is still missing and would be the biggest visual win.

**Implementation path:**
- In the pattern data packer (`WebGPUPatternRenderer` or `usePatternData.ts` hook): pre-compute per-channel note spans once per pattern (or incrementally on row change).
- Add two new fields to the GPU buffer: `noteDuration: f32` (rows the note sustains) and `expressionOnly: u32` (1/0 flag).
- In WGSL (new variant `patternv0.51_duration.wgsl` or extend v0.50):
  - For active note rows: taller vertical LED rectangle + stronger blue emissive center (use your existing bloom pipeline).
  - For expression-only rows: shorter amber "pip" glow (softer threshold, different hue in fragment shader).
  - Add subtle vertical fade on long sustains so the eye can see "this note is still ringing".
- Tie intensity to actual volume/expression value from libopenmpt for breathing/organic feel.

**Bonus polish:** Current playhead could pulse brighter on the first row of a note trigger.

This would make melodic lines and ambient modules instantly readable at a glance—huge step up from classic trackers.

### 2. Shader & Graphical Detail Upgrades

The shader folder structure (`shaders/`, `shaders-enhanced/`, `mod-player-shaders/`) is already rich. Let's level it up.

**Multi-layer bloom (easy win):** Separate bloom passes for note triggers (bright blue) vs sustains (softer) vs expression (amber). Reuse your existing `bloomPostProcessor.ts`.

**New post-process effects** (add 2–3 new .wgsl files):
- Subtle CRT phosphor + scanlines (light horizontal lines that react to brightness).
- Light chromatic aberration on the edges of the grid (gives hardware feel).
- "Studio dimming" toggle that desaturates everything except the LEDs (great for live streams).

**Dynamic per-instrument palettes:** Let users (or the module itself) define color sets. Store in a small JSON alongside the module and pass as uniform.

**3D LED extrusion (medium effort):** In fragment shader, add a fake bevel/highlight based on row index so notes look slightly raised/embossed.

**Shader UI improvements (quick):**
- Thumbnail previews in the selector (render a tiny static frame of each shader).
- "Random shader" button + favorites list.
- Save last-used shader per module (localStorage + optional backend save).

### 3. Performance & Stability (Address existing TODOs)

Recent commits already cleaned up redundant loops—keep that momentum.

**PatternViewer render loop:** Memoize the data-packing step (React `useMemo` + `useCallback`). Only re-pack when pattern, row, or playback position actually changes.

**Audio drift fix** (listed in TODOs): Move more libopenmpt logic into the AudioWorklet (you already have the folder). The new `lastUpdateTimestamp` commit is a good start—add periodic position correction.

**GPU compute shader option:** Offload note-duration calculation to a compute shader instead of JS. Massive win for huge patterns.

**Fallback mode polish:** When WebGPU is unavailable, enhance the HTML table with CSS glows (`box-shadow` + keyframes) so it doesn't feel like a downgrade.

**Mobile / low-end:** Add a "lite" mode that reduces visible rows and disables bloom.

### 4. UI/UX & Feature Polish

Current layout (VU meters, metadata, playlist, media overlay, debug panel on 'D') is clean but can feel denser.

**Keyboard shortcuts (instant win):**
- Space = play/pause
- ←/→ = seek row/order
- ↑/↓ = change pattern
- Numbers 1–9 = jump to order

**Hover tooltips on pattern steps:** Full cell info (note + instrument + volume + effect) on mouse-over (HTML overlay on top of canvas).

**Media overlay upgrades:** Auto-detect synced media from module comments or filename patterns. Add fade-in/out timing controls. Make it resizable or picture-in-picture.

**Playlist & library tab:** "My Library" that pulls directly from your storage_manager backend.

**Responsive tweaks:** On small screens, collapse metadata/VU into a side drawer. Make pattern grid zoomable with mouse wheel.

**Accessibility:** High-contrast mode, screen-reader labels for controls, color-blind friendly palettes.

### 5. Deep Integration with Storage Manager (app.py)

**Load from cloud:**
- Add a "Browse Library" button → calls `/api/songs?type=pattern`, `/api/samples`, `/api/shaders`, etc.
- Drag-and-drop from library or direct URL load.
- One-click "Load random shader" from your `/api/shaders` endpoint.

**Save back:**
- "Save pattern as…" → POST to `/api/songs` with enriched metadata (including your new duration data if you want).
- Favorite modules/playlists stored in `banks/` or `notes/`.

**Sync button:** Call your `/api/admin/sync` from inside the player so users can refresh their cloud library without leaving the app.

**Shader rating flow:** Hook the existing `/api/shaders/{id}/rate` endpoint directly into the UI (you already have the rating system).

This turns the player into a full cloud-native tracker companion.

### 6. Quick Wins & Low-Hanging Fruit (do these today)

- Add version badge in footer (e.g., "v0.8.4 • WebGPU v0.50").
- Persist shader choice across refreshes.
- Show current BPM / speed in the top bar (already in debug panel—expose it).
- Tiny "Export screenshot" button that captures the canvas with bloom baked in (use toDataURL).
- Darker default night mode with higher LED contrast (your recent "boost LED visibility" commit is close).

### 7. Longer-Term / Nice-to-Have Ideas

- Mini pattern editor (edit notes directly in the grid).
- Export to WAV or new module format.
- Community sharing: "Share this module + shader combo" link that stores in your GCS.
- Offline PWA support + bundled WASM (addressed in WASM_BUILD_SOLUTIONS.md).
- FastTracker II feature parity checklist (you already have plan.md—use it as a roadmap).

The app is already one of the best-looking web trackers out there (especially after the Apr 7 color-per-note + LED fixes). Adding sustained-note durations + tighter backend integration would make it feel complete and truly unique.

---

## 🎯 Advanced Architecture Advice

Since you are building a highly technical, high-performance audio/visual application, you are eventually going to hit the ceiling of what standard web development patterns can handle.

Here is some advanced advice to bulletproof your architecture and give your app that premium, native "desktop software" feel.

### 1. Achieving "Sample-Accurate" Visual Sync

Trackers are famous for their rigid, mathematical timing. Right now, your `updateUI` loop relies on `requestAnimationFrame` polling the audio context or the worklet for the current time. If you just snap the visualizer to `currentRow`, the scrolling will look jerky (updating only 6-10 times a second depending on the BPM/Speed).

**The Pro Move (Fractional Interpolation):**

To get butter-smooth, 144Hz scrolling, you need to calculate the fractional row position. In your `updateUI` loop, calculate exactly how far the playhead is between the current row and the next row based on the elapsed time since the last row change.

```typescript
// Inside updateUI or your render loop
const timeSinceRowStart = audioCtx.currentTime - timeAtLastRowChange;
const timePerRow = 60 / (bpm * 24); // Assuming standard tracker timing (24 ticks per beat)
const fractionalProgress = Math.min(1.0, timeSinceRowStart / timePerRow);

// Pass this to your shader!
const smoothPlayhead = currentRow + fractionalProgress;
```

When you pass `smoothPlayhead` as an f32 to your shaders, the grid and the WebGL caps will glide continuously rather than jumping from cell to cell.

### 2. The Canvas Compositing Trap (WebGPU + WebGL)

You are using two cutting-edge graphics APIs at the same time. If you have a WebGPU `<canvas>` for the chassis and a WebGL `<canvas>` stacked on top of it for the caps, you need to be very careful about browser compositing overhead.

**The Problem:** Two heavy hardware-accelerated canvases stacked on top of each other forces the browser's compositor to do a lot of heavy lifting, which can drop frames on lower-end devices or laptops on battery power.

**The CSS Fix:** Make absolutely sure the top canvas (WebGL) has `pointer-events: none;` in its CSS so the browser doesn't have to calculate hit-testing for both layers.

**The Blend Mode Hack:** If your WebGL caps have dark/black backgrounds that you are making transparent, try setting the WebGL canvas CSS to `mix-blend-mode: screen;` or `mix-blend-mode: plus-lighter;`. This tells the GPU to optically add the light of the caps to the WebGPU chassis underneath, which looks incredibly realistic for LEDs and is highly optimized by browsers.

### 3. Preventing "Main Thread" Freezes on Load

You are currently passing the raw .mod or .xm file directly to libopenmpt on the main thread inside `processModuleData`.

For small 100kb .mod files, this is fine. For a 5MB .it file, `_openmpt_module_create_from_memory2` might lock up the main thread for 300ms to 1 second. During this time, your UI will freeze, and any currently playing audio might glitch.

**The Pro Move (Web Worker Parsing):**

Move the initial parsing of the module metadata (title, patterns, duration) into a standard Web Worker.

1. User drops file → Send ArrayBuffer to Worker.
2. Worker runs an isolated instance of libopenmpt, unpacks the patterns, and builds the PatternMatrix JSON.
3. Worker sends the JSON back to the Main Thread to update React state.
4. Main Thread then sends the raw buffer to the AudioWorklet to actually play it.

### 4. Audio-Reactive Oscilloscopes (The Holy Grail)

If you ever want to add real-time oscilloscopes or spectrum analyzers to those circular layouts: **Do not use React state for this.**

Using `AnalyserNode.getByteTimeDomainData()` and passing it through React state will murder your frame rate.

**Instead, use a SharedArrayBuffer.**

1. Allocate a new `SharedArrayBuffer(1024)` on the Main Thread.
2. Pass it to your AudioWorklet.
3. In the Worklet, fill it with raw audio samples every block (128 frames).
4. On the Main Thread, your WebGL/WebGPU render loop can read directly from that `SharedArrayBuffer` using a `Float32Array` view and upload it directly to a GPU texture (`device.queue.writeTexture`) every frame.

This creates a zero-latency, zero-garbage-collection pipeline straight from the audio thread to the GPU!

---

## Summary of Priority Fixes

The most impactful things to address, in order:

1. **Fix the 5-channel vs 4-channel buffer mismatch** — may be silently dropping expression data
2. **Get the AudioWorklet to load correctly** — eliminate ScriptProcessor fallback
3. **Implement the note-duration sustain tail display** — using the extra data channel
4. **Amber vs. blue emitter color differentiation** — for expression-only steps

The graphical improvements to the LED housing, inner-ring labeling, and chassis contrast are relatively quick CSS/shader tweaks that would significantly elevate the overall feel.
