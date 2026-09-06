/**
 * pre.js – Emscripten pre-JS file.
 *
 * Injected before the Emscripten glue code. Sets up environment
 * configuration for the AudioWorklet build.
 */

// Polyfill timers only when the host has none (legacy AudioWorklet scopes).
// Chrome 116+ already provides setTimeout in AudioWorkletGlobalScope, and this
// file is also --pre-js'd into the MAIN-THREAD glue. Unconditionally replacing
// window.setTimeout with a delay-ignoring microtask breaks:
//   - JS worklet addModule timeouts after a native init
//   - Emscripten AUDIO_WORKLET / WASM_WORKER startup
// See docs/WORKLET_AUDIO_BUG.md (setTimeout polyfill).
if (typeof globalThis.setTimeout !== 'function') {
    globalThis.setTimeout = function (callback) {
        Promise.resolve().then(callback);
        return 0;
    };
    globalThis.clearTimeout = function () {};
}

// Ensure Module exists
if (typeof Module === 'undefined') Module = {};

// Configure module locator for WASM / .aw.js / .ww.js next to the glue.
// Do not clobber a locateFile the host already set (OpenMPTWorkletEngine).
if (typeof Module['locateFile'] !== 'function') {
    Module['locateFile'] = function(path, prefix) {
        if (typeof Module['wasmBasePath'] === 'string') {
            return Module['wasmBasePath'] + path;
        }
        return prefix + path;
    };
}
