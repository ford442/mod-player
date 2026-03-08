# Example Agent Tasks for PatternDisplay Refinement

This document provides concrete, ready-to-use task prompts for each agent.

---

## Agent 1: Performance Optimization

### Task: Profile and Optimize Rendering

```
Analyze and optimize the PatternDisplay component for maximum rendering performance.

CURRENT ISSUES:
- Frame drops during pattern scrolling
- High CPU usage during playback
- Stuttering when switching shaders

STEPS TO TAKE:

1. **Profile the Current Implementation**
   Read: /mnt/okcomputer/mod-player-main/components/PatternDisplay.tsx
   
   Identify bottlenecks:
   - How many render passes per frame?
   - How often are buffers being updated?
   - Is there unnecessary GPU readback?
   - Are we creating too many objects per frame?

2. **Optimize Render Passes**
   - Combine multiple passes where possible
   - Use render bundles for static geometry
   - Implement proper clear/load operations

3. **Optimize Buffer Management**
   - Use triple buffering for uniforms
   - Pool GPU buffers
   - Minimize buffer uploads

4. **Add Performance Monitoring**
   - Add GPU timestamp queries
   - Create performance overlay (optional)
   - Log frame times to console in debug mode

5. **Test and Verify**
   - Ensure 60fps at 1080p
   - Verify no visual regressions
   - Test on different GPUs

OUTPUT:
Create: /mnt/okcomputer/output/PatternDisplay.optimized.tsx

REQUIREMENTS:
- Frame time < 16ms at 1080p
- No visual quality loss
- Maintain all existing functionality
- Add performance profiling capability
```

### Task: Reduce Memory Allocations

```
Reduce JavaScript memory allocations in the render loop to prevent GC pauses.

CURRENT ISSUES:
- GC pauses causing frame drops
- New objects created every frame
- TypedArrays being recreated

STEPS:

1. Identify all allocations in render loop
2. Move allocations outside loop where possible
3. Pool and reuse objects
4. Use object pooling for temporary calculations

OUTPUT:
Create: /mnt/okcomputer/output/PatternDisplay.optimized.tsx

TARGET:
- Zero allocations in hot path
- Smooth 60fps without GC pauses
```

---

## Agent 2: Visual Effects

### Task: Add Bloom Post-Processing

```
Add a bloom/glow effect to active notes in the pattern display.

REQUIREMENTS:
- Notes should glow when active
- Configurable bloom intensity
- Performance must remain at 60fps
- Should work with all shader versions

STEPS:

1. **Create Bloom Shader**
   - Create extract-bright.wgsl - extracts bright pixels
   - Create blur-horizontal.wgsl - horizontal Gaussian blur
   - Create blur-vertical.wgsl - vertical Gaussian blur
   - Create composite.wgsl - combines original + bloom

2. **Modify PatternDisplay**
   - Add bloom render targets
   - Create bloom pipeline
   - Add bloom intensity uniform
   - Composite bloom in final pass

3. **Add Controls**
   - Add bloom intensity slider (0-2)
   - Add bloom threshold slider (0-1)

4. **Optimize**
   - Use half-resolution for bloom
   - Limit blur taps for performance

OUTPUT:
Create shaders in: /mnt/okcomputer/output/shaders/bloom/
Create: /mnt/okcomputer/output/PatternDisplay.bloom.tsx

REFERENCE:
- Current shader: /mnt/okcomputer/mod-player-main/dist/shaders/patternv0.40.wgsl
- Current display: /mnt/okcomputer/mod-player-main/components/PatternDisplay.tsx
```

### Task: Create Retro CRT Effect

```
Add an optional retro CRT monitor effect to the pattern display.

EFFECTS TO INCLUDE:
- Scanlines
- Screen curvature
- Vignette
- Slight chromatic aberration
- Scanline jitter

STEPS:

1. Create CRT post-processing shader
2. Add toggle in UI
3. Make intensity configurable
4. Ensure it can be combined with other effects

OUTPUT:
Create: /mnt/okcomputer/output/shaders/post/crt.wgsl
Modify: /mnt/okcomputer/output/PatternDisplay.tsx (add CRT option)
```

---

## Agent 3: UI/UX Improvements

### Task: Add Touch Support

```
Add full touch support to the PatternDisplay for mobile devices.

CURRENT STATE:
- Only mouse events are handled
- No touch gestures
- Buttons too small for touch

REQUIREMENTS:
- Touch events for all interactive elements
- Pinch-to-zoom for pattern
- Swipe for navigation
- Touch-friendly button sizes (min 44px)

STEPS:

1. **Add Touch Event Handlers**
   - onTouchStart
   - onTouchMove
   - onTouchEnd
   - Handle multi-touch for pinch

2. **Implement Gestures**
   - Tap: same as click
   - Double-tap: toggle play/pause
   - Pinch: zoom pattern view
   - Swipe left/right: next/prev pattern
   - Swipe up/down: volume/pan

3. **Resize Touch Targets**
   - All buttons minimum 44x44px
   - Add padding around small elements
   - Visual feedback on touch

4. **Prevent Scroll Conflicts**
   - Prevent page scroll when interacting
   - Handle touch-action CSS

5. **Test**
   - Test on iOS Safari
   - Test on Android Chrome
   - Test with stylus

OUTPUT:
Create: /mnt/okcomputer/output/PatternDisplay.touch.tsx
```

