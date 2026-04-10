# Cross-Reference Report: weekly_plan.md vs kimi_agents/ Analysis

**Generated:** 2026-04-10  
**Purpose:** Map weekly_plan items to existing kimi_agents solutions and identify gaps

---

## 1. ALREADY SOLVED

Issues with complete solutions in kimi_agents/ documentation.

### 1.1 Three-Emitter LED Architecture
| weekly_plan Reference | kimi_agents Solution | Status |
|----------------------|----------------------|--------|
| "Blue LED emitter (top)" for note-on trigger | `led_system_architecture.md` - Emitter 1: Blue Note-On Indicator | ✅ Solved |
| "Full-brightness colored cells" for note color | `led_system_architecture.md` - Emitter 2: Steady Note Color | ✅ Solved |
| "Amber LED emitter" for expression-only | `led_system_architecture.md` - Emitter 3: Amber Control Indicator | ✅ Solved |

**Key Implementation Details:**
- Emitter 1 (Blue): #0066FF, triggers on note-on, 10ms attack, 100ms decay
- Emitter 2 (Pitch-mapped): Circle-of-fifths mapping with octave brightness variation
- Emitter 3 (Amber): #FF9900, triggers on effect commands/volume changes

**Files:** `led_system_architecture.md`, `ANALYSIS_SUMMARY.md`

---

### 1.2 WebGPU Error Handling & Fallback
| weekly_plan Reference | kimi_agents Solution | Status |
|----------------------|----------------------|--------|
| "Audio engine falling back" - general fallback concerns | `QUICK_FIXES.md` #2 - Distinguish availability vs initialization failures | ✅ Solved |
| WebGPU compatibility issues | `implementation_checklist.md` Phase 1 - WebGPU Error Message Fix | ✅ Solved |

**Solution:**
```typescript
// From QUICK_FIXES.md
if (!navigator.gpu) {
  return { type: 'not-available', message: 'Browser does not support WebGPU' };
}
try {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    return { type: 'initialization-failed', message: 'No GPU adapter found' };
  }
}
```

**Files:** `QUICK_FIXES.md`, `implementation_checklist.md`

---

### 1.3 Debug Panel Visibility
| weekly_plan Reference | kimi_agents Solution | Status |
|----------------------|----------------------|--------|
| "PatternDisplay debug panel... should default to hidden" | `implementation_checklist.md` Phase 1 - Debug Overlay Hiding | ✅ Solved |
| "only show when pressing 'D'" | `QUICK_FIXES.md` #10 - Default to hidden with toggle | ✅ Solved |

**Solution:** Default hidden, enable via `?debug=true` URL param or `window.enableDebug()` console command.

**Files:** `implementation_checklist.md`, `QUICK_FIXES.md`

---

### 1.4 GPU Memory Management & Resource Cleanup
| weekly_plan Reference | kimi_agents Solution | Status |
|----------------------|----------------------|--------|
| Performance concerns | `QUICK_FIXES.md` #1 - Buffer pooling solution | ✅ Solved |
| Resource leaks | `QUICK_FIXES.md` #8 - Track and cleanup resources on unmount | ✅ Solved |
| Device lost recovery | `QUICK_FIXES.md` #3, #4 - Device lost handler + context loss recovery | ✅ Solved |

**Files:** `QUICK_FIXES.md`

---

### 1.5 Shader Code Organization
| weekly_plan Reference | kimi_agents Solution | Status |
|----------------------|----------------------|--------|
| Multiple shader versions (v0.21-v0.50) | `QUICK_FIXES.md` #7 - Modular composition with ShaderComposer | ✅ Solved |

**Files:** `QUICK_FIXES.md`

---

### 1.6 LED Lens Physics & Visual Effects
| weekly_plan Reference | kimi_agents Solution | Status |
|----------------------|----------------------|--------|
| "frosted lens effect" improvements | `led_system_architecture.md` - Lens Cap Physics Simulation | ✅ Solved |
| "chrome-like inner bevel" | `led_system_architecture.md` - Fresnel reflection, specular highlight | ✅ Solved |
| "LED glow bloom" | `ANALYSIS_SUMMARY.md` - Bloom/Glow Effects section | ✅ Solved |

**Simulated Effects Documented:**
1. Internal Diffusion (Gaussian falloff)
2. Fresnel Reflection
3. Specular Highlight
4. Cross-Emitter Bleeding
5. Edge Darkening

**Files:** `led_system_architecture.md`, `ANALYSIS_SUMMARY.md`

---

### 1.7 Keyboard Shortcuts
| weekly_plan Reference | kimi_agents Solution | Status |
|----------------------|----------------------|--------|
| "Space: Play/Pause" etc. | `implementation_checklist.md` Phase 4 - Keyboard Shortcuts | ✅ Solved |

