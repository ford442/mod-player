// Globals that emcc injects into the scope cpp/pre.js and cpp/post.js are concatenated into.
// Only tsconfig.scripts.json sees this file (the app tsconfig excludes cpp/), so `Module` never
// becomes a global of the application code.

/** The Emscripten Module object (assigned by pre.js when the host did not provide one). */
declare var Module: Record<string, any>;

/** AUDIO_WORKLET helpers; emcc 3.1.51 + MODULARIZE leaves them as locals (see post.js). */
declare function emscriptenRegisterAudioObject(...args: unknown[]): unknown;
declare function emscriptenGetAudioObject(...args: unknown[]): unknown;
