/**
 * libopenmpt C API `openmpt_module_set_render_param` indices (libopenmpt.h).
 *
 * Mixer mapping for INTERPOLATIONFILTER_LENGTH:
 *   0     Sinc+LP (library default)
 *   1     nearest
 *   2     linear
 *   3–7   cubic
 *   ≥ 8   Sinc+LP
 *
 * There is no ctl for SINC8 vs SINC8LP — both report as length 8 on get.
 * `render.resampler.emulate_amiga` overrides this filter on Amiga MODs.
 * MPTM instrument-level resampling can override a global 8; length 0
 * leaves the composer’s choice in place.
 *
 * Param 2 is STEREOSEPARATION_PERCENT, not interpolation.
 */
export const OPENMPT_MODULE_RENDER_MASTERGAIN_MILLIBEL = 1;
export const OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT = 2;
export const OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH = 3;
export const OPENMPT_MODULE_RENDER_VOLUMERAMPING_STRENGTH = 4;

/** Cubic. JS wasm2js / ScriptProcessor live playback. */
export const INTERPOLATION_CUBIC = 4;
/** Sinc+LP. Native live playback and offline HQ export. */
export const INTERPOLATION_SINC_LP = 8;

export type OpenMPTInterpolationLength = 1 | 2 | 4 | 8;