### Task: Improve Button Feedback

```
Add better visual feedback for all interactive buttons.

REQUIREMENTS:
- Hover states
- Active/pressed states
- Disabled states
- Loading states
- Smooth transitions

STEPS:

1. Create button state animations
2. Add CSS transitions
3. Implement haptic feedback (if available)
4. Add sound feedback (optional)

OUTPUT:
Update: /mnt/okcomputer/output/PatternDisplay.tsx
```

---

## Agent 4: Architecture Refactoring

### Task: Extract Custom Hooks

```
Refactor PatternDisplay.tsx by extracting reusable custom hooks.

CURRENT PROBLEMS:
- Component is 1800+ lines
- Mixed concerns (rendering, input, WebGPU, WebGL)
- Hard to test
- Duplicated logic

HOOKS TO CREATE:

1. **useWebGPU**
   - Initialize WebGPU device
   - Handle device loss
   - Manage canvas context
   
2. **useShaderLoader**
   - Load WGSL shaders
   - Compile shader modules
   - Cache compiled shaders
   
3. **useBufferManager**
   - Create and manage GPU buffers
   - Handle buffer updates
   - Implement triple buffering
   
4. **useRenderLoop**
   - Manage requestAnimationFrame
   - Handle frame timing
   - Pause/resume rendering
   
5. **useInputHandler**
   - Handle mouse events
   - Handle touch events
   - Handle keyboard shortcuts
   - Coordinate transformations

6. **usePatternData**
   - Process pattern matrix
   - Pack data for GPU
   - Cache processed data

STEPS:

1. Create hooks directory
2. Extract each hook one at a time
3. Test each hook independently
4. Update PatternDisplay to use hooks
5. Verify no functionality lost

OUTPUT:
Create: /mnt/okcomputer/output/hooks/useWebGPU.ts
Create: /mnt/okcomputer/output/hooks/useShaderLoader.ts
Create: /mnt/okcomputer/output/hooks/useBufferManager.ts
Create: /mnt/okcomputer/output/hooks/useRenderLoop.ts
Create: /mnt/okcomputer/output/hooks/useInputHandler.ts
Create: /mnt/okcomputer/output/hooks/usePatternData.ts
Update: /mnt/okcomputer/output/PatternDisplay.refactored.tsx

TARGET:
- PatternDisplay < 400 lines
- Each hook < 200 lines
- Clear separation of concerns
- Easy to test
```

### Task: Split Into Sub-Components

```
Split the monolithic PatternDisplay into focused sub-components.

COMPONENTS TO CREATE:

1. **PatternGrid**
   - Renders the pattern cells
   - Handles cell interactions
   - Props: matrix, playheadRow, onCellClick

2. **ControlPanel**
   - Renders play/stop/loop buttons
   - Volume and pan sliders
   - Props: isPlaying, volume, pan, onPlay, onStop, etc.

3. **WebGPURenderer**
   - Manages WebGPU rendering
   - Handles shader switching
   - Props: shaderFile, uniforms, onRender

4. **WebGLOverlay**
   - Renders WebGL glass effects
   - Props: shaderFile, patternData

5. **DebugOverlay**
   - Shows debug information
   - Props: debugInfo, onToggle

STEPS:

1. Create components directory
2. Extract each component
3. Define clear props interfaces
4. Add component tests
5. Compose in PatternDisplay

OUTPUT:
Create: /mnt/okcomputer/output/components/PatternGrid.tsx
Create: /mnt/okcomputer/output/components/ControlPanel.tsx
Create: /mnt/okcomputer/output/components/WebGPURenderer.tsx
Create: /mnt/okcomputer/output/components/WebGLOverlay.tsx
Create: /mnt/okcomputer/output/components/DebugOverlay.tsx
Update: /mnt/okcomputer/output/PatternDisplay.refactored.tsx
```

---

## Agent 5: Error Handling

### Task: Add Graceful Degradation

