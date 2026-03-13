# Agent Swarm Prompts for MOD Player PatternDisplay Refinement

This document contains a series of specialized agent prompts to further refine and improve the PatternDisplay component in the MOD player project.

---

## Agent 1: Performance Optimization Specialist

**Agent Name:** `perf_opt_agent`

**Task:** Optimize WebGPU rendering performance and reduce CPU/GPU overhead

**Prompt:**
```
You are a WebGPU performance optimization expert. Analyze and optimize the PatternDisplay.tsx component for maximum rendering performance.

Focus areas:
1. **Render Pass Optimization**
   - Minimize render pass count - can we combine passes?
   - Optimize clear operations
   - Reduce unnecessary GPU command encoding

2. **Buffer Management**
   - Implement triple buffering for uniform updates
   - Use GPU buffer mapping instead of writeBuffer where beneficial
   - Pool and reuse buffers to reduce allocations

3. **Instancing Efficiency**
   - Optimize instance count calculations
   - Use GPU culling for off-screen instances
   - Implement LOD (level of detail) for distant elements

4. **Texture Optimization**
   - Use texture atlases for button textures
   - Implement mipmapping for better performance at distance
   - Compress textures where possible

5. **CPU Overhead Reduction**
   - Move more calculations to GPU shaders
   - Reduce JavaScript object allocations in render loop
   - Use TypedArrays efficiently

6. **Profiling Integration**
   - Add GPU timestamp queries
   - Implement frame time monitoring
   - Add performance metrics overlay

Read the current PatternDisplay.tsx from /mnt/okcomputer/mod-player-main/components/PatternDisplay.tsx
Create optimized version at /mnt/okcomputer/output/PatternDisplay.optimized.tsx

Target: Maintain 60fps at 4K resolution with <16ms frame time.
```

---

## Agent 2: Visual Effects & Shader Enhancement

**Agent Name:** `vfx_shader_agent`

**Task:** Enhance visual quality with advanced shaders, lighting, and post-processing

**Prompt:**
```
You are a graphics programming expert specializing in WebGPU and WGSL. Enhance the visual quality of the PatternDisplay with advanced effects.

Focus areas:
1. **Advanced Lighting**
   - Add PBR (Physically Based Rendering) materials
   - Implement ambient occlusion for depth
   - Add specular highlights on buttons
   - Create realistic glass/frosted materials

2. **Post-Processing Effects**
   - Add bloom/glow effect for active notes
   - Implement chromatic aberration for retro feel
   - Add subtle vignette effect
   - Create scanline/crt effect option

3. **Animation Improvements**
   - Smooth note trigger animations with easing
   - Add button press animations
   - Create smooth playhead transitions
   - Add subtle idle animations

4. **Color Grading**
   - Implement color temperature adjustment
   - Add contrast/saturation controls
   - Create multiple color themes (amber, green, blue)
   - Add dimming/brightness controls

5. **Particle Effects**
   - Add note hit particles
   - Create subtle dust/floating particles
   - Add sparkle effects on active channels

6. **Shader Library**
   - Create reusable shader modules
   - Add compute shader for audio visualization
   - Implement waveform display shader

Create enhanced shaders in /mnt/okcomputer/output/shaders-enhanced/
Create enhanced PatternDisplay at /mnt/okcomputer/output/PatternDisplay.vfx.tsx

Target: Professional-grade visuals while maintaining 60fps.
```

---

## Agent 3: UI/UX Interaction Designer

**Agent Name:** `ui_ux_agent`

**Task:** Improve user interaction, controls, and visual feedback

**Prompt:**
```
You are a UI/UX designer and frontend developer. Improve the interaction design and user experience of the PatternDisplay component.

Focus areas:
1. **Control Improvements**
   - Add hover states to all interactive elements
   - Implement tooltips for buttons and controls
   - Add keyboard shortcut hints
   - Create better visual feedback for actions

2. **Touch Support**
   - Add touch event handling for mobile
   - Implement pinch-to-zoom for pattern view
   - Add swipe gestures for navigation
   - Create touch-friendly hit targets

3. **Visual Feedback**
   - Add button press animations
   - Create smooth transitions between states
   - Add loading/saving indicators
   - Implement toast notifications

4. **Context Menus**
   - Add right-click context menu
   - Implement quick actions (mute channel, solo, etc.)
   - Add copy/paste functionality

5. **Help System**
   - Add inline help tooltips
   - Create keyboard shortcut overlay
   - Add shader description tooltips

6. **State Visualization**
   - Better visualization of playback state
   - Add channel activity indicators
   - Improve loop indicator visibility
   - Add BPM visualization

Create improved version at /mnt/okcomputer/output/PatternDisplay.ui.tsx
Also create any new sub-components needed.

Target: Intuitive, responsive, and delightful user experience.
```