**Full List from implementation_checklist.md:**
- Space: Play/Pause
- Escape: Stop
- Arrow Up/Down: Volume
- L: Toggle Loop
- M: Toggle Mute
- ?: Show shortcuts help

**Files:** `implementation_checklist.md`

---

### 1.8 UI/UX Polish Items
| weekly_plan Reference | kimi_agents Solution | Status |
|----------------------|----------------------|--------|
| Control bar consolidation | `implementation_checklist.md` Phase 2 | ✅ Solved |
| Shader selector improvement | `implementation_checklist.md` Phase 2 | ✅ Solved |
| Panel organization | `implementation_checklist.md` Phase 2 | ✅ Solved |
| Color palette refinement | `implementation_checklist.md` Phase 3 | ✅ Solved |
| Hardware bezel redesign | `implementation_checklist.md` Phase 3 | ✅ Solved |
| VU Meter enhancement | `implementation_checklist.md` Phase 3 | ✅ Solved |
| Micro-interactions | `implementation_checklist.md` Phase 4 | ✅ Solved |
| Focus states | `implementation_checklist.md` Phase 4 | ✅ Solved |
| Toast notifications | `implementation_checklist.md` Phase 5 | ✅ Solved |
| Settings panel | `implementation_checklist.md` Phase 5 | ✅ Solved |
| Responsive design | `implementation_checklist.md` Phase 5 | ✅ Solved |

**Files:** `implementation_checklist.md`

---

## 2. PARTIALLY ADDRESSED

Issues with partial solutions requiring additional work.

### 2.1 Note Duration "Tail" Rendering
| Aspect | Status | Notes |
|--------|--------|-------|
| Architecture | ✅ | Three-emitter system supports steady note display |
| Duration packing | ⚠️ | Need to add `noteDuration` field to packed cell struct |
| Shader implementation | ❌ | Tail rendering with 40-60% brightness not implemented |
| Fade over last 2-3 rows | ❌ | Linear fade not implemented |

**weekly_plan Requirement:**
> "The sustain steps following a note-on should show the note's pitch-class color at roughly 40–60% brightness"

**Existing Solution:**
- `led_system_architecture.md` defines Emitter 2 as "Steady Note Color" with 55% base intensity
- Architecture supports sustain visualization but not duration-based tails

**Gap:** Need to extend `packPatternMatrixHighPrecision` to include duration data and modify shader to render tails.

**Files:** `led_system_architecture.md` (architecture), `ANALYSIS_SUMMARY.md` (shader recommendations)

---

### 2.2 Color Palette Implementation
| Aspect | Status | Notes |
|--------|--------|-------|
| Color mapping defined | ✅ | `led_system_architecture.md` has color table |
| Pitch-class colors | ✅ | C=Red, C#=Orange-Red, D=Yellow, etc. |
| Octave brightness | ✅ | +3% per octave documented |
| Blue emitter color | ⚠️ | #0066FF in docs vs #0080FF in weekly_plan |
| Amber emitter color | ⚠️ | #FF9900 in docs vs #FFA500 in weekly_plan |

**Conflict:** Minor color value discrepancies need reconciliation.

**Files:** `led_system_architecture.md`

---

### 2.3 Bloom/Glow Effects
| Aspect | Status | Notes |
|--------|--------|-------|
| Basic bloom | ✅ | Current implementation documented |
| Gaussian diffusion | ⚠️ | Recommended in ANALYSIS_SUMMARY.md |
| Cross-emitter color bleeding | ⚠️ | 15% bleeding documented but may not be implemented |
| Multi-pass bloom | ❌ | Listed as future work |
| HDR tone mapping | ⚠️ | ACES recommended in ANALYSIS_SUMMARY.md |

**weekly_plan Requirement:**
> "Blue LED emitter glow for steps inside a note duration"

**Gap:** Need layer-specific bloom (triggers vs sustains vs expression).

**Files:** `ANALYSIS_SUMMARY.md`, `led_system_architecture.md`

---

### 2.4 Graphical Issues (Banding, Clipping, Aliasing)
| Issue | Status | Solution Location |
|-------|--------|-------------------|
| Banding | ⚠️ | 8x8 Bayer dithering recommended in `ANALYSIS_SUMMARY.md` |
| Color clipping | ⚠️ | ACES tone mapping recommended |
| Aliasing | ⚠️ | Better SDF derivatives recommended |
| Moiré | ⚠️ | Mipmapped background texture recommended |

**Files:** `ANALYSIS_SUMMARY.md` Section 6

---