```
Add graceful degradation so PatternDisplay works even when WebGPU fails.

FALLBACK CHAIN:
1. WebGPU (preferred)
2. WebGL2 (fallback)
3. Canvas2D (basic)
4. HTML/CSS (minimal)

STEPS:

1. **Detect Support**
   - Check for WebGPU
   - Check for WebGL2
   - Check for Canvas2D

2. **Create Fallback Renderers**
   - WebGL2Renderer - uses WebGL2 instead of WebGPU
   - Canvas2DRenderer - 2D canvas rendering
   - HTMLRenderer - DOM-based rendering

3. **Auto-Select Renderer**
   - Try WebGPU first
   - Fall back to WebGL2 on failure
   - Fall back to Canvas2D
   - Use HTML as last resort

4. **Handle Runtime Failures**
   - Detect GPU device loss
   - Auto-recover if possible
   - Switch to fallback if needed

5. **User Feedback**
   - Show current renderer mode
   - Explain limitations of fallback
   - Offer to retry WebGPU

OUTPUT:
Create: /mnt/okcomputer/output/renderers/WebGL2Renderer.ts
Create: /mnt/okcomputer/output/renderers/Canvas2DRenderer.ts
Create: /mnt/okcomputer/output/renderers/HTMLRenderer.ts
Update: /mnt/okcomputer/output/PatternDisplay.resilient.tsx
```

### Task: Add Error Boundaries

```
Add React error boundaries to prevent crashes.

STEPS:

1. Create PatternDisplayErrorBoundary
2. Catch rendering errors
3. Show user-friendly error message
4. Provide retry button
5. Log errors for debugging

OUTPUT:
Create: /mnt/okcomputer/output/components/PatternDisplayErrorBoundary.tsx
Update: /mnt/okcomputer/output/PatternDisplay.resilient.tsx
```

---

## Agent 6: Responsive Design

### Task: Implement Mobile Layout

```
Create a mobile-optimized layout for PatternDisplay.

REQUIREMENTS:
- Works in portrait and landscape
- Touch-friendly controls
- Collapsible panels
- Bottom sheet for controls

BREAKPOINTS:
- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

STEPS:

1. **Create Responsive Layout**
   - Use CSS Grid/Flexbox
   - Media queries for breakpoints
   - Container queries where appropriate

2. **Mobile-Specific UI**
   - Bottom sheet for controls
   - Floating action button for play
   - Swipe gestures
   - Simplified metadata display

3. **Touch Optimization**
   - Larger hit targets
   - Touch feedback
   - Prevent accidental touches

4. **Test**
   - iPhone SE (small)
   - iPhone Pro Max (large)
   - iPad (tablet)
   - Desktop

OUTPUT:
Create: /mnt/okcomputer/output/PatternDisplay.responsive.tsx
Create: /mnt/okcomputer/output/styles/responsive.css
```

---

## Agent 7: Feature Enhancement

### Task: Add Waveform Visualization

```
Add a real-time waveform visualization to the pattern display.

FEATURES:
- Show audio waveform overlay
- Color-coded by channel
- Sync with playback
- Configurable opacity

STEPS:

1. **Create Waveform Shader**
   - Sample audio data
   - Render as oscilloscope
   - Add color per channel

2. **Audio Analysis**
   - Use AnalyserNode
   - Get time-domain data
   - Pass to shader

3. **Integration**
   - Add toggle button
   - Configurable opacity
   - Position overlay

4. **Performance**
   - Update at 30fps (not 60)
   - Use efficient data transfer

OUTPUT:
Create: /mnt/okcomputer/output/shaders/waveform.wgsl
Update: /mnt/okcomputer/output/PatternDisplay.enhanced.tsx
```

### Task: Add Screenshot Export

```
Add ability to capture and export screenshots of the pattern display.

FEATURES:
- Capture current frame
- Save as PNG/JPEG
- Copy to clipboard
- Share functionality

STEPS:

1. **Capture Frame**
   - Read canvas pixels
   - Encode as image
   
2. **Export Options**
   - Download as file
   - Copy to clipboard
   - Share API (mobile)

3. **UI Integration**
   - Add screenshot button
   - Format/quality options
   - Success feedback

OUTPUT:
Create: /mnt/okcomputer/output/utils/screenshot.ts
Update: /mnt/okcomputer/output/PatternDisplay.enhanced.tsx
```

---

## Agent 8: Accessibility

### Task: Add Keyboard Navigation

```
Add full keyboard navigation to PatternDisplay.

REQUIREMENTS:
- Tab through all controls
- Arrow keys for navigation
- Space/Enter to activate
- Keyboard shortcuts for common actions

KEYBOARD SHORTCUTS:
- Space: Play/Pause
- S: Stop
- L: Toggle loop
- O: Open file
- Arrow Left/Right: Seek
- Arrow Up/Down: Volume
- 1-9: Select channel
- F: Fullscreen
- D: Toggle debug

STEPS:

1. **Add Tab Navigation**
   - tabindex attributes
   - Focus indicators
   - Logical tab order

2. **Add Keyboard Handlers**
   - Global keydown listener
   - Prevent default where needed
   - Handle modifier keys

3. **Focus Management**
   - Visible focus indicators
   - Focus traps where appropriate
   - Restore focus after actions

4. **Documentation**
   - Keyboard shortcut overlay
   - Help dialog

OUTPUT:
Update: /mnt/okcomputer/output/PatternDisplay.a11y.tsx
Create: /mnt/okcomputer/output/components/KeyboardShortcuts.tsx
```

