# XASM-1 Task Breakdown - Comprehensive Project Management

**Project:** mod-player / XASM-1 (patternv0.50 "Trap Frosted Lens")  
**Generated:** 2026-04-10  
**Source:** weekly_plan.md

---

## Subject Areas

### 1. Data & Buffer Management
**Description:** Core data pipeline issues including channel count mismatches, buffer overflows, and pattern data packing integrity. This is the foundation for all visualizations.

**Related Files/Components:**
- `hooks/useLibOpenMPT.ts`
- `packPatternMatrixHighPrecision` function
- Pattern data packing utilities
- GPU buffer allocation logic

---

### 2. Audio Engine
**Description:** AudioWorklet loading, ScriptProcessor fallback elimination, and audio-visual synchronization improvements.

**Related Files/Components:**
- `public/worklets/openmpt-processor.js`
- AudioWorklet loading logic
- `hooks/useLibOpenMPT.ts`
- Vite dynamic import configuration

---

### 3. Shader & Rendering
**Description:** WebGPU shader improvements, LED emitter visuals, bloom effects, and graphical fidelity enhancements.

**Related Files/Components:**
- `shaders/patternv0.50.wgsl`
- `shaders/` directory (cleanup needed)
- `bloomPostProcessor.ts`
- `MediaOverlay.tsx`
- `components/PatternDisplay.tsx`

---

### 4. UI/UX Polish
**Description:** Header styling, button consistency, debug panel behavior, scroll anchoring, and overall user interface improvements.

**Related Files/Components:**
- `App.tsx`
- Debug panel component
- Header components
- Button styling (Tailwind)

---

### 5. Note Duration & Expression
**Description:** Implementation of blue LED emitters for note durations and amber emitters for expression-only steps.

**Related Files/Components:**
- `hooks/useLibOpenMPT.ts` - `getPatternMatrix()`
- Pattern data packer
- WGSL fragment shaders
- libopenmpt pattern scanning

---

### 6. Visual Polish & Effects
**Description:** Graphical improvements including chassis styling, LED housing, playhead indicators, and post-processing effects.

**Related Files/Components:**
- Chassis shaders
- LED cell rendering
- Playhead/sweep animation
- Post-processing pipeline

---

### 7. Performance & Architecture
**Description:** Advanced optimizations, render loop decoupling, sample-accurate visual sync, and architecture improvements.

**Related Files/Components:**
- React render loop
- `requestAnimationFrame` handling
- SharedArrayBuffer implementation
- Web Worker parsing

---

## Tasks by Subject

### Data & Buffer Management (DATA)

| ID | Title | Description | Effort | Dependencies | Subject |
|----|-------|-------------|--------|--------------|---------|
| **DATA-001** | Fix 5-channel vs 4-channel buffer mismatch | The packer computes 64×5=320 cells but PatternDisplay allocates 256-cell buffer (64×4). Fix buffer size allocation to handle 5 channels or reconcile the channel count discrepancy. | **Large** | - | Data & Buffer Management |
| **DATA-002** | Audit packPatternMatrixHighPrecision channel logic | Review how channel count is determined and passed through the data pipeline. Ensure consistency between packer and renderer. | **Medium** | DATA-001 | Data & Buffer Management |
| **DATA-003** | Add overflow protection to buffer writes | Implement bounds checking to prevent silent buffer overflows when packing pattern data. | **Small** | DATA-001 | Data & Buffer Management |
| **DATA-004** | Document channel 5 metadata row purpose | The 5th channel appears to be a metadata row for effects/expression. Document this architecture decision. | **Small** | DATA-001 | Data & Buffer Management |

---

### Audio Engine (AUDIO)