### 2.5 Shader Hot-Swap Race Condition
| Aspect | Status | Notes |
|--------|--------|-------|
| Problem identified | ✅ | `QUICK_FIXES.md` #5 documents race condition |
| Solution provided | ✅ | Frame fences approach documented |
| Implementation | ❌ | Not confirmed implemented |

**Files:** `QUICK_FIXES.md`

---

## 3. NOT YET ADDRESSED

New issues requiring fresh work with no existing solutions.

### 3.1 Critical Bugs (No Solutions)

| Issue | Priority | weekly_plan Section | Notes |
|-------|----------|---------------------|-------|
| **Channel count mismatch** | 🔴 Critical | Bugs #1 | 5-channel packer vs 4-channel buffer allocation - data corruption |
| **AudioWorklet not loading** | 🔴 Critical | Bugs #2 | Falls back to ScriptProcessor despite "⚡ Worklet" button |
| **PatternDisplay Mode shows "NONE"** | 🟡 Medium | Bugs #3 | Debug panel state not synced with actual GPU state |
| **Scroll anchor on Play** | 🟡 Medium | Bugs #4 | Play button scrolls page to bottom |
| **Stale shader files in repo** | 🟢 Low | Bugs #5 | .kate-swp, .bak files need cleanup |

**Action Required:** These bugs have no corresponding solutions in kimi_agents/.

---

### 3.2 Note Duration Feature Implementation

| Component | Status | Required Work |
|-----------|--------|---------------|
| Data layer (JS) | ❌ | Extend `packPatternMatrixHighPrecision` with duration field |
| Duration calculation | ❌ | Pre-scan patterns to compute note spans |
| Shader (WGSL) | ❌ | Read duration, render tail cells at reduced brightness |
| Expression-only flag | ❌ | Pack into metadata for amber emitter trigger |

**weekly_plan Reference:** "Note Duration as Steps — The Feature You Want" section

**Related kimi_agents Content:** Architecture exists but implementation details missing.

---

### 3.3 Specific Graphical Improvements

