# Extracted Feature Requests & Enhancements

> Extracted from `/root/mod-player/weekly_plan.md`  
> XASM-1 (patternv0.50 "Trap Frosted Lens") - Weekly Plan Analysis

---

## 1. Core Features

### 1.1 Note Duration Visualization (Sustain Tails)
- **Description:** Display how long a note sustains across multiple rows by showing a visual "tail" following the note trigger. Currently only the trigger row lights up; sustained notes should fill intermediate steps with a dimmer version of the note color.
- **Technical Approach:**
  - Add `noteDuration` field to packed cell struct in `packPatternMatrixHighPrecision`
  - Pre-scan pattern data to compute note spans (rows until next note or note-off)
  - Pack duration data into the 5th channel metadata row
  - Shader reads duration to render consecutive cells at 40-60% brightness
  - Fade slightly toward end of sustain (linear fade over last 2-3 rows)
- **Priority:** 🔴 **Critical / Highest ROI**

### 1.2 Blue LED Note-On Emitter
- **Description:** Add a bright royal blue (#0080FF) top emitter that glows distinctly when a note starts on that step, differentiating note triggers from sustained notes.
- **Technical Approach:**
  - Extend WGSL shader to detect note-on events
  - Add top emitter dot with bright blue glow and visible halo
  - Use existing bloom pipeline for emissive effect
- **Priority:** 🔴 **High**

### 1.3 Amber LED for Expression-Only Steps
- **Description:** Steps containing volume slides, portamento, vibrato, or effects (but no new note pitch) should glow amber (#FFA500) instead of appearing "dead."
- **Technical Approach:**
  - Unpack volume (`volCmd`) and effect (`effCmd`) commands in fragment shader
  - Check for `volCmd > 0 || effCmd > 0` with no note trigger
  - Apply amber color with slightly dimmer glow (0.6 intensity vs 1.0)
  - Skip note-color fill, show only amber emitter
- **Priority:** 🔴 **High**

### 1.4 Three-Emitter LED System Refinement
- **Description:** Clarify and enhance the three-emitter layout per step cell. Currently the top and bottom emitters are subtle grey domes with unclear purposes.
- **Technical Approach:**
  - Top: Bright royal blue for note-on triggers
  - Bottom: Use for note-off flash or volume/velocity indication (brighter = louder)
  - Expression-only: Amber emitter as dominant visual signal
  - Add stronger differentiation between emitter states in shader
- **Priority:** 🟡 **Medium**

---

## 2. Graphical Improvements

### 2.1 Subsurface Scattering (Frosted Glass Look)
- **Description:** Enhance LED caps to look like real injection-molded frosted plastic that absorbs and scatters light, rather than flat colors.
- **Technical Approach:**
  - Use radial gradient in fragment shader: center = hotspot, fade to edges
  - Add core hotspot: `exp(-radial * 4.0) * glowIntensity`
  - Add ambient diffusion: `smoothstep(1.0, 0.2, radial) * glowIntensity * 0.5`
- **Priority:** 🟡 **Medium**

### 2.2 Fresnel Rim Lighting
- **Description:** Add subtle white rim highlights to cap edges to simulate hardware buttons catching ambient light on beveled edges.
- **Technical Approach:**
  - Calculate SDF distance from edge
  - Apply: `smoothstep(0.05, 0.0, abs(distToEdge))` for edge highlight
  - Add permanent ambient rim: `finalColor += vec3(0.15) * bevel`
- **Priority:** 🟡 **Medium**

### 2.3 Multi-Layer Bloom
- **Description:** Separate bloom passes for different visual elements: note triggers (bright blue), sustains (softer), expression (amber).
- **Technical Approach:**
  - Reuse existing `bloomPostProcessor.ts`
  - Add different bloom thresholds per pass type
  - Note triggers: strong bloom; sustains: subtle bloom; expression: different hue threshold
- **Priority:** 🟡 **Medium**

### 2.4 Chromatic Aberration & Lens Distortion
- **Description:** Add subtle RGB channel splitting near screen edges to simulate looking at hardware through a camera lens.
- **Technical Approach:**
  - Add to `bloom_composite.wgsl` or new post-process shader
  - Split RGB channels slightly based on distance from screen center
- **Priority:** 🟢 **Low**

### 2.5 Animated Playhead / Scan Line
- **Description:** Add an illuminated "scan line" arc at the current row position (like a clock hand or radar sweep) to make the playing row more legible.
- **Technical Approach:**
  - Calculate fractional row position for smooth animation
  - Render glowing arc from center to current row at 12-o'clock position
  - Use shader uniforms for smooth 144Hz interpolation
- **Priority:** 🟡 **Medium**

### 2.6 3D LED Extrusion / Bevel Effects
- **Description:** Add fake bevel/highlight based on row index so notes look slightly raised/embossed.
- **Technical Approach:**
  - Add height offset calculation in fragment shader based on row index
  - Simulate directional lighting from top-left
  - Add drop shadow beneath raised cells
- **Priority:** 🟢 **Low**

### 2.7 Channel Ring Labels
- **Description:** Add CH1, CH2, CH3, CH4 labels to clarify channel mapping in the circular layout.
- **Technical Approach:**
  - Render small text arcs inside the black center
  - Or use subtle radial lines with tiny labels at center edge
  - Compensate inner ring cell size for perspective compression
- **Priority:** 🟡 **Medium**

### 2.8 Chassis Contrast & Dark Mode
- **Description:** The white chassis dissolves against light grey background. Add drop shadow or darker chassis option.
- **Technical Approach:**
  - Add CSS drop shadow to canvas container
  - Create toggle for dark chassis (#1a1a1a instead of white)
  - Improve LED pop against darker backgrounds
- **Priority:** 🟡 **Medium**

### 2.9 CRT Phosphor & Scanline Overlay
- **Description:** Add retro CRT aesthetic with horizontal scanlines that react to brightness.
- **Technical Approach:**
  - New WGSL post-process shader
  - Horizontal line pattern modulated by scene brightness
  - Optional phosphor ghosting effect
- **Priority:** 🟢 **Low**

### 2.10 Studio Dimming Mode
- **Description:** Desaturate everything except the LEDs for live stream visibility.
- **Technical Approach:**
  - Shader toggle that reduces background/chassis saturation to near-zero
  - Keep LED colors at full saturation
- **Priority:** 🟢 **Low**

### 2.11 Dynamic Per-Instrument Palettes
- **Description:** Allow custom color assignments per instrument rather than just per pitch.
- **Technical Approach:**
  - Store palette in JSON alongside module
  - Pass as uniform to shader
  - UI for editing/customization
- **Priority:** 🟢 **Low**

---

## 3. UI/UX Enhancements

### 3.1 Keyboard Shortcuts
- **Description:** Add standard tracker keyboard controls.
- **Shortcuts:**
  - Space = play/pause
  - ←/→ = seek row/order
  - ↑/↓ = change pattern
  - Numbers 1–9 = jump to order
- **Priority:** 🟡 **Medium / Quick Win**

### 3.2 Hover Tooltips on Pattern Steps
- **Description:** Show full cell info (note + instrument + volume + effect) on mouse-over.
- **Technical Approach:**
  - HTML overlay on canvas using mouse position
  - Query pattern data from React state or ref
  - Display formatted tracker cell data
- **Priority:** 🟡 **Medium**

### 3.3 Shader Selector Improvements
- **Description:** Enhanced shader selection UI.
- **Features:**
  - Thumbnail previews (render tiny static frame of each shader)
  - "Random shader" button
  - Favorites list
  - Persist shader choice across refreshes (localStorage)
  - Save last-used shader per module
- **Priority:** 🟡 **Medium**

### 3.4 Debug Panel Visibility
- **Description:** PatternDisplay debug panel overlaps canvas and shows permanently. Should default to hidden.
- **Technical Approach:**
  - Set default state to collapsed
  - Only show when pressing 'D' as documented
  - Ensure it doesn't overlap main render area
- **Priority:** 🟡 **Medium**

### 3.5 Header & Button Styling Consistency
- **Description:** Page title and buttons have inconsistent styling against polished hardware aesthetic.
- **Features:**
  - Move title to dark full-bleed header matching canvas border
  - Unify button styles (Dark button has white bg, others are colored)
  - Industrial aesthetic: dark metal, bright accent text
- **Priority:** 🟡 **Medium**

### 3.6 TRACKER GPU-9000 Label Enhancement
- **Description:** The canvas label uses thin, low-contrast font.
- **Technical Approach:**
  - Increase font size
  - Add letter-spacing: 3px
  - font-weight: 600
  - opacity: 0.6 for authentic hardware silkscreen feel
- **Priority:** 🟢 **Low / Quick Win**

### 3.7 Scroll Anchor Fix
- **Description:** Clicking Play scrolls page to bottom, hiding visualization.
- **Technical Approach:**
  - Prevent default focus/scroll behavior on play button
  - Use `event.preventDefault()` or adjust button wiring
- **Priority:** 🟡 **Medium**

### 3.8 Media Overlay Upgrades
- **Description:** Enhanced media display controls.
- **Features:**
  - Auto-detect synced media from module comments or filename patterns
  - Fade-in/out timing controls
  - Resizable or picture-in-picture mode
- **Priority:** 🟢 **Low**

### 3.9 Responsive Layout Improvements
- **Description:** Better handling of small screens.
- **Features:**
  - Collapse metadata/VU into side drawer on small screens
  - Make pattern grid zoomable with mouse wheel
  - Auto-scale row count based on screen size
- **Priority:** 🟡 **Medium**

### 3.10 Accessibility Features
- **Description:** Make app usable for more users.
- **Features:**
  - High-contrast mode
  - Screen-reader labels for controls
  - Color-blind friendly palettes
- **Priority:** 🟢 **Low**

### 3.11 Version Badge & Footer Info
- **Description:** Show current version and technical info.
- **Features:**
  - Footer badge: "v0.8.4 • WebGPU v0.50"
  - Show current BPM / speed in top bar
- **Priority:** 🟢 **Low / Quick Win**

### 3.12 Screenshot Export
- **Description:** Capture canvas with bloom baked in.
- **Technical Approach:**
  - Add "Export screenshot" button
  - Use `canvas.toDataURL()` after bloom composite pass
- **Priority:** 🟢 **Low / Quick Win**

---

## 4. Performance & Architecture

### 4.1 Fix Channel Count Mismatch (Data Corruption Bug)
- **Description:** Critical bug: packer computes 64×5 = 320 cells, but PatternDisplay allocates 256-cell buffer (64×4). 5th channel data overflows or is dropped.
- **Technical Approach:**
  - Align buffer sizes: either use 5 channels throughout or fix allocation
  - Update `PatternDisplay` to allocate 320-cell buffer
  - Verify no silent data loss on 5th channel (expression metadata)
- **Priority:** 🔴 **Critical - Blocks note duration display**

### 4.2 AudioWorklet Activation Fix
- **Description:** Status shows "ScriptProcessor fallback" instead of AudioWorklet. Worklet button visible but not activating.
- **Technical Approach:**
  - Check timing/CORS/WASM loading issues on deployment server
  - Verify worklet file is being served correctly
  - Use `/* @vite-ignore */` in dynamic imports if needed
- **Priority:** 🔴 **Critical - Affects audio/visual sync**

### 4.3 Render Loop Decoupling from React State
- **Description:** React state updates for `sequencerCurrentRow` cause visual stuttering at high BPM. Need 144Hz butter-smooth scrolling.
- **Technical Approach:**
  - Write `playheadRow` to `useRef` instead of React state
  - WebGL/WebGPU `requestAnimationFrame` loop reads from `playheadRef.current`
  - Bypass React entirely for render loop
- **Priority:** 🔴 **High**

### 4.4 Sample-Accurate Visual Sync (Fractional Interpolation)
- **Description:** Current visualizer snaps to `currentRow` causing jerky updates. Need smooth fractional positioning.
- **Technical Approach:**
  - Calculate `timeSinceRowStart` from audio context
  - Compute `fractionalProgress` based on BPM/timing
  - Pass `smoothPlayhead` (currentRow + fraction) as f32 to shader
- **Priority:** 🟡 **Medium**

### 4.5 Pattern Data Memoization
- **Description:** Re-packing pattern data on every frame is expensive for complex patterns.
- **Technical Approach:**
  - Use React `useMemo` + `useCallback` for data-packing step
  - Only re-pack when pattern, row, or playback position changes
  - Cache packed buffers per pattern
- **Priority:** 🟡 **Medium**

### 4.6 Web Worker for Module Parsing
- **Description:** Large module files (5MB+) freeze main thread during `_openmpt_module_create_from_memory2`.
- **Technical Approach:**
  - Move parsing to standard Web Worker
  - Worker runs isolated libopenmpt instance
  - Returns PatternMatrix JSON to main thread
  - Main thread sends raw buffer to AudioWorklet
- **Priority:** 🟡 **Medium**

### 4.7 GPU Compute Shader for Note Duration
- **Description:** Offload note-duration calculation to GPU instead of JavaScript.
- **Technical Approach:**
  - Use WebGPU compute shader for pattern pre-processing
  - Massive win for huge patterns
  - Process entire pattern in parallel
- **Priority:** 🟢 **Low (Advanced)**

### 4.8 SharedArrayBuffer for Audio Data
- **Description:** Real-time oscilloscope/spectrum analyzer data through React state kills frame rate.
- **Technical Approach:**
  - Allocate `SharedArrayBuffer(1024)` on Main Thread
  - Pass to AudioWorklet
  - Worklet fills with raw samples every 128 frames
  - Render loop reads directly using Float32Array view
  - Upload to GPU texture via `device.queue.writeTexture`
- **Priority:** 🟢 **Low (Advanced)**

### 4.9 Canvas Compositing Optimization
- **Description:** Two heavy canvases (WebGPU + WebGL) cause compositor overhead.
- **Technical Approach:**
  - Ensure top canvas has `pointer-events: none`
  - Use `mix-blend-mode: screen` or `plus-lighter` for LED realism
  - Consider merging to single canvas if possible
- **Priority:** 🟡 **Medium**

### 4.10 Mobile/Low-End "Lite" Mode
- **Description:** Reduce visual quality for lower-end devices.
- **Features:**
  - Reduce visible rows
  - Disable bloom
  - Simpler shaders
- **Priority:** 🟢 **Low**

### 4.11 Fallback Mode Polish
- **Description:** When WebGPU unavailable, HTML table fallback loses polish.
- **Technical Approach:**
  - Enhance HTML table with CSS glows (`box-shadow` + keyframes)
  - Match visual aesthetic as closely as possible
- **Priority:** 🟢 **Low**

### 4.12 Cleanup Stale Shader Files
- **Description:** `/shaders` directory has 63 files including .kate-swp, .bak, and "back" files.
- **Technical Approach:**
  - Add editor artifacts to .gitignore
  - Remove committed swap/backup files
- **Priority:** 🟢 **Low**

---

## 5. Integration Features

### 5.1 Cloud Library Browser
- **Description:** Browse and load from storage_manager backend.
- **Features:**
  - "Browse Library" button → calls `/api/songs?type=pattern`, `/api/samples`, `/api/shaders`
  - Drag-and-drop from library
  - Direct URL load
  - One-click "Load random shader" from `/api/shaders`
- **Priority:** 🟡 **Medium**

### 5.2 Save to Cloud
- **Description:** Save patterns/modules back to backend.
- **Features:**
  - "Save pattern as…" → POST to `/api/songs` with enriched metadata
  - Favorite modules/playlists stored in `banks/` or `notes/`
- **Priority:** 🟡 **Medium**

### 5.3 Sync Button Integration
- **Description:** Call `/api/admin/sync` from inside player.
- **Use Case:** Users refresh cloud library without leaving app
- **Priority:** 🟢 **Low**

### 5.4 Shader Rating Flow
- **Description:** Hook existing `/api/shaders/{id}/rate` endpoint into UI.
- **Note:** Rating system already exists in backend
- **Priority:** 🟢 **Low**

### 5.5 Playlist & Library Tab
- **Description:** "My Library" that pulls directly from storage_manager.
- **Features:**
  - Persistent playlist management
  - Cloud-synced favorites
- **Priority:** 🟡 **Medium**

### 5.6 Offline PWA Support
- **Description:** Bundle WASM for offline use.
- **Technical Approach:**
  - Addressed in WASM_BUILD_SOLUTIONS.md
  - Service worker for caching
  - Bundled libopenmpt.js/.wasm files
- **Priority:** 🟢 **Low**

### 5.7 Community Sharing
- **Description:** Share module + shader combo links.
- **Features:**
  - Generate shareable links
  - Store combo in GCS
  - Load shared combos by URL
- **Priority:** 🟢 **Nice-to-Have**

---

## Priority Legend

| Priority | Description |
|----------|-------------|
| 🔴 **Critical** | Blocks other features or causes data corruption/bugs |
| 🔴 **High** | Major feature requests explicitly asked for |
| 🟡 **Medium** | Significant improvements with clear implementation path |
| 🟢 **Low** | Nice-to-have, quick wins, or advanced features |

---

## Summary: Top 10 Priority Actions

1. **Fix 5-channel vs 4-channel buffer mismatch** (Critical bug)
2. **Fix AudioWorklet loading** (Critical - affects sync)
3. **Implement note duration visualization** (Highest ROI feature)
4. **Amber LED differentiation for expression-only steps**
5. **Blue LED emitter for note-on triggers**
6. **Render loop decoupling from React state** (Performance)
7. **Keyboard shortcuts** (Quick win)
8. **Subsurface scattering & Fresnel rim lighting** (Visual polish)
9. **Cloud library integration** (Backend connectivity)
10. **Fractional interpolation for smooth playhead** (Visual smoothness)
