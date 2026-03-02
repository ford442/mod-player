# Frontend Integration Guide - Polar Chassis

## Files Generated
- ✅ `specs/polar/panel_spec.md`
- ✅ `specs/polar/knobs_spec.md`
- ✅ `specs/polar/rings_spec.md`
- ✅ `specs/polar_chassis_spec.md`
- ✅ `src/shaders/polar_chassis.wgsl`

## Integration Steps

### 1. Register the Shader in Your App

Add to your shader loading code in `components/PatternDisplay.tsx` or `Studio3D.tsx`:

```typescript
// Add to your shader registry
const SHADERS = {
  // ... existing shaders
  polar: 'polar_chassis.wgsl',
};
```

### 2. Load the Shader

```typescript
const shaderSource = await fetch('/shaders/polar_chassis.wgsl')
  .then(res => res.text());
```

### 3. Create Uniform Buffer Layout

```typescript
// Chassis uniforms
const chassisUniformBuffer = device.createBuffer({
  size: 256, // Aligned to 256 bytes
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// Audio uniforms
const audioUniformBuffer = device.createBuffer({
  size: 32,  // vec4 + f32 + f32 + f32 + padding
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
```

### 4. Update Uniforms Each Frame

```typescript
function updateChassisUniforms() {
  const data = new Float32Array([
    // Panel dimensions (vec2)
    0.48, 0.28,
    // Padding
    0, 0,
    // Panel color (vec3)
    0.92, 0.93, 0.95,
    // Panel roughness
    0.25,
    // Panel metallic
    0.85,
    // Padding
    0, 0,
    
    // Knob positions (4 x vec3 = 12 floats)
    -0.12, 0.08, 0.025,
    0.12, 0.08, 0.025,
    -0.12, -0.08, 0.025,
    0.12, -0.08, 0.025,
    
    // Knob color (vec3)
    0.4, 0.15, 0.6,
    // Knob ring color (vec3)
    0.6, 0.3, 0.9,
    // Knob ring intensity
    2.0,
    
    // Ring center (vec3)
    0.0, 0.0, 0.03,
    // Ring radii (vec4)
    0.08, 0.115, 0.15, 0.185,
    // Ring thicknesses (vec4)
    0.008, 0.007, 0.006, 0.005,
    // Ring color (vec3)
    0.2, 0.7, 0.9,
    // Ring emissive (vec3)
    0.4, 0.85, 1.0,
    // Ring intensity
    3.0,
  ]);
  
  device.queue.writeBuffer(chassisUniformBuffer, 0, data);
}

function updateAudioUniforms(audioData: AudioData) {
  const data = new Float32Array([
    // frequencies: bass, lowMid, highMid, treble
    audioData.bass,
    audioData.lowMid,
    audioData.highMid,
    audioData.treble,
    // amplitude
    audioData.amplitude,
    // time
    performance.now() / 1000,
    // beat
    audioData.beat ? 1.0 : 0.0,
    // padding
    0,
  ]);
  
  device.queue.writeBuffer(audioUniformBuffer, 0, data);
}
```

### 5. Create Bind Group Layout

```typescript
const bindGroupLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
  ]
});

const bindGroup = device.createBindGroup({
  layout: bindGroupLayout,
  entries: [
    { binding: 0, resource: { buffer: cameraUniformBuffer } },
    { binding: 1, resource: { buffer: chassisUniformBuffer } },
    { binding: 2, resource: { buffer: audioUniformBuffer } },
  ]
});
```

### 6. Create Pipeline

```typescript
const pipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout]
  }),
  vertex: {
    module: shaderModule,
    entryPoint: 'vs_main'
  },
  fragment: {
    module: shaderModule,
    entryPoint: 'fs_main',
    targets: [{ format: presentationFormat }]
  },
  primitive: { topology: 'triangle-list' }
});
```

### 7. Connect Audio Data

```typescript
// In your render loop
const audioData = {
  bass: audioProcessor.getFrequencyBand('bass'),
  lowMid: audioProcessor.getFrequencyBand('lowMid'),
  highMid: audioProcessor.getFrequencyBand('highMid'),
  treble: audioProcessor.getFrequencyBand('treble'),
  amplitude: audioProcessor.getOverallAmplitude(),
  beat: audioProcessor.detectBeat()
};

updateAudioUniforms(audioData);
```

## Shader Features

### Audio Reactivity Mapping
| Component | Audio Input | Effect |
|-----------|-------------|--------|
| Knob Rings | Bass frequencies | Intensity 2.0x → 4.0x |
| Knob Rings | Beat detection | Flash on strong beats |
| Central Ring 1 | Bass | Emission boost, color shift |
| Central Ring 2 | Low-mid | Emission boost, color shift |
| Central Ring 3 | High-mid | Emission boost, pulsing |
| Central Ring 4 | Treble | Emission boost, shimmer |

### Color Shifts
- **Low energy**: Cyan (0.2, 0.7, 0.9)
- **High energy**: Purple (0.6, 0.3, 0.9)

### Performance
- Max raymarch steps: 256
- Target: 60fps on mid-tier GPUs
- Optimized for bloom post-processing

## Next Steps

1. Copy `src/shaders/polar_chassis.wgsl` to your public/shaders folder
2. Integrate uniform updates into your render loop
3. Connect your AudioProcessor output to the audio uniforms
4. Add bloom post-processing for the emissive rings

## Troubleshooting

### Shader Compilation Errors
- Check WGSL syntax compatibility with your WebGPU implementation
- Verify uniform buffer alignment (16-byte boundaries)

### No Audio Reactivity
- Verify audio uniforms are being updated every frame
- Check frequency band ranges match your audio processor

### Performance Issues
- Reduce MAX_STEPS in shader (try 128)
- Lower resolution for raymarching
- Use LOD for distant geometry
