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

// Configure module locator for WASM files served from /xm-player/worklets/
Module['locateFile'] = function(path, prefix) {
    // In production, files are served from the base URL + worklets/
    // The TypeScript engine sets Module.locateFile before instantiation,
    // so this is a fallback for direct loading.
    if (typeof Module['wasmBasePath'] === 'string') {
        return Module['wasmBasePath'] + path;
    }
    return prefix + path;
};