| ID | Title | Description | Effort | Dependencies | Subject |
|----|-------|-------------|--------|--------------|---------|
| **AUDIO-001** | Fix AudioWorklet loading failure | Status shows "ScriptProcessor fallback" instead of AudioWorklet. Investigate timing/CORS/WASM loading issues on deployment server. | **Large** | - | Audio Engine |
| **AUDIO-002** | Add Vite dynamic import protection | Use `/* @vite-ignore */` or `?url` suffix for worklet loading to prevent 404s in production. | **Medium** | AUDIO-001 | Audio Engine |
| **AUDIO-003** | Implement worklet activation button logic | The "⚡ Worklet" button is visible but worklet doesn't activate. Fix button wiring and state management. | **Medium** | AUDIO-001 | Audio Engine |
| **AUDIO-004** | Add worklet loading diagnostics | Implement logging and error handling for worklet initialization to aid debugging. | **Small** | AUDIO-001 | Audio Engine |

---

### Shader & Rendering (SHADER)

| ID | Title | Description | Effort | Dependencies | Subject |
|----|-------|-------------|--------|--------------|---------|
| **SHADER-001** | Fix PatternDisplay Mode showing "NONE" | Debug panel shows Mode: NONE despite v0.50 shader rendering. Sync debug panel state with actual GPU pipeline state. | **Medium** | - | Shader & Rendering |
| **SHADER-002** | Clean up stale shader files in /shaders | Remove .kate-swp swap files, .bak backups, and "patternv0.14.wgsl back" files from repo. Update .gitignore. | **Small** | - | Shader & Rendering |
| **SHADER-003** | Add chrome-like inner bevel to LED housing | Implement brighter inner bevel on cell edges for physical injection-molded LED cover appearance. | **Medium** | - | Shader & Rendering |
| **SHADER-004** | Add grey glow to inactive cells | Distinguish "empty but present channel" cells with subtle grey glow instead of uniform appearance. | **Small** | - | Shader & Rendering |
| **SHADER-005** | Brighten royal blue note-on emitter (#0080FF) | Make top (note-on) emitter distinctly bright with visible halo when active. | **Small** | - | Shader & Rendering |
| **SHADER-006** | Implement bottom emitter functionality | Define purpose for bottom emitter - could be note-off flash or volume/velocity indicator. | **Medium** | - | Shader & Rendering |
| **SHADER-007** | Add amber emitter for expression-only steps | Implement amber (#FFA500) emitter glow for steps with volume/effects but no note pitch. | **Medium** | EXPR-001 | Shader & Rendering |
| **SHADER-008** | Implement note duration "tail" rendering | Show note's pitch-class color at 40-60% brightness for sustain steps following note-on. | **Large** | DURA-001 | Shader & Rendering |
| **SHADER-009** | Add fade effect on note sustain tail | Implement linear fade over last 2-3 rows of note sustain for natural visual feel. | **Medium** | SHADER-008 | Shader & Rendering |
| **SHADER-010** | Add playhead scan line arc at 12-o'clock | Implement illuminated "scan line" arc at current row position like clock hand or radar sweep. | **Medium** | - | Shader & Rendering |
| **SHADER-011** | Add channel labels (CH1-CH4) to inner rings | Implement ring labels as text arc inside black center or radial line with tiny label. | **Medium** | - | Shader & Rendering |
| **SHADER-012** | Compensate inner ring cell size for perspective | Increase step height for innermost ring cells to compensate for circle geometry compression. | **Small** | - | Shader & Rendering |
| **SHADER-013** | Add subsurface scattering for frosted glass look | Use radial gradient for center hotspot with ambient diffusion inside plastic material. | **Medium** | - | Shader & Rendering |
| **SHADER-014** | Add Fresnel rim lighting to caps | Implement subtle white rim based on SDF distance from edge for beveled edge highlights. | **Medium** | - | Shader & Rendering |
| **SHADER-015** | Add chromatic aberration post-processing | Split RGB channels slightly near screen edges for hardware camera lens feel. | **Medium** | - | Shader & Rendering |
| **SHADER-016** | Implement multi-layer bloom passes | Separate bloom passes for note triggers (bright blue), sustains (softer), and expression (amber). | **Large** | SHADER-007, SHADER-008 | Shader & Rendering |

---

### UI/UX Polish (UI)

| ID | Title | Description | Effort | Dependencies | Subject |
|----|-------|-------------|--------|--------------|---------|
| **UI-001** | Fix play button scroll anchor problem | Prevent page from scrolling to bottom of canvas when clicking Play. Fix focus/scroll behavior. | **Small** | - | UI/UX Polish |
| **UI-002** | Add drop shadow to white XASM-1 chassis | Improve contrast against light grey browser background with subtle outer chassis shadow. | **Small** | - | UI/UX Polish |
| **UI-003** | Add dark chassis option toggle | Implement darker (#1a1a1a) chassis as toggleable option for improved LED pop. | **Medium** | - | UI/UX Polish |
| **UI-004** | Redesign header to dark full-bleed | Move page title to dark header matching canvas border color for hardware aesthetic. | **Medium** | - | UI/UX Polish |
| **UI-005** | Standardize button styling | Fix inconsistent styling between 3D Mode, Dark, and Worklet buttons - match industrial XASM-1 aesthetic. | **Small** | - | UI/UX Polish |
| **UI-006** | Make debug panel default to hidden | PatternDisplay debug panel should default collapsed and only show on 'D' key press. | **Small** | - | UI/UX Polish |
| **UI-007** | Fix "TRACKER GPU-9000" label readability | Use larger, spaced-out monospace font (letter-spacing: 3px, font-weight: 600) for hardware silkscreen feel. | **Small** | - | UI/UX Polish |
| **UI-008** | Add version badge in footer | Show "v0.8.4 • WebGPU v0.50" or similar in footer area. | **Small** | - | UI/UX Polish |
| **UI-009** | Persist shader choice across refreshes | Save last-used shader to localStorage and restore on page load. | **Small** | - | UI/UX Polish |
| **UI-010** | Show current BPM/speed in top bar | Expose BPM and speed values from debug panel to main UI. | **Small** | - | UI/UX Polish |
| **UI-011** | Add keyboard shortcuts | Implement: Space=play/pause, ←/→=seek row, ↑/↓=change pattern, 1-9=jump to order. | **Medium** | - | UI/UX Polish |
| **UI-012** | Add hover tooltips on pattern steps | Show full cell info (note + instrument + volume + effect) on mouse-over as HTML overlay. | **Medium** | - | UI/UX Polish |
| **UI-013** | Add export screenshot button | Capture canvas with bloom baked in using toDataURL for sharing. | **Small** | - | UI/UX Polish |
| **UI-014** | Implement shader thumbnail previews | Render tiny static frame of each shader in selector for visual preview. | **Large** | - | UI/UX Polish |
| **UI-015** | Add "Random shader" button | One-click random shader selection with optional favorites list. | **Small** | - | UI/UX Polish |

---

### Note Duration & Expression (EXPR/DURA)

| ID | Title | Description | Effort | Dependencies | Subject |
|----|-------|-------------|--------|--------------|---------|
| **EXPR-001** | Implement expression-only row detection | Unpack volume and effect commands to detect rows with no note but with expression data. | **Medium** | DATA-001 | Note Duration & Expression |
| **DURA-001** | Implement note duration calculation | Pre-scan patterns to compute note spans per channel using libopenmpt pattern data. | **Large** | DATA-001 | Note Duration & Expression |
| **DURA-002** | Add noteDuration field to packed cell struct | Extend packPatternMatrixHighPrecision to include duration/sustain count in packed data. | **Medium** | DURA-001 | Note Duration & Expression |
| **DURA-003** | Add isSustained boolean to row data | Pack sustain state into unused bit (e.g., top bit of inst) for shader access. | **Medium** | DURA-001 | Note Duration & Expression |
| **DURA-004** | Implement blue LED emitter for note triggers | Top emitter glows bright blue when note starts on that step. | **Medium** | DURA-002 | Note Duration & Expression |
| **DURA-005** | Tie glow intensity to volume/expression | Make glow brightness responsive to actual volume/expression data from libopenmpt. | **Medium** | DURA-002 | Note Duration & Expression |
| **DURA-006** | Add current row pulse on note trigger | Make playhead pulse brighter on first row of note trigger for visibility. | **Small** | DURA-004 | Note Duration & Expression |

---

### Visual Polish & Effects (VISUAL)

| ID | Title | Description | Effort | Dependencies | Subject |
|----|-------|-------------|--------|--------------|---------|
| **VISUAL-001** | Add CRT phosphor + scanlines effect | Light horizontal scanlines that react to brightness for retro CRT vibe. | **Medium** | - | Visual Polish & Effects |
| **VISUAL-002** | Implement "Studio dimming" toggle | Desaturate everything except LEDs for live stream viewing. | **Small** | - | Visual Polish & Effects |
| **VISUAL-003** | Add 3D LED extrusion fake bevel | Add highlight based on row index so notes look slightly raised/embossed. | **Medium** | - | Visual Polish & Effects |
| **VISUAL-004** | Implement animated playhead with particle trail | Glowing cursor with soft trail fade for better playhead visibility. | **Medium** | - | Visual Polish & Effects |
| **VISUAL-005** | Add instrument-specific color palettes | Let users define color sets stored in JSON alongside module. | **Large** | - | Visual Polish & Effects |
| **VISUAL-006** | Implement high-contrast accessibility mode | Add WCAG-compliant color-blind friendly palettes. | **Medium** | - | Visual Polish & Effects |

---

### Performance & Architecture (PERF)

| ID | Title | Description | Effort | Dependencies | Subject |
|----|-------|-------------|--------|--------------|---------|
| **PERF-001** | Decouple render loop from React state | Write playheadRow to useRef and have WebGPU RAF loop read directly from ref.current. | **Medium** | - | Performance & Architecture |
| **PERF-002** | Implement fractional row interpolation | Calculate smoothPlayhead as f32 based on time elapsed since last row for 144Hz butter-smooth scrolling. | **Large** | PERF-001 | Performance & Architecture |
| **PERF-003** | Move module parsing to Web Worker | Parse module metadata in Worker to prevent main thread freezing on large files. | **Large** | - | Performance & Architecture |
| **PERF-004** | Implement SharedArrayBuffer for oscilloscope | Zero-latency pipeline from audio thread to GPU for real-time waveform visualization. | **Large** | - | Performance & Architecture |
| **PERF-005** | Add memoization to pattern data packing | Use React useMemo + useCallback to only re-pack when pattern/row/position actually changes. | **Medium** | - | Performance & Architecture |
| **PERF-006** | Offload duration calculation to compute shader | Use GPU compute shader instead of JS for massive pattern performance win. | **Large** | DURA-001 | Performance & Architecture |
| **PERF-007** | Add CSS pointer-events: none to top canvas | Optimize browser compositing for stacked WebGPU + WebGL canvases. | **Small** | - | Performance & Architecture |
| **PERF-008** | Implement mix-blend-mode for canvas stacking | Use `mix-blend-mode: screen` or `plus-lighter` for realistic LED optical addition. | **Small** | - | Performance & Architecture |
| **PERF-009** | Add "Lite" mode for mobile/low-end | Reduce visible rows and disable bloom for lower-end devices. | **Medium** | - | Performance & Architecture |
| **PERF-010** | Enhance HTML table fallback with CSS glows | Add box-shadow + keyframes for glow effects when WebGPU unavailable. | **Medium** | - | Performance & Architecture |

---

### Backend Integration (BACKEND)

| ID | Title | Description | Effort | Dependencies | Subject |
|----|-------|-------------|--------|--------------|---------|
| **BACKEND-001** | Add "Browse Library" button | Call `/api/songs?type=pattern`, `/api/samples`, `/api/shaders` endpoints. | **Medium** | - | Backend Integration |
| **BACKEND-002** | Implement drag-and-drop from library | Load modules directly from library or via URL. | **Medium** | BACKEND-001 | Backend Integration |
| **BACKEND-003** | Add "Load random shader" from API | One-click random shader from `/api/shaders` endpoint. | **Small** | BACKEND-001 | Backend Integration |
| **BACKEND-004** | Implement "Save pattern as..." | POST enriched pattern data to `/api/songs` with metadata. | **Medium** | - | Backend Integration |
| **BACKEND-005** | Add sync button for cloud library | Call `/api/admin/sync` to refresh cloud library without leaving app. | **Small** | - | Backend Integration |
| **BACKEND-006** | Integrate shader rating flow | Hook `/api/shaders/{id}/rate` endpoint into UI. | **Small** | - | Backend Integration |
| **BACKEND-007** | Implement favorites/playlist storage | Store in `banks/` or `notes/` via backend API. | **Medium** | BACKEND-004 | Backend Integration |

---

### Media Overlay (MEDIA)

| ID | Title | Description | Effort | Dependencies | Subject |
|----|-------|-------------|--------|--------------|---------|
| **MEDIA-001** | Auto-detect synced media from module comments | Parse module comments or filename patterns for media sync info. | **Medium** | - | Media Overlay |
| **MEDIA-002** | Add fade-in/out timing controls | Control media overlay transition timing. | **Small** | - | Media Overlay |
| **MEDIA-003** | Make media overlay resizable | Implement picture-in-picture or resizable overlay. | **Medium** | - | Media Overlay |

---

## Milestones

### Phase 1: Critical Fixes (Week 1)
**Goal:** Stabilize the foundation by fixing data corruption and audio engine issues.

| Task ID | Title | Effort |
|---------|-------|--------|
| DATA-001 | Fix 5-channel vs 4-channel buffer mismatch | Large |
| DATA-002 | Audit packPatternMatrixHighPrecision channel logic | Medium |
| DATA-003 | Add overflow protection to buffer writes | Small |
| AUDIO-001 | Fix AudioWorklet loading failure | Large |
| AUDIO-002 | Add Vite dynamic import protection | Medium |
| AUDIO-003 | Implement worklet activation button logic | Medium |
| SHADER-001 | Fix PatternDisplay Mode showing "NONE" | Medium |
| SHADER-002 | Clean up stale shader files in /shaders | Small |
| UI-001 | Fix play button scroll anchor problem | Small |

**Phase 1 Total:** 8 tasks (2 Large, 4 Medium, 3 Small)

---

### Phase 2: Core Features - Note Duration & Expression (Week 2-3)
**Goal:** Implement the primary visual feature - note duration visualization with blue/amber LED emitters.

| Task ID | Title | Effort |
|---------|-------|--------|
| EXPR-001 | Implement expression-only row detection | Medium |
| DURA-001 | Implement note duration calculation | Large |
| DURA-002 | Add noteDuration field to packed cell struct | Medium |
| DURA-003 | Add isSustained boolean to row data | Medium |
| DURA-004 | Implement blue LED emitter for note triggers | Medium |
| SHADER-007 | Add amber emitter for expression-only steps | Medium |
| SHADER-008 | Implement note duration "tail" rendering | Large |
| SHADER-009 | Add fade effect on note sustain tail | Medium |
| DURA-005 | Tie glow intensity to volume/expression | Medium |
| DURA-006 | Add current row pulse on note trigger | Small |
| SHADER-016 | Implement multi-layer bloom passes | Large |

**Phase 2 Total:** 11 tasks (3 Large, 7 Medium, 1 Small)

---

### Phase 3: Visual Polish & UI/UX (Week 4)
**Goal:** Elevate the overall aesthetic with shader improvements and UI consistency.

| Task ID | Title | Effort |
|---------|-------|--------|
| SHADER-003 | Add chrome-like inner bevel to LED housing | Medium |
| SHADER-004 | Add grey glow to inactive cells | Small |
| SHADER-005 | Brighten royal blue note-on emitter | Small |
| SHADER-006 | Implement bottom emitter functionality | Medium |
| SHADER-010 | Add playhead scan line arc at 12-o'clock | Medium |
| SHADER-011 | Add channel labels to inner rings | Medium |
| SHADER-012 | Compensate inner ring cell size | Small |
| SHADER-013 | Add subsurface scattering | Medium |
| SHADER-014 | Add Fresnel rim lighting | Medium |
| UI-002 | Add drop shadow to white chassis | Small |
| UI-003 | Add dark chassis option toggle | Medium |
| UI-004 | Redesign header to dark full-bleed | Medium |
| UI-005 | Standardize button styling | Small |
| UI-006 | Make debug panel default to hidden | Small |
| UI-007 | Fix "TRACKER GPU-9000" label readability | Small |

**Phase 3 Total:** 15 tasks (0 Large, 9 Medium, 6 Small)

---

### Phase 4: Performance & Advanced Features (Week 5-6)
**Goal:** Optimize performance, add advanced rendering effects, and backend integration.

| Task ID | Title | Effort |
|---------|-------|--------|
| PERF-001 | Decouple render loop from React state | Medium |
| PERF-002 | Implement fractional row interpolation | Large |
| PERF-005 | Add memoization to pattern data packing | Medium |
| SHADER-015 | Add chromatic aberration post-processing | Medium |
| VISUAL-001 | Add CRT phosphor + scanlines | Medium |
| VISUAL-002 | Implement "Studio dimming" toggle | Small |
| VISUAL-003 | Add 3D LED extrusion fake bevel | Medium |
| UI-008 | Add version badge in footer | Small |
| UI-009 | Persist shader choice across refreshes | Small |
| UI-010 | Show current BPM/speed in top bar | Small |
| UI-011 | Add keyboard shortcuts | Medium |
| UI-012 | Add hover tooltips on pattern steps | Medium |
| UI-013 | Add export screenshot button | Small |
| BACKEND-001 | Add "Browse Library" button | Medium |
| BACKEND-003 | Add "Load random shader" from API | Small |
| BACKEND-005 | Add sync button for cloud library | Small |

**Phase 4 Total:** 16 tasks (1 Large, 8 Medium, 7 Small)

---

## Summary Statistics

| Category | Count | Small | Medium | Large |
|----------|-------|-------|--------|-------|
| Data & Buffer Management | 4 | 2 | 1 | 1 |
| Audio Engine | 4 | 1 | 2 | 1 |
| Shader & Rendering | 16 | 3 | 9 | 4 |
| UI/UX Polish | 15 | 9 | 6 | 0 |
| Note Duration & Expression | 7 | 1 | 5 | 1 |
| Visual Polish & Effects | 6 | 1 | 3 | 2 |
| Performance & Architecture | 10 | 4 | 3 | 3 |
| Backend Integration | 7 | 3 | 4 | 0 |
| Media Overlay | 3 | 1 | 2 | 0 |
| **TOTAL** | **72** | **25** | **35** | **12** |

---

## Priority Ranking (Top 10)

1. **DATA-001** - Fix 5-channel vs 4-channel buffer mismatch (BLOCKS other features)
2. **AUDIO-001** - Fix AudioWorklet loading failure (Core functionality)
3. **DURA-001** - Implement note duration calculation (Primary feature request)
4. **EXPR-001** - Implement expression-only row detection (Primary feature request)
5. **SHADER-001** - Fix PatternDisplay Mode showing "NONE" (UI bug)
6. **DATA-002** - Audit packPatternMatrixHighPrecision channel logic (Data integrity)
7. **AUDIO-002** - Add Vite dynamic import protection (Deployment stability)
8. **SHADER-008** - Implement note duration "tail" rendering (Visual feature)
9. **SHADER-007** - Add amber emitter for expression-only steps (Visual feature)
10. **UI-001** - Fix play button scroll anchor problem (UX issue)

---

## Dependency Graph (Key Chains)

```
DATA-001 (Buffer Fix)
├── DATA-002 (Audit)
├── DATA-003 (Overflow protection)
├── DATA-004 (Documentation)
├── EXPR-001 (Expression detection)
│   └── SHADER-007 (Amber emitter)
│       └── SHADER-016 (Multi-layer bloom)
└── DURA-001 (Duration calculation)
    ├── DURA-002 (Pack duration field)
    ├── DURA-003 (Pack sustained flag)
    └── DURA-004 (Blue LED emitter)
        ├── DURA-005 (Volume intensity)
        ├── DURA-006 (Row pulse)
        └── SHADER-008 (Tail rendering)
            ├── SHADER-009 (Fade effect)
            └── SHADER-016 (Multi-layer bloom)

AUDIO-001 (Worklet fix)
├── AUDIO-002 (Vite import)
├── AUDIO-003 (Button wiring)
└── AUDIO-004 (Diagnostics)

PERF-001 (Decouple render loop)
└── PERF-002 (Fractional interpolation)
```

---

*Document generated for project management tracking. Update task status as work progresses.*
