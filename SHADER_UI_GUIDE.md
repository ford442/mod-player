# Shader UI Integration Guide (v0.37)

This document describes the integrated UI controls rendered directly in the WGSL shader for patternv0.37.

## Overview

As of the latest update, the v0.37 shader includes a complete hardware-style interface rendered directly on the WebGPU canvas. All playback controls, volume/pan adjustments, and status displays are now part of the shader rendering, eliminating the need for separate HTML controls.

## UI Layout

```
┌────────────────────────────────────────────────────────────┐
│  Tempo: 150 BPM              Position: Order 00 Row 62    │  <- Top Info Bar
│                                                            │
│     Volume                                        Panning  │
│       │                                               │    │
│      [ ]  ← Slider                        Slider →   [ ]   │  <- Side Sliders
│       │                                               │    │
│      [ ]                  CIRCULAR                   [ ]   │
│       │                   PATTERN                     │    │
│      [█]  ← Handle         DISPLAY        Handle →   [█]   │
│       │                                               │    │
│      [ ]                                             [ ]   │
│       │                                               │    │
│                                                            │
│              ╔════════════════════╗                        │
│              ║ CIRCULAR PATTERN   ║                        │  <- Pattern Display
│              ║   (Tracker Data)   ║                        │
│              ║                    ║                        │
│              ╚════════════════════╝                        │
│                                                            │
│    ( )      ( )      ( )      ( )                         │  <- Bottom Buttons
│   LOOP     PLAY     STOP     OPEN                         │
│                                                            │
│   ────────────────────────────────                        │  <- Song Position Bar
│          ▲ Position Marker                                │
│                                                            │
│  ┌──────────────────┐                                     │
│  │ Shader Selector  │  ← Bottom-Left Overlay              │
│  └──────────────────┘                                     │
└────────────────────────────────────────────────────────────┘
```

## Interactive Elements

### Volume Slider (Left Side)
- **Location**: x = -0.42 (left side), y = 0.0 (center)
- **Height**: 0.3 normalized units
- **Range**: 0.0 (bottom) to 1.0 (top)
- **Interaction**: Click or drag within slider region
- **Visual**: Green circular handle, vertical track
- **Label**: "VOLUME" text below slider

### Panning Slider (Right Side)
- **Location**: x = 0.42 (right side), y = 0.0 (center)
- **Height**: 0.3 normalized units
- **Range**: -1.0 (left/bottom) to 1.0 (right/top)
- **Interaction**: Click or drag within slider region
- **Visual**: Color-coded handle (red=left, blue=right), vertical track
- **Label**: "PANNING" text below slider

### BPM Display (Top Center)
- **Location**: y = -0.48 (top of canvas)
- **Format**: 7-segment style digits (3 digits max)
- **Color**: Cyan/blue glow
- **Labels**: "Tempo:" (left) and "BPM" (right)

### Position Display (Top Area)
- **Location**: Left side, y = -0.45
- **Format**: Two 2-digit numbers
- **Shows**: Current Order (pattern) and Row
- **Color**: Yellow/orange
- **Label**: "Position:"

### Control Buttons (Bottom)
- **Loop Button**: x = -0.32
  - Color: Orange when active, dim when inactive
  - Icon: Ring/circle shape
  
- **Play Button**: x = -0.13
  - Color: Green, brighter when playing
  - Icon: Triangle (play symbol)
  
- **Stop Button**: x = 0.13
  - Color: Red
  - Icon: Square (stop symbol)
  
- **Open File Button**: x = 0.32
  - Color: Blue
  - Icon: Upload arrow

### Song Position Bar (Bottom Center)
- **Location**: y = -0.45 (near bottom)
- **Width**: 0.8 (80% of canvas)
- **Height**: 0.03
- **Interaction**: Click to seek to position
- **Visual**: Rail with progress indicator

### Shader Selector (Bottom-Left Overlay)
- **Position**: Absolute positioned over canvas
- **Location**: bottom: 16px, left: 16px
- **Content**: 
  - Quick switcher buttons (Horizontal/Circular)
  - Full shader dropdown
- **Style**: Semi-transparent dark background with blur

## Mouse Interaction Mapping

The `handleCanvasClick` function in PatternDisplay.tsx maps screen coordinates to shader coordinates:

1. **Screen to UV**: Normalize mouse position to 0..1 range
2. **UV to Shader P**: Convert to shader coordinate system (p = uv - 0.5)
3. **Hit Testing**: Check if click is within interactive regions

