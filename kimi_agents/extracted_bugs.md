# Extracted Bugs/Issues from weekly_plan.md

Generated from: `/root/mod-player/weekly_plan.md`
Date: 2026-04-10

---

## 1. Critical Bugs (Data Corruption, Crashes)

### 1.1 Channel Count Mismatch (Data Corruption)
**Description:** The pattern data packer computes 64×5 = 320 cells (5 channels), but PatternDisplay allocates only a 256-cell buffer (64×4). The 5th channel's data is being written beyond the buffer boundary, causing silent overflow or the fifth channel being dropped. This blocks note duration/expression display since the 5th column contains metadata.

**Affected Files/Components:** 
- `packPatternMatrixHighPrecision` (data packer)
- `PatternDisplay` (buffer allocator)

**Suggested Fix:** Align buffer allocation with packer output - either increase PatternDisplay buffer to 320 cells (64×5) or reduce packer to 4 channels. The 5th channel appears to be for metadata (effects/expression), so preserving it is likely the correct approach.

---

### 1.2 Audio Engine Falling Back to ScriptProcessor
**Description:** Status bar shows "Playing (ScriptProcessor fallback)..." instead of AudioWorklet. ScriptProcessor is deprecated and introduces latency. The "⚡ Worklet" button is visible but worklet is not activating - possibly a timing/CORS/WASM loading issue.

**Affected Files/Components:**
- Audio worklet loading code
- `public/worklets/openmpt-processor.js`
- WASM loading/configuration

**Suggested Fix:** Check WASM loading timing and CORS headers on deployment server. Verify AudioWorklet module is being registered correctly. Add retry logic or ensure WASM is fully loaded before worklet initialization.

---

## 2. High Priority (Functional Issues)

### 2.1 PatternDisplay Mode Shows "NONE" Despite v0.50 Active
**Description:** Debug panel shows Mode: NONE while the circular shader "v0.50 (Trap Frosted Lens)" is actively rendering. The visual clearly works (WebGPU canvas confirmed), but the debug panel displays incorrect state.

**Affected Files/Components:**
- Debug panel UI component
- PatternDisplay state tracking
- GPU pipeline state synchronization

**Suggested Fix:** Synchronize the mode state variable with the actual GPU pipeline state. Ensure the debug panel reads from the same source that determines which shader is loaded.

---

### 2.2 Scroll Anchor Problem
**Description:** Clicking "▶️ Play" scrolls the page to the bottom of the canvas (controls area), hiding the visualization. User must manually scroll back up to see the visual.

**Affected Files/Components:**
- Play button component
- Event handlers in control components

**Suggested Fix:** Prevent default scroll behavior on play button click. Remove any `focus()` calls that cause scroll jumps, or use `preventScroll: true` option when focusing elements.

---

### 2.3 Render Loop Decoupling - Visual Stuttering
**Description:** `sequencerCurrentRow` is passed via React state, which is asynchronous and batched. At high BPM (150+ with 6 ticks/row), React cannot re-render fast enough, causing visual stuttering while audio remains fine.

**Affected Files/Components:**
- `hooks/useLibOpenMPT.ts`
- `PatternDisplay.tsx` render loop
- WebGL/WebGPU animation frame loop

**Suggested Fix:** Write current `playheadRow` to a `useRef` in `useLibOpenMPT.ts`. Have the WebGL/WebGPU `requestAnimationFrame` loop read directly from `playheadRef.current`, bypassing React entirely for smooth 144Hz updates.

---

### 2.4 Main Thread Freezes on Module Load
**Description:** Large module files (5MB+ .it files) cause `_openmpt_module_create_from_memory2` to lock the main thread for 300ms-1 second, freezing UI and potentially glitching audio.

**Affected Files/Components:**
- `processModuleData` function
- libopenmpt WASM module initialization

**Suggested Fix:** Move module parsing to a Web Worker. Worker runs isolated libopenmpt instance, unpacks patterns, builds PatternMatrix JSON, then sends results back to main thread.

---

## 3. Medium Priority (UI/UX Issues)

### 3.1 Redundant/Stale Shader Files in Repository
**Description:** `/shaders` directory contains 63 files including `.kate-swp` swap files, `.bak` backups, and files like "patternv0.14.wgsl back" committed to main.

**Affected Files/Components:**
- `/shaders/` directory
- `.gitignore` configuration

**Suggested Fix:** Update `.gitignore` to exclude editor artifacts (`*.kate-swp`, `*.bak`, `* back`). Remove existing stale files from repository with `git rm`.

---

### 3.2 PatternDisplay Debug Panel Always Visible
**Description:** The PatternDisplay Debug floating panel overlaps the canvas and is permanently visible on load. It should default to hidden and only show when pressing 'D'.

**Affected Files/Components:**
- Debug panel component
- Keyboard handler for 'D' key

**Suggested Fix:** Set default visibility state to `false`/`collapsed`. Ensure the ✕ button and 'D' key toggle work correctly.

---

### 3.3 Inconsistent Button Styling
**Description:** The three buttons (3D Mode, Dark, Worklet) use inconsistent styling. The Dark button has a light/white background while others are colored.

**Affected Files/Components:**
- Header/Control bar component
- Tailwind CSS button styles

**Suggested Fix:** Apply consistent button styling across all controls, matching the industrial XASM-1 aesthetic (dark metal, bright accent text).

---

### 3.4 Vite Dynamic Import Path Issues
**Description:** Potential 404 errors for `openmpt-worklet.js` in production due to bundler mangling of Web Workers/Worklets.