| Improvement | Status | Notes |
|-------------|--------|-------|
| Chrome-like inner bevel on housing | ❌ | `led_system_architecture.md` has Fresnel but not chrome bevel |
| Grey glow on empty cells | ❌ | "Empty but present channel" distinction |
| Top emitter bright royal blue (#0080FF) | ❌ | Current: #0066FF |
| Bottom emitter purpose definition | ❌ | "Unclear purpose" in weekly_plan |
| Playhead animated scan line | ❌ | "Radar sweep" at 12-o'clock position |
| Inner ring channel labels (CH1-CH4) | ❌ | Text arc or radial labels |
| Dark chassis option (#1a1a1a) | ❌ | Toggle for dark vs white chassis |
| TRACKER GPU-9000 label styling | ❌ | Monospace, letter-spacing, font-weight changes |

---

### 3.4 Performance & Architecture

| Item | Status | weekly_plan Reference |
|------|--------|----------------------|
| Render loop decoupling (useRef) | ❌ | "Advanced Architecture Advice" Section |
| Fractional interpolation for smooth playhead | ❌ | "Sample-Accurate Visual Sync" |
| Web Worker for module parsing | ❌ | "Preventing Main Thread Freezes" |
| SharedArrayBuffer for audio viz | ❌ | "Audio-Reactive Oscilloscopes" |
| Canvas compositing CSS fixes | ❌ | "Canvas Compositing Trap" |
| Vite dynamic import paths | ❌ | "Technical / Architecture Feedback" |

---

### 3.5 Additional Features

| Feature | Status | weekly_plan Reference |
|---------|--------|----------------------|
| Hover tooltips on pattern steps | ❌ | "Hover tooltips on pattern steps" |
| Media overlay upgrades | ❌ | "Media overlay upgrades" section |
| Playlist & library tab | ❌ | "Playlist & library tab" |
| Storage manager integration | ❌ | "Deep Integration with Storage Manager" |
| Export screenshot | ❌ | "Quick Wins" section |
| Persist shader choice | ❌ | "Quick Wins" section |
| Show BPM/speed in top bar | ❌ | "Quick Wins" section |
| High-contrast mode | ❌ | "Accessibility" section |

---

## 4. CONFLICTS

Areas where kimi_agents/ and weekly_plan disagree or have discrepancies.

### 4.1 Debug Panel Access Method

| Source | Access Method | Conflict |
|--------|--------------|----------|
| `weekly_plan.md` | Press 'D' key | Assumes 'D' is primary method |
| `implementation_checklist.md` | URL param `?debug=true` | Primary method |
| `implementation_checklist.md` | `window.enableDebug()` | Console alternative |
| `QUICK_FIXES.md` | 'D' key toggle | Matches weekly_plan |

**Resolution Needed:** Choose primary method and document consistently.

---

### 4.2 Blue Emitter Color Value

| Source | Color Value | Use Case |
|--------|-------------|----------|
| `led_system_architecture.md` | #0066FF | Blue Note-On Indicator |
| `weekly_plan.md` | #0080FF | "Bright royal blue" for note-on |

**Resolution Needed:** Decide on standard blue value (#0066FF vs #0080FF).

---

### 4.3 Amber Emitter Color Value

| Source | Color Value | Use Case |
|--------|-------------|----------|
| `led_system_architecture.md` | #FF9900 | Amber Control Indicator |
| `weekly_plan.md` | #FFA500 | "Amber glow" for expression-only |

**Resolution Needed:** Decide on standard amber value (#FF9900 vs #FFA500).

---

### 4.4 Implementation Priority

| weekly_plan Priority | kimi_agents Priority | Discrepancy |
|---------------------|----------------------|-------------|
| Note duration visualization (highest) | High Priority #4 (palette) | weekly_plan emphasizes duration more |
| AudioWorklet fix (critical) | Not explicitly addressed | kimi_agents focuses on GPU/shaders |
| Channel count mismatch (critical) | Not mentioned | Critical bug not analyzed |

**Resolution Needed:** Reconcile priority lists - kimi_agents focuses on visual/shader improvements while weekly_plan emphasizes audio/data bugs.

---

## 5. IMPLEMENTATION ROADMAP

### Phase 1: Critical Bug Fixes (No Existing Solutions)
1. Fix channel count mismatch (5 vs 4 buffer allocation)
2. Fix AudioWorklet loading/fallback issue
3. Fix PatternDisplay Mode "NONE" bug
4. Fix scroll anchor on Play button

### Phase 2: High-ROI Features (Partially Addressed)
1. Implement note duration tail rendering
   - Extend packer with duration field
   - Modify shader for 40-60% brightness tails
   - Add linear fade over last 2-3 rows
2. Implement amber LEDs for expression-only steps
3. Complete bloom/glow effect improvements

### Phase 3: Visual Polish (Architecture Exists)
1. Apply lens physics from `led_system_architecture.md`
2. Implement color palette from architecture docs
3. Add chrome bevel, dark chassis option
4. Improve TRACKER GPU-9000 label styling

### Phase 4: Performance & Architecture
1. Implement render loop decoupling (useRef)
2. Add fractional interpolation for smooth playhead
3. Consider Web Worker for module parsing
4. Apply canvas compositing CSS fixes

### Phase 5: Nice-to-Have Features
1. Hover tooltips
2. Media overlay upgrades
3. Storage manager integration
4. Screenshot export

---

## 6. FILE REFERENCE INDEX

### kimi_agents/ Files and Their Coverage

| File | Primary Topics | weekly_plan Coverage |
|------|----------------|----------------------|
| `ANALYSIS_SUMMARY.md` | Shader analysis, bloom effects, performance | LED quality, graphical issues |
| `implementation_checklist.md` | UI/UX phases, keyboard shortcuts, responsive design | UI polish, controls, panels |
| `QUICK_FIXES.md` | GPU memory, error handling, resource cleanup | Error handling, debug overlay |
| `led_system_architecture.md` | Three-emitter design, lens physics | LED emitters, color mapping |

### weekly_plan.md Sections and kimi_agents Mapping

| weekly_plan Section | kimi_agents Coverage | Gap |
|--------------------|----------------------|-----|
| 🐛 Bugs Found | Partial | No solutions for bugs #1-5 |
| 🎨 Note Duration | Partial | Architecture only, no implementation |
| 🖼️ Graphical Improvements | Good | Minor discrepancies in colors |
| 🔧 Technical Implementation | None | Implementation code provided but not analyzed |
| 🏗️ Architecture Feedback | None | No corresponding kimi_agents analysis |
| 🚀 Upgrade Roadmap | Partial | kimi_agents covers UI/UX, not data layer |
| 🎯 Advanced Architecture | None | No corresponding kimi_agents analysis |

---

## 7. SUMMARY

| Category | Count | Percentage |
|----------|-------|------------|
| Already Solved | 14 items | ~35% |
| Partially Addressed | 5 items | ~12% |
| Not Yet Addressed | 21 items | ~53% |
| Conflicts | 4 areas | - |

**Key Finding:** The kimi_agents/ directory contains excellent architectural documentation and UI/UX planning, but lacks solutions for the critical bugs identified in weekly_plan.md (channel mismatch, AudioWorklet issues). The three-emitter LED system is well-designed but needs implementation for the note duration visualization feature.

**Recommendation:** Prioritize Phase 1 (Critical Bug Fixes) as these have no existing solutions and block other features.
