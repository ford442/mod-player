import { useRef, useState } from 'react';

/**
 * Shader debugging utility to help identify which shader/background is loaded
 */
export function useShaderDebug() {
  const [loadedShader, setLoadedShader] = useState<string | null>(null);
  const [loadedBackground, setLoadedBackground] = useState<string | null>(null);
  const loadCount = useRef(0);

  const logShaderLoad = (shaderFile: string, backgroundFile?: string) => {
    loadCount.current += 1;
    setLoadedShader(shaderFile);
    if (backgroundFile) setLoadedBackground(backgroundFile);
    
    console.log(`[ShaderDebug] Load #${loadCount.current}:`, {
      shader: shaderFile,
      background: backgroundFile || 'none',
      timestamp: new Date().toISOString()
    });
  };

  return { loadedShader, loadedBackground, loadCount: loadCount.current, logShaderLoad };
}

/**
 * Background shader selection logic - extracted for clarity
 * Returns the appropriate background shader for a given pattern shader
 */
export function getBackgroundShaderForPattern(shaderFile: string): string | null {
  // Video shaders
  if (shaderFile.includes('v0.23') || shaderFile.includes('v0.24')) {
    return 'chassis_video.wgsl';
  }
  
  // Horizontal frosted panel layouts
  if (shaderFile.includes('v0.21') || 
      shaderFile.includes('v0.40') || 
      shaderFile.includes('v0.42') || 
      shaderFile.includes('v0.43') || 
      shaderFile.includes('v0.44')) {
    return 'chassis_frosted.wgsl';
  }
  
  // Circular hardware bezel (v0.45-v0.50)
  if (shaderFile.includes('v0.45') || 
      shaderFile.includes('v0.46') || 
      shaderFile.includes('v0.47') || 
      shaderFile.includes('v0.48') || 
      shaderFile.includes('v0.49') || 
      shaderFile.includes('v0.50')) {
    return 'bezel.wgsl';
  }
  
  // Legacy circular layouts
  if (shaderFile.includes('v0.37') || 
      shaderFile.includes('v0.38') || 
      shaderFile.includes('v0.39')) {
    return 'chassisv0.37.wgsl';
  }
  
  // Very legacy layouts
  if (shaderFile.includes('v0.27') || 
      shaderFile.includes('v0.28') || 
      shaderFile.includes('v0.30') || 
      shaderFile.includes('v0.31') || 
      shaderFile.includes('v0.32') || 
      shaderFile.includes('v0.33') || 
      shaderFile.includes('v0.34') || 
      shaderFile.includes('v0.35') || 
      shaderFile.includes('v0.36')) {
    return 'chassisv0.1.wgsl';
  }
  
  // Default fallback
  return 'bezel.wgsl';
}

/**
 * Check if shader needs a background pass
 */
export function needsBackgroundPass(shaderFile: string): boolean {
  // These shaders do their own background composition
  const singlePassShaders = [
    'v0.21', 'v0.40', 'v0.42', 'v0.43', 'v0.44'
  ];
  
  return !singlePassShaders.some(v => shaderFile.includes(v));
}

/**
 * Shader categories for UI grouping
 */
export const SHADER_CATEGORIES = {
  // Square/horizontal layouts with frosted panel
  FROSTED_PANEL: [
    'patternv0.44.wgsl',
    'patternv0.43.wgsl', 
    'patternv0.40.wgsl',
    'patternv0.21.wgsl',
  ],
  
  // Circular layouts with frosted glass effect (v0.45-v0.46)
  FROSTED_CIRCULAR: [
    'patternv0.46.wgsl', // The "frosted glass circle" shader
    'patternv0.45.wgsl',
  ],
  
  // Circular layouts with trap/bezel effect (v0.47-v0.50)
  TRAP_CIRCULAR: [
    'patternv0.50.wgsl',
    'patternv0.49.wgsl',
    'patternv0.48.wgsl',
    'patternv0.47.wgsl',
  ],
  
  // Legacy circular
  LEGACY_CIRCULAR: [
    'patternv0.38.wgsl',
    'patternv0.37.wgsl',
  ],
  
  // Video/cloud effects
  VIDEO: [
    'patternv0.24.wgsl',
    'patternv0.23.wgsl',
  ],
} as const;

/**
 * Get a human-readable description of what the shader will look like
 */
export function getShaderDescription(shaderFile: string): string {
  if (shaderFile.includes('v0.46')) return 'Frosted glass circular overlay with bezel ring';
  if (shaderFile.includes('v0.45')) return 'Frosted glass circular with bloom';
  if (shaderFile.includes('v0.47') || shaderFile.includes('v0.48')) return 'Trapcode-style frosted disc';
  if (shaderFile.includes('v0.49') || shaderFile.includes('v0.50')) return 'Trapcode-style frosted lens';
  if (shaderFile.includes('v0.40') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44')) return 'Frosted glass wall panel';
  if (shaderFile.includes('v0.38')) return 'Glass circular';
  if (shaderFile.includes('v0.23') || shaderFile.includes('v0.24')) return 'Video/cloud tunnel';
  return 'Standard pattern view';
}