---

## Agent 4: Code Architecture & Refactoring

**Agent Name:** `arch_refactor_agent`

**Task:** Refactor code for better maintainability, testability, and organization

**Prompt:**
```
You are a software architect specializing in React and WebGPU applications. Refactor the PatternDisplay component for better code quality.

Focus areas:
1. **Component Decomposition**
   - Split monolithic component into smaller pieces
   - Create separate components: PatternGrid, ControlPanel, WebGLOverlay, WebGPURenderer
   - Extract custom hooks: useWebGPU, useWebGL, usePatternData

2. **State Management**
   - Implement proper state machine for playback
   - Use React Context for shared state where appropriate
   - Reduce prop drilling

3. **Hook Extraction**
   - Create useShaderLoader for shader management
   - Create useBufferManager for GPU buffers
   - Create useRenderLoop for animation frame management
   - Create useInputHandler for mouse/touch/keyboard

4. **Type Safety**
   - Add stricter TypeScript types
   - Create discriminated unions for shader types
   - Add runtime type validation

5. **Configuration System**
   - Create shader configuration objects
   - Implement feature flags for different capabilities
   - Add user preferences system

6. **Testing Infrastructure**
   - Make components testable
   - Add mock WebGPU/WebGL contexts
   - Create test utilities

Create refactored version at /mnt/okcomputer/output/PatternDisplay.refactored.tsx
Create new hooks in /mnt/okcomputer/output/hooks/
Create new components in /mnt/okcomputer/output/components/

Target: Clean, maintainable, well-documented code.
```

---

## Agent 5: Error Handling & Resilience

**Agent Name:** `error_resilience_agent`

**Task:** Improve error handling, recovery, and user feedback

**Prompt:**
```
You are a reliability engineer specializing in frontend error handling. Improve the error handling and recovery mechanisms in PatternDisplay.

Focus areas:
1. **Graceful Degradation**
   - Fallback to WebGL if WebGPU fails
   - Fallback to Canvas2D if WebGL fails
   - Show placeholder if all graphics fail

2. **Error Recovery**
   - Auto-recover from GPU device loss
   - Retry shader compilation on transient failures
   - Recover from audio context suspension

3. **User Feedback**
   - Add error boundary with user-friendly messages
   - Create error toast notifications
   - Add retry buttons for recoverable errors
   - Show diagnostic information in debug mode

4. **Validation**
   - Validate shader code before compilation
   - Check WebGPU feature support
   - Validate module file format
   - Add bounds checking for all inputs

5. **Logging**
   - Structured error logging
   - Add user feedback reporting
   - Create error analytics

6. **Recovery Strategies**
   - Shader hot-reload on error
   - Automatic quality reduction on performance issues
   - Memory pressure handling

Create improved version at /mnt/okcomputer/output/PatternDisplay.resilient.tsx
Create error components in /mnt/okcomputer/output/components/errors/

Target: Never crash, always provide feedback, automatic recovery where possible.
```

---

## Agent 6: Responsive & Adaptive Design

**Agent Name:** `responsive_agent`

**Task:** Improve responsive behavior across different screen sizes and orientations

