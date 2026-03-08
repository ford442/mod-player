# MOD Player Debug & Fix Plan

## Issues Identified

### 1. Playback Bugs
- **AudioContext timing issues**: The worklet loading state management could cause race conditions
- **Seek functionality**: The seekToStep wrapper has async issues with the native engine
- **Position tracking**: Worklet position updates may drift from actual playback position

### 2. Shader Display Issues
- **Uniform buffer alignment**: WGSL structs need proper padding for WebGPU
- **Canvas sizing**: PatternDisplay canvas doesn't properly respond to container resize
- **Fallback handling**: When WebGPU fails, the HTML fallback may not initialize correctly

### 3. Element Sizing Problems
- **Canvas metrics calculation**: `canvasMetrics` useMemo doesn't account for DPI scaling
- **Responsive layout**: PatternDisplay doesn't properly handle small screen sizes
- **3D mode scaling**: Studio3D component has hardcoded scale values that break layout

## Files Needing Attention

### Critical Files:
1. `components/PatternDisplay.tsx` - Canvas sizing, WebGPU initialization
2. `hooks/useLibOpenMPT.ts` - Playback timing, worklet communication
3. `App.tsx` - Layout structure, responsive handling
4. `shaders/patternv0.40.wgsl` - Uniform alignment
5. `shaders/chassis_frosted.wgsl` - Uniform alignment

### Supporting Files:
- `utils/geometryConstants.ts` - Layout calculations
- `components/Studio3D.tsx` - 3D mode sizing
- `index.html` - Viewport meta tag

## Proposed Fix Sequence

### Phase 1: Playback Stability
1. Fix AudioContext resume handling
2. Add proper error boundaries for worklet failures
3. Implement position sync validation

### Phase 2: Shader Fixes
1. Standardize uniform buffer layouts
2. Add shader compilation error reporting
3. Fix canvas resize observer

### Phase 3: Sizing & Layout
1. Implement DPI-aware canvas sizing
2. Add responsive breakpoints
3. Fix 3D mode scaling

## Testing Checklist

- [ ] Load and play various module formats (MOD, XM, S3M, IT)
- [ ] Test seek functionality during playback
- [ ] Verify pattern display updates in sync with audio
- [ ] Test all shader variants
- [ ] Check responsive behavior at different screen sizes
- [ ] Verify 3D mode switching
- [ ] Test dark/light mode transitions

## Debug Commands

```bash
# Run type checking
npm run typecheck

# Build for production
npm run build

# Preview production build
npm run preview

# Run dev server
npm run dev
```
