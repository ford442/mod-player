/**
 * pre.js – Emscripten pre-JS file.
 *
 * Injected before the Emscripten glue code. Sets up environment
 * configuration for the AudioWorklet build.
 */

// Polyfill timers for Emscripten inside AudioWorklet (setTimeout is missing
// and sometimes causes crashes when compiled code tries to use it).
globalThis.setTimeout = function(callback, delay) {
    Promise.resolve().then(callback); // Execute as a microtask
    return 0;
};
globalThis.clearTimeout = function() {};

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