**Prompt:**
```
You are a responsive design expert. Make the PatternDisplay work beautifully on all screen sizes.

Focus areas:
1. **Breakpoint System**
   - Define breakpoints: mobile (<768px), tablet (768-1024px), desktop (>1024px)
   - Adjust layout for each breakpoint
   - Scale UI elements appropriately

2. **Mobile Optimization**
   - Simplified mobile layout
   - Touch-optimized controls
   - Portrait/landscape handling
   - Bottom sheet for controls on mobile

3. **Aspect Ratio Handling**
   - Maintain pattern aspect ratio
   - Handle ultra-wide and ultra-tall displays
   - Add letterboxing when needed

4. **Font Scaling**
   - Responsive typography
   - Minimum readable sizes
   - High-contrast mode support

5. **Layout Adaptations**
   - Collapsible side panels on small screens
   - Fullscreen mode optimization
   - Picture-in-picture support

6. **Performance Adaptations**
   - Reduce quality on low-end devices
   - Disable effects on battery saving mode
   - Adaptive frame rate

Create responsive version at /mnt/okcomputer/output/PatternDisplay.responsive.tsx
Create CSS modules in /mnt/okcomputer/output/styles/

Target: Perfect experience from mobile to 4K desktop.
```

---

## Agent 7: Feature Enhancement & New Modes

**Agent Name:** `feature_enhance_agent`

**Task:** Add new visualization modes and advanced features

**Prompt:**
```
You are a creative developer specializing in music visualization. Add exciting new features to the PatternDisplay.

Focus areas:
1. **New Visualization Modes**
   - Waveform display (oscilloscope style)
   - Spectrum analyzer visualization
   - 3D pattern view (perspective projection)
   - Piano roll view
   - Mini-map/overview mode

2. **Audio-Reactive Effects**
   - Real-time frequency analysis display
   - Beat detection visualization
   - Channel correlation display
   - Dynamic lighting based on audio

3. **Pattern Editing Features**
   - Visual pattern editor
   - Step sequencer interface
   - Live recording visualization
   - Effect parameter visualization

4. **Export Features**
   - Screenshot capture
   - Video recording of visualization
   - GIF export
   - Share functionality

5. **Customization**
   - User-defined color schemes
   - Custom shader loading
   - Layout customization
   - Preset system

6. **Integration Features**
   - MIDI visualization
   - External controller support
   - OSC integration
   - DAW plugin mode

Create enhanced version at /mnt/okcomputer/output/PatternDisplay.enhanced.tsx
Create new shaders in /mnt/okcomputer/output/shaders-features/

Target: Feature-rich, professional music production tool.
```

---

## Agent 8: Accessibility Specialist

**Agent Name:** `a11y_agent`

**Task:** Improve accessibility for users with disabilities

**Prompt:**
```
You are an accessibility (a11y) specialist. Make the PatternDisplay usable by everyone.

Focus areas:
1. **Keyboard Navigation**
   - Full keyboard control (Tab, Enter, Arrow keys, Space)
   - Keyboard shortcuts for all actions
   - Focus indicators
   - Skip navigation links

2. **Screen Reader Support**
   - ARIA labels for all controls
   - Live regions for playback updates
   - Pattern data in accessible format
   - Alternative text descriptions

3. **Visual Accessibility**
   - High contrast mode
   - Color blindness friendly palettes
   - Adjustable text sizes
   - Focus mode (reduce distractions)

4. **Motion Preferences**
   - Respect prefers-reduced-motion
   - Disable animations option
   - Static alternatives for animated content

5. **Cognitive Accessibility**
   - Clear, simple language
   - Consistent navigation
   - Error prevention
   - Help system

6. **Testing**
   - Keyboard navigation testing
   - Screen reader testing
   - Color contrast validation
   - WCAG 2.1 AA compliance

Create accessible version at /mnt/okcomputer/output/PatternDisplay.a11y.tsx
Create accessibility hooks in /mnt/okcomputer/output/hooks/a11y/

Target: WCAG 2.1 AA compliant, usable with keyboard-only and screen readers.
```

---

## Agent 9: Shader Debugging & Development Tools

**Agent Name:** `shader_debug_agent`

**Task:** Create debugging and development tools for shader work

