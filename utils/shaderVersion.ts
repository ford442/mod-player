// Shader version / capability helpers for PatternDisplay and render hooks.
// All per-shader capabilities live in shaderRegistry.ts — these are thin wrappers.

import {
  SHADER_REGISTRY,
  getShaderMeta,
  resolveShaderMeta,
  type ShaderMeta,
  type HitTestProfile,
} from './shaderRegistry';

export type { ShaderMeta, HitTestProfile };
export { getShaderMeta, resolveShaderMeta, SHADER_REGISTRY };

// ---------------------------------------------------------------------------
// WEBGL_HYBRID_SHADERS — Set for O(1) membership (PatternDisplay, overlay).
// ---------------------------------------------------------------------------
export const WEBGL_HYBRID_SHADERS = new Set(
  Object.entries(SHADER_REGISTRY)
    .filter(([, meta]) => meta.webglHybrid)
    .map(([filename]) => filename),
);

export type LayoutType = 'standard' | 'extended' | 'texture';

export const getLayoutType = (shaderFile: string): LayoutType => {
  const meta = resolveShaderMeta(shaderFile);
  // 'texture' layout type is reserved for pure texture shaders if added later;
  // video pattern textures still use the extended cell-buffer layout.
  return meta.extendedLayout ? 'extended' : 'standard';
};

export const isSinglePassCompositeShader = (shaderFile: string): string | false => {
  return resolveShaderMeta(shaderFile).singlePassComposite;
};

export const isCircularLayoutShader = (shaderFile: string): boolean => {
  return resolveShaderMeta(shaderFile).circular;
};

export const shouldUseBackgroundPass = (shaderFile: string): boolean => {
  return !isSinglePassCompositeShader(shaderFile);
};

export const getBackgroundShaderFile = (shaderFile: string): string => {
  return resolveShaderMeta(shaderFile).background;
};

export const shouldEnableAlphaBlending = (shaderFile: string): boolean => {
  return resolveShaderMeta(shaderFile).alphaBlending;
};

/**
 * Returns true for shaders that use uniform slot [24] as `stepsLength: u32`.
 * All other shaders use slot [24] as `colorPalette: u32`.
 */
export const supportsStepsLength = (shaderFile: string): boolean => {
  return resolveShaderMeta(shaderFile).supportsStepsLength;
};

/** Returns true if the shader is tagged as recommended for lite/mobile mode. */
export const isLiteRecommendedShader = (shaderFile: string): boolean => {
  return resolveShaderMeta(shaderFile).liteRecommended ?? false;
};

/** High-precision PackedA/PackedB packing (DURA + TRIG-001). */
export const usesHighPrecisionPacking = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).highPrecisionPacking;

/** Playhead-scrolled sustain (v0.45b / v0.30b). */
export const usesStrictPlayheadSustainMode = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).strictPlayheadSustain;

/** Uniform slot [2] is f32 playhead (not u32). */
export const usesPlayheadRowAsFloat = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).playheadRowAsFloat;

export const usesPadTopChannel = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).padTopChannel;

export const getShaderCanvasSize = (
  shaderFile: string,
): { width: number; height: number } => resolveShaderMeta(shaderFile).canvasSize;

export const getHitTestProfile = (shaderFile: string): HitTestProfile =>
  resolveShaderMeta(shaderFile).hitTestProfile;

export const usesOscilloscope = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).oscilloscope;

export const usesInstrumentPalette = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).instrumentPalette;

export const usesAudioReactive = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).audioReactive;

export const usesAudioReactiveBezel = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).background === 'bezel_audio.wgsl';

export const usesBareCanvasChrome = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).bareCanvasChrome;

export const showsChannelInvertButton = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).showChannelInvertButton;

export const usesCircularRowPaging = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).circularRowPaging;

export const usesStepsDrivenVisibleRows = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).stepsDrivenVisibleRows;

export const isHorizontalLayoutShader = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).layoutMode === 'horizontal_32';

export const usesVideoPatternTexture = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).patternTexture === 'video';

export const getUiExtraInstances = (shaderFile: string): number =>
  resolveShaderMeta(shaderFile).uiExtraInstances;

export const usesNightModeBezel = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).nightModeBezel;

/** True when bezel uniform slots 16–22 carry transport/control fields. */
export const needsChassisControlFields = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).chassisControlEncoding !== 'none';

/** Shader-embedded transport UI hit-testing (polar or square layout). */
export const hasEmbeddedTransportUI = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).hitTestProfile !== 'none';

/** WebGL hybrid overlay uses horizontal v0.21 shader builder path. */
export const usesWebGLOverlayHorizontal = (shaderFile: string): boolean =>
  resolveShaderMeta(shaderFile).webglOverlayHorizontal;