**Affected Files/Components:**
- AudioWorklet loading code
- Vite configuration

**Suggested Fix:** Use `/* @vite-ignore */` in dynamic imports or explicitly use `?url` suffix for worklet paths.

---

### 3.5 Canvas Compositing Overhead
**Description:** Using WebGPU and WebGL canvases stacked together forces browser compositor to do heavy lifting, potentially dropping frames on lower-end devices.

**Affected Files/Components:**
- `MediaOverlay.tsx` or canvas container
- WebGPU chassis canvas
- WebGL caps canvas

**Suggested Fix:** Add `pointer-events: none;` CSS to top canvas to disable hit-testing. Consider using `mix-blend-mode: screen;` or `plus-lighter;` for realistic LED blending.

---

### 3.6 No Native Note Duration Visualization
**Description:** Current display is per-step only. Sustained notes only light their trigger row. No indication of note duration across rows or distinction for "expression-only" rows (volume slides, vibrato without new note).

**Affected Files/Components:**
- `hooks/useLibOpenMPT.ts` - `getPatternMatrix()`
- Pattern data packer
- WGSL shader (patternv0.XX.wgsl)

**Suggested Fix:** Pre-scan patterns to compute note spans. Add `noteDuration` and `isExpressionOnly` fields to GPU buffer. Update shader to render blue LED for notes, amber for expression-only, with fade for sustain tail.

---

## 4. Low Priority (Cleanup, Polish)

### 4.1 White Chassis vs Dark Ring Contrast
**Description:** The white XASM-1 chassis against light grey browser background causes edges to dissolve, reducing sense of depth.

**Affected Files/Components:**
- `chassisv0.37.wgsl` or chassis shader
- CSS styling

**Suggested Fix:** Add subtle drop shadow on outer chassis, or provide darker (#1a1a1a) chassis option as toggle.

---

### 4.2 Header/UI Area Styling
**Description:** Page title "libopenmpt Note Viewer" is plain left-aligned body text that contrasts oddly with the polished hardware aesthetic.

**Affected Files/Components:**
- Header component
- `App.tsx` or main layout

**Suggested Fix:** Move to dark full-bleed header matching canvas border color. Use consistent industrial aesthetic.

---

### 4.3 "TRACKER GPU-9000" Label Readability
**Description:** Label inside canvas uses thin, low-contrast font hard to read on dark background.

**Affected Files/Components:**
- Shader text rendering or overlay component

**Suggested Fix:** Use larger, spaced-out monospace font (letter-spacing: 3px, font-weight: 600, opacity: 0.6) for authentic hardware silkscreen look.

---

### 4.4 Step Cell Visual Detail
**Description:** Cell edges look uniformly dark. LED glow bloom is weak on inactive cells, making them all look identical.

**Affected Files/Components:**
- Pattern shader (fragment shader)
- `bloomPostProcessor.ts`

**Suggested Fix:** Add brighter chrome-like inner bevel on housing. Add slight grey glow to distinguish "empty but present channel" from unpopulated steps.

---

### 4.5 Three-Emitter Layout Clarity
**Description:** Top and bottom emitters are very subtle grey circular domes with insufficient differentiation.

**Affected Files/Components:**
- Pattern shader (v0.50)
- LED rendering code

**Suggested Fix:** Make top (note-on) emitter bright royal blue (#0080FF) with visible halo. Define purpose for bottom emitter (note-off flash or volume indicator). Use amber (#FFA500) for expression-only steps.

---

### 4.6 Playhead Indicator Enhancement
**Description:** No animated sweep - the ring doesn't rotate to indicate current position, making it harder to track which row is playing.

**Affected Files/Components:**
- Pattern shader
- Playhead rendering

**Suggested Fix:** Add subtle illuminated "scan line" arc at current row position (like clock hand or radar sweep).

---

### 4.7 Inner Rings Labeling
**Description:** Inner rings near center have tiny cells due to circle geometry, look sparse and washed out. No channel labels visible.

**Affected Files/Components:**
- Pattern shader
- Text rendering system

**Suggested Fix:** Add small text arc labels (CH1, CH2, CH3, CH4) inside black center. Increase step height for innermost rings to compensate for perspective compression.

---

### 4.8 Missing Version Badge
**Description:** No version indicator visible in UI.

**Affected Files/Components:**
- Footer or header component

**Suggested Fix:** Add version badge (e.g., "v0.8.4 • WebGPU v0.50") to footer.

---

### 4.9 Shader Choice Not Persisted
**Description:** Selected shader is lost on page refresh.

**Affected Files/Components:**
- Shader selection state

**Suggested Fix:** Persist shader choice to localStorage and restore on load.

---

### 4.10 No Screenshot Export
**Description:** Cannot capture the current visualization state.

**Affected Files/Components:**
- Canvas component

**Suggested Fix:** Add "Export screenshot" button using `canvas.toDataURL()` to capture with bloom baked in.

---

## Summary Statistics

| Priority | Count |
|----------|-------|
| Critical | 2 |
| High | 4 |
| Medium | 6 |
| Low | 10 |
| **Total** | **22** |

---

## Top Priority Fixes (Recommended Order)

1. **Fix the 5-channel vs 4-channel buffer mismatch** - may be silently dropping expression data
2. **Get the AudioWorklet to load correctly** - eliminate ScriptProcessor fallback
3. **Fix scroll anchor problem** - prevents user from seeing visualization on play
4. **Implement render loop decoupling** - fix visual stuttering at high BPM
5. **Implement note-duration sustain tail display** - major visual improvement