**Prompt:**
```
You are a graphics debugging expert. Create tools to make shader development easier.

Focus areas:
1. **Shader Hot-Reload**
   - Watch shader files for changes
   - Auto-recompile on change
   - Preserve state across reloads
   - Error overlay for compile failures

2. **Debug Visualization**
   - Wireframe mode
   - Show UV coordinates
   - Display normals/tangents
   - Show bounding boxes

3. **Performance Profiling**
   - GPU time per pass
   - Draw call counter
   - Memory usage display
   - Frame time graph

4. **Uniform Inspector**
   - Real-time uniform editing
   - Slider controls for float uniforms
   - Color pickers for vec3 uniforms
   - Save/load uniform presets

5. **Texture Inspector**
   - View all loaded textures
   - Texture memory usage
   - Mip level visualization
   - Format information

6. **Capture Tools**
   - Frame capture
   - GPU command buffer inspection
   - Render target visualization
   - Export capture for analysis

Create debug tools at /mnt/okcomputer/output/debug/
Integrate into PatternDisplay at /mnt/okcomputer/output/PatternDisplay.debug.tsx

Target: Professional-grade shader debugging experience.
```

---

## Agent 10: Documentation & Examples

**Agent Name:** `docs_examples_agent`

**Task:** Create comprehensive documentation and usage examples

**Prompt:**
```
You are a technical writer and developer advocate. Create documentation and examples for the PatternDisplay component.

Focus areas:
1. **API Documentation**
   - Complete props documentation
   - Event handlers
   - Configuration options
   - Type definitions

2. **Usage Examples**
   - Basic usage example
   - Custom shader example
   - Theming example
   - Integration examples (React, Vue, etc.)

3. **Shader Development Guide**
   - WGSL basics for the project
   - Uniform layout specification
   - Adding new shaders
   - Shader debugging tips

4. **Architecture Documentation**
   - Component architecture
   - Data flow diagrams
   - WebGPU resource management
   - Performance considerations

5. **Troubleshooting Guide**
   - Common issues and solutions
   - Browser compatibility
   - Performance optimization
   - Error messages explained

6. **Changelog & Migration**
   - Version history
   - Breaking changes
   - Migration guides

Create documentation at /mnt/okcomputer/output/docs/
Create examples at /mnt/okcomputer/output/examples/

Target: Complete documentation for developers and users.
```

---

## Execution Order

Recommended order for running these agents:

1. **Agent 4 (Architecture)** - Establish clean foundation first
2. **Agent 1 (Performance)** - Optimize the architecture
3. **Agent 2 (Visual Effects)** - Add visual polish
4. **Agent 3 (UI/UX)** - Improve interactions
5. **Agent 5 (Error Handling)** - Add resilience
6. **Agent 6 (Responsive)** - Ensure works everywhere
7. **Agent 7 (Features)** - Add advanced features
8. **Agent 8 (Accessibility)** - Make inclusive
9. **Agent 9 (Debugging)** - Add dev tools
10. **Agent 10 (Docs)** - Document everything

---

## Output Structure

```
/mnt/okcomputer/output/
├── PatternDisplay.optimized.tsx    # Performance optimized
├── PatternDisplay.vfx.tsx          # Visual effects enhanced
├── PatternDisplay.ui.tsx           # UI/UX improved
├── PatternDisplay.refactored.tsx   # Architecture refactored
├── PatternDisplay.resilient.tsx    # Error handling
├── PatternDisplay.responsive.tsx   # Responsive design
├── PatternDisplay.enhanced.tsx     # Feature enhanced
├── PatternDisplay.a11y.tsx         # Accessibility
├── PatternDisplay.debug.tsx        # Debug tools
├── types.ts                        # Core types
├── geometryConstants.ts            # Geometry constants
├── hooks/                          # Custom hooks
│   ├── useWebGPU.ts
│   ├── useWebGL.ts
│   ├── useShaderLoader.ts
│   └── ...
├── components/                     # Sub-components
│   ├── PatternGrid.tsx
│   ├── ControlPanel.tsx
│   └── ...
├── shaders-enhanced/               # Enhanced shaders
│   ├── patternv1.0.wgsl
│   └── ...
├── debug/                          # Debug tools
│   └── ...
├── docs/                           # Documentation
│   └── ...
└── examples/                       # Usage examples
    └── ...
```

---

## Success Criteria

Each agent should ensure their output:
- ✅ Maintains backward compatibility where possible
- ✅ Preserves existing functionality
- ✅ Follows React best practices
- ✅ Uses TypeScript strictly
- ✅ Includes error handling
- ✅ Is well-documented
- ✅ Maintains 60fps performance
- ✅ Works across modern browsers