### Task: Add Screen Reader Support

```
Add full screen reader support to PatternDisplay.

REQUIREMENTS:
- All controls have labels
- Live regions for updates
- Pattern data in accessible format
- ARIA attributes

STEPS:

1. **Add ARIA Attributes**
   - aria-label for buttons
   - aria-pressed for toggles
   - aria-live for updates
   - aria-describedby for help

2. **Create Live Regions**
   - Playback status updates
   - Error messages
   - Loading states

3. **Accessible Pattern Data**
   - Table representation
   - Screen reader only text
   - Row/column headers

4. **Test**
   - NVDA (Windows)
   - JAWS (Windows)
   - VoiceOver (macOS/iOS)
   - TalkBack (Android)

OUTPUT:
Update: /mnt/okcomputer/output/PatternDisplay.a11y.tsx
```

---

## Agent 9: Shader Debugging

### Task: Implement Shader Hot-Reload

```
Add shader hot-reload for faster shader development.

FEATURES:
- Watch shader files for changes
- Auto-recompile on change
- Preserve state across reload
- Show compile errors inline

STEPS:

1. **File Watching**
   - Use Fetch API with cache-busting
   - Poll for changes in dev mode
   - Compare file timestamps

2. **Hot Reload Logic**
   - Recompile shader module
   - Recreate pipeline
   - Preserve uniform values
   - Log reload events

3. **Error Display**
   - Show compile errors in overlay
   - Highlight error location
   - Keep previous working shader

4. **Performance**
   - Debounce file checks
   - Only reload changed shaders

OUTPUT:
Create: /mnt/okcomputer/output/hooks/useShaderHotReload.ts
Update: /mnt/okcomputer/output/PatternDisplay.debug.tsx
```

### Task: Add Debug Overlay

```
Add a comprehensive debug overlay for development.

FEATURES TO SHOW:
- FPS counter
- Frame time graph
- GPU memory usage
- Draw call count
- Shader info
- Uniform values
- Texture list

STEPS:

1. Create DebugOverlay component
2. Add performance metrics
3. Show GPU information
4. Make toggleable (F12 or button)
5. Style as semi-transparent overlay

OUTPUT:
Create: /mnt/okcomputer/output/components/DebugOverlay.tsx
Update: /mnt/okcomputer/output/PatternDisplay.debug.tsx
```

---

## Agent 10: Documentation

### Task: Create API Documentation

```
Create comprehensive API documentation for PatternDisplay.

SECTIONS:

1. **Props Reference**
   - All props with types
   - Required vs optional
   - Default values
   - Examples

2. **Events/Callbacks**
   - onPlay, onStop, etc.
   - Event object shapes
   - Usage examples

3. **Configuration**
   - Shader options
   - Layout options
   - Performance options

4. **Type Definitions**
   - PatternMatrix
   - ChannelShadowState
   - All exported types

5. **Examples**
   - Basic usage
   - Custom shaders
   - Event handling

OUTPUT:
Create: /mnt/okcomputer/output/docs/API.md
```

### Task: Create Usage Examples

```
Create working examples showing different use cases.

EXAMPLES TO CREATE:

1. **Basic Usage**
   - Minimal setup
   - Default configuration

2. **Custom Theme**
   - Custom colors
   - Custom shaders

3. **Event Handling**
   - Handling play/stop
   - Custom controls

4. **Performance Mode**
   - Optimized for low-end
   - Reduced effects

5. **Full Featured**
   - All options enabled
   - Custom integration

OUTPUT:
Create: /mnt/okcomputer/output/examples/basic.tsx
Create: /mnt/okcomputer/output/examples/custom-theme.tsx
Create: /mnt/okcomputer/output/examples/event-handling.tsx
Create: /mnt/okcomputer/output/examples/performance-mode.tsx
Create: /mnt/okcomputer/output/examples/full-featured.tsx
```

---

## Running These Tasks

To run any of these tasks:

1. **Copy the task prompt**
2. **Create the agent** with appropriate system prompt
3. **Run the task** with the prompt
4. **Review the output**
5. **Test the result**

Example:
```bash
# Read current implementation
cat /mnt/okcomputer/mod-player-main/components/PatternDisplay.tsx

# Run the agent task
# (Use the task prompt from above)

# Review output
ls -la /mnt/okcomputer/output/

# Test
npm run dev
```

---

**Pick a task and start improving!** 🚀
