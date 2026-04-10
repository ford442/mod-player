# Quick Fixes - MOD Player Web App

## Critical Issues (Fix Immediately)

### 1. GPU Buffer Memory Leak
**Problem:** Creating new buffers every frame without cleanup
```typescript
// BAD - Creates leak
const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM });
device.queue.writeBuffer(buffer, 0, data);
// Buffer never destroyed!
```

**Fix:** Use buffer pooling (see `refactored/ResourcePool.ts`)
```typescript
const pool = new BufferPool(device);
const buffer = pool.acquire(size, usage);
// ... use buffer ...
pool.release(buffer); // Returns to pool instead of destroying
```

### 2. Misleading WebGPU Error Message
**Problem:** "WebGPU not available" shown even when initialization fails

**Fix:** Distinguish between availability and initialization failures
```typescript
if (!navigator.gpu) {
  return { type: 'not-available', message: 'Browser does not support WebGPU' };
}

try {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    return { type: 'initialization-failed', message: 'No GPU adapter found' };
  }
} catch (e) {
  return { type: 'initialization-failed', message: e.message };
}
```

### 3. Missing Device Lost Handler
**Problem:** GPU device can be lost without recovery

**Fix:** Add device lost handler
```typescript
device.lost.then((info) => {
  console.error('Device lost:', info.reason);
  cleanupResources();
  if (info.reason !== 'destroyed') {
    setTimeout(() => initializeWebGPU(), 1000);
  }
});
```

### 4. No Context Loss Recovery
**Problem:** Canvas context loss crashes the app

**Fix:** Listen for context events
```typescript
canvas.addEventListener('webgpucontextlost', (e) => {
  e.preventDefault();
  setContextLost(true);
});

canvas.addEventListener('webgpucontextrestored', () => {
  reinitializeWebGPU();
});
```

## High Priority Issues

### 5. Shader Hot-Swap Race Condition
**Problem:** Destroying pipeline while GPU is using it

**Fix:** Use frame fences
```typescript
const fence = device.createFence();
queue.signal(fence, frameNumber);
// Only destroy after fence completes
```

### 6. Timeout-Based Resize Debouncing
**Problem:** Timeout debouncing causes visual glitches

**Fix:** Use ResizeObserver with RAF
```typescript
const observer = new ResizeObserver((entries) => {
  const { width, height } = entries[0].contentRect;
  pendingSize.current = { width, height };
  
  if (!rafId.current) {
    rafId.current = requestAnimationFrame(() => {
      resizeCanvas(pendingSize.current);
    });
  }
});
```

### 7. Shader Code Duplication
**Problem:** Multiple shader versions (v0.21-v0.50) with similar code

**Fix:** Use modular composition (see `refactored/ShaderComposer.ts`)
```typescript
const shader = composeShader([
  'vertexBase',
  'uniforms', 
  'textureSampling',
  'patternData'
]);
```

### 8. Missing Resource Cleanup on Unmount
**Problem:** GPU resources leak when component unmounts

**Fix:** Track and cleanup all resources
```typescript
useEffect(() => {
  const resources: GPUBuffer[] = [];
  
  const buffer = device.createBuffer({...});
  resources.push(buffer);
  
  return () => {
    resources.forEach(r => r.destroy());
  };
}, []);
```

## Medium Priority Issues

### 9. Weak TypeScript Types
**Problem:** Generic types used for errors and uniforms

**Fix:** Define proper types
```typescript
interface PatternUniforms {
  time: number;
  resolution: [number, number];
  rowIndex: number;
}

class WebGPUError extends Error {
  constructor(message: string, public code: string, public recoverable: boolean) {
    super(message);
  }
}
```

### 10. Debug Overlay Always Visible
**Problem:** Debug info shows by default

**Fix:** Default to hidden with toggle
```typescript
const [showDebug, setShowDebug] = useState(false);

useEffect(() => {
  const handleKeyDown = (e) => {
    if (e.key === 'd') setShowDebug(prev => !prev);
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);
```

## Performance Optimizations

### 11. Reduce Uniform Buffer Updates
```typescript
// Only update when data changes
if (!arraysEqual(previousData, newData)) {
  device.queue.writeBuffer(buffer, 0, newData);
}
```

### 12. Batch Command Buffer Submissions
```typescript
const encoder = device.createCommandEncoder();
// ... multiple render passes ...
device.queue.submit([encoder.finish()]);
```

### 13. Cap DPR for Performance
```typescript
const dpr = Math.min(window.devicePixelRatio, 2); // Cap at 2x
```

## Testing Checklist

- [ ] Test on browsers without WebGPU (should show proper error)
- [ ] Test device lost recovery (simulate in dev tools)
- [ ] Test rapid resizing (should be smooth)
- [ ] Test long-running playback (check for memory leaks)
- [ ] Test shader hot-swapping (should not crash)
- [ ] Test tab switching (should pause/resume correctly)

## Migration Path

1. **Phase 1 (Critical):** Fix memory leaks, add device lost handler
2. **Phase 2 (High):** Implement buffer pooling, fix resize handling
3. **Phase 3 (Medium):** Add shader composition, improve types
4. **Phase 4 (Low):** Add performance monitoring, optimize further