### Coordinate System
- **Center**: (0, 0)
- **Top-left**: (-0.5, -0.5)
- **Bottom-right**: (0.5, 0.5)
- **Y-axis**: Negative up, positive down (standard WebGPU)

## Data Flow

```
App.tsx (React State)
    ↓
    ├─ volume (0-1)
    ├─ pan (-1 to 1)
    ├─ isLooping (boolean)
    ├─ BPM (number)
    └─ playhead position
    ↓
PatternDisplay.tsx
    ↓ (pack into uniforms)
BezelUniformBuffer (GPU)
    ↓ (96 bytes, 24 floats)
chassisv0.37.wgsl (Shader)
    ↓ (render)
Canvas Display
    ↓ (user interaction)
Mouse Events → handleCanvasClick
    ↓ (callbacks)
App.tsx (Update State)
```

## Uniform Buffer Layout

The BezelUniforms structure in chassisv0.37.wgsl:

```wgsl
struct BezelUniforms {
  // Canvas & rendering (0-15): 64 bytes
  canvasW: f32,           // [0]  
  canvasH: f32,           // [1]
  bezelWidth: f32,        // [2]
  surfaceR: f32,          // [3]
  surfaceG: f32,          // [4]
  surfaceB: f32,          // [5]
  bezelR: f32,            // [6]
  bezelG: f32,            // [7]
  bezelB: f32,            // [8]
  screwRadius: f32,       // [9]
  recessKind: f32,        // [10]
  recessOuterScale: f32,  // [11]
  recessInnerScale: f32,  // [12]
  recessCorner: f32,      // [13]
  dimFactor: f32,         // [14] (also indicates play state)
  _pad1: f32,             // [15]
  
  // Audio controls (16-23): 32 bytes
  volume: f32,            // [16] 0.0 to 1.0
  pan: f32,               // [17] -1.0 to 1.0
  bpm: f32,               // [18]
  isLooping: u32,         // [19] 0 or 1
  currentOrder: u32,      // [20]
  currentRow: u32,        // [21]
  _pad2: f32,             // [22]
  _pad3: f32,             // [23]
}
```

## Implementation Notes

### Adding New UI Elements

To add new interactive elements to the shader:

1. **Update BezelUniforms** in chassisv0.37.wgsl
2. **Update buffer size** in PatternDisplay.tsx (line ~994)
3. **Pack new data** in render loop (line ~1280+)
4. **Add drawing code** in shader fragment function
5. **Add hit testing** in handleCanvasClick
6. **Add callback prop** to PatternDisplay interface

### Text Rendering

The shader includes a `drawDigit` function for 7-segment style numbers:
- Supports digits 0-9
- Returns signed distance field
- Can be combined with smoothstep for anti-aliasing

For arbitrary text, use the `drawText` helper (currently just boxes, can be extended).

### Performance Considerations

- All UI elements rendered in a single shader pass
- Distance field functions are efficient
- Uniforms updated once per frame
- Mouse interactions handled on CPU (React)

## Testing

To test the shader UI:

1. **Build**: `npm run build`
2. **Run**: `npm run dev`
3. **Browser**: Chrome/Edge with WebGPU enabled
4. **Load**: Any tracker module file (.mod, .xm, .it, .s3m)
5. **Select**: Choose "patternv0.37" from shader dropdown
6. **Interact**: Click sliders, buttons, seek bar

### Expected Behavior

- ✅ Volume slider responds to clicks, handle moves
- ✅ Pan slider responds to clicks, handle moves with color change
- ✅ BPM displays current tempo
- ✅ Position shows order and row
- ✅ Loop button changes color when active
- ✅ Play/Stop buttons respond and change state
- ✅ Seek bar allows position jumping
- ✅ Shader selector positioned at bottom-left

## Troubleshooting

### "WebGPU not available"
- Enable chrome://flags/#enable-unsafe-webgpu
- Use Chrome Canary or Edge Canary
- Check browser compatibility

### Sliders not responding
- Ensure v0.37 shader is selected
- Check console for click coordinate logs
- Verify uniforms are being updated (check GPU debugger)

### Display appears wrong
- Check canvas dimensions match expected (1024x1024 for v0.37)
- Verify bezel texture loaded
- Check uniform buffer size (should be 96 bytes / 24 floats)

## Future Enhancements

Potential additions:
- [ ] Song title text rendering (texture-based or SDF fonts)
- [ ] VU meters for channel visualization
- [ ] Equalizer display
- [ ] Waveform preview
- [ ] Pattern name display
- [ ] Instrument list overlay
