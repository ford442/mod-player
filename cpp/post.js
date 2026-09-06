/**
 * post.js – Emscripten post-JS.
 *
 * emcc 3.1.51 + MODULARIZE leaves AUDIO_WORKLET helpers as locals even when
 * they are listed in EXPORTED_RUNTIME_METHODS. Copy them onto Module so
 * OpenMPTWorkletEngine.attachAudioContext can register the shared AudioContext.
 */
if (typeof emscriptenRegisterAudioObject === 'function') {
    Module['emscriptenRegisterAudioObject'] = emscriptenRegisterAudioObject;
}
if (typeof emscriptenGetAudioObject === 'function') {
    Module['emscriptenGetAudioObject'] = emscriptenGetAudioObject;
}
