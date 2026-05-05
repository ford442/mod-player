// FIX for PatternDisplay.tsx shader switching issues
// 
// PROBLEM: When switching shaders, the old background/effect sometimes persists
// SOLUTION: Add a key prop to force remount when shader changes
//
// In your parent component (App.tsx or wherever PatternDisplay is used):

<PatternDisplay
  key={shaderFile} // <-- ADD THIS - forces remount when shader changes
  matrix={sequencerMatrix}
  playheadRow={currentRow}
  shaderFile={shaderFile}
  // ... other props
/>

// This ensures complete cleanup and fresh initialization when switching shaders.
// Without this, React may reuse the component instance and not properly clean up
// WebGPU resources.

// ALTERNATIVE: If you can't add a key, add this at the start of the init() function:

useEffect(() => {
  let cancelled = false;
  
  // Force cleanup of previous resources before initializing
  if (deviceRef.current) {
    try {
      deviceRef.current.destroy();
    } catch (e) {}
    deviceRef.current = null;
  }
  // ... rest of cleanup from the return function
  
  const init = async () => {
    console.log(`[PatternDisplay] Initializing shader: ${shaderFile}`); // ADD LOGGING
    // ... rest of init
  };
  
  init();
  return () => { cancelled = true; /* ... cleanup */ };
}, [shaderFile, syncCanvasSize]);

// ALSO: Add cache-busting to shader fetches to prevent browser caching wrong shaders:
const shaderSource = await fetch(`${shaderBase}shaders/${shaderFile}?v=${Date.now()}`)
  .then(res => res.text());

// And for background shader:
const backgroundSource = await fetch(`${shaderBase}shaders/${backgroundShaderFile}?v=${Date.now()}`)
  .then(res => res.text());
