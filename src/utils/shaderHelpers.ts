import { useRef, useState } from 'react';
import {
  getBackgroundShaderFile,
  shouldUseBackgroundPass,
  resolveShaderMeta,
} from '../../utils/shaderVersion';

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
      timestamp: new Date().toISOString(),
    });
  };

  return { loadedShader, loadedBackground, loadCount: loadCount.current, logShaderLoad };
}

/**
 * Background shader selection — delegates to shader registry.
 */
export function getBackgroundShaderForPattern(shaderFile: string): string | null {
  return getBackgroundShaderFile(shaderFile);
}

/**
 * Check if shader needs a background pass (registry singlePassComposite).
 */
export function needsBackgroundPass(shaderFile: string): boolean {
  return shouldUseBackgroundPass(shaderFile);
}

/**
 * Human-readable description for UI tooltips (registry-driven).
 */
export function describeShader(shaderFile: string): string {
  const meta = resolveShaderMeta(shaderFile);
  if (meta.patternTexture === 'video') return 'Video/cloud tunnel';
  if (meta.strictPlayheadSustain) return 'Note-on sustain tail mode';
  if (meta.oscilloscope) return 'Three-emitter LED + oscilloscope';
  if (meta.instrumentPalette) return 'Three-emitter LED + instrument palette';
  if (meta.bloomProfile === 'three-emitter') return 'Trapcode-style frosted lens';
  if (meta.webglHybrid && meta.circular) return 'Hybrid frosted circular overlay';
  if (meta.layoutMode === 'horizontal_32' && meta.bezelTexture === 'square') {
    return 'Frosted glass wall panel';
  }
  if (meta.circular) return 'Circular LED / frosted disc';
  return 'Pattern visualizer';
}

/**
 * Shader categories for UI grouping
 */
export const SHADER_CATEGORIES = {
  FROSTED_PANEL: [
    'patternv0.44.wgsl',
    'patternv0.43.wgsl',
    'patternv0.40.wgsl',
    'patternv0.39.wgsl',
    'patternv0.21.wgsl',
  ],
  CIRCULAR_LED: [
    'patternv0.50.wgsl',
    'patternv0.50b.wgsl',
    'patternv0.51.wgsl',
    'patternv0.55.wgsl',
    'patternv0.56.wgsl',
    'patternv0.57.wgsl',
  ],
  VIDEO: ['patternv0.23.wgsl', 'patternv0.24.wgsl'],
};
