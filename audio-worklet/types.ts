/**
 * audio-worklet/types.ts – Type definitions for the C++/Wasm AudioWorklet engine.
 *
 * These types define the communication protocol between the TypeScript
 * engine and the C++ worklet processor compiled with Emscripten.
 */

// ── Position data posted from worklet → main thread ─────────────────

export interface WorkletPatternRow {
    /** Per-channel note values (0 = none) */
    notes: number[];
    /** Per-channel instrument indices */
    instruments: number[];
    /** Per-channel volume commands */
    volCmds: number[];
    /** Per-channel volume values */
    volVals: number[];
    /** Per-channel effect commands */
    effCmds: number[];
    /** Per-channel effect values */
    effVals: number[];
}

export interface WorkletPatternData {
    patternIndex: number;
    numRows: number;
    numChannels: number;
    rows: WorkletPatternRow[];
}

export interface WorkletPositionData {
    positionMs: number;
  workletTime?: number;
    currentRow: number;
    currentPattern: number;
    currentOrder: number;
    bpm: number;
    numChannels: number;
    /** Per-channel mono VU values, indices [0..numChannels-1] */
    channelVU: Float32Array;
    /**
     * Full pattern data for the current order position.
     * Only included when the order changes (pattern switch).
     */
    patternData?: WorkletPatternData;
}

// ── Module metadata returned after loading ───────────────────────────

export interface WorkletModuleMetadata {
    title: string;
    numOrders: number;
    numPatterns: number;
    numChannels: number;
    durationSeconds: number;
    initialBpm: number;
}

// ── Engine events ────────────────────────────────────────────────────

export type EngineState = 'uninitialized' | 'initializing' | 'ready' | 'playing' | 'paused' | 'error';

export interface EngineEventMap {
    /** Fired when position/VU data is available (~60fps) */
    position: WorkletPositionData;
    /** Fired when a module finishes loading */
    loaded: WorkletModuleMetadata;
    /** Fired when the module reaches its end (non-looping) */
    ended: void;
    /** Fired on engine state change */
    statechange: EngineState;
    /** Fired on error */
    error: { message: string; code?: string };
}

// ── Emscripten module interface ──────────────────────────────────────

/**
 * Shape of the Emscripten module object after instantiation.
 * Only the functions we use are typed here.
 */
export interface EmscriptenOpenMPTModule {
    ccall: (
        ident: string,
        returnType: string | null,
        argTypes: string[],
        args: unknown[],
        opts?: { async?: boolean }
    ) => unknown;
    cwrap: (
        ident: string,
        returnType: string | null,
        argTypes: string[]
    ) => (...args: unknown[]) => unknown;
    UTF8ToString: (ptr: number) => string;
    getValue: (ptr: number, type: string) => number;
    setValue: (ptr: number, value: number, type: string) => void;
    HEAPU8: Uint8Array;
    HEAPF32: Float32Array;
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;

    // Exported C functions
    _init_audio: (sampleRate: number) => number;
    _load_module: (dataPtr: number, length: number) => number;
    _resume_audio: () => void;
    _suspend_audio: () => void;
    _seek_order_row: (order: number, row: number) => void;
    _set_loop: (loop: number) => void;
    _set_volume: (vol: number) => void;
    _poll_position: () => number; // Returns pointer to PositionInfo or 0
    _get_audio_context: () => number;
    _get_worklet_node: () => number;
    _cleanup_audio: () => void;
    // Pattern data query functions
    _get_num_channels: () => number;
    _get_num_orders: () => number;
    _get_order_pattern: (order: number) => number;
    _get_pattern_num_rows: (pattern: number) => number;
    _get_pattern_row_channel_command: (pattern: number, row: number, channel: number, command: number) => number;

    // ── Bridge / routing extensions (optional – present after WASM rebuild) ──

    /**
     * Configure a shared-memory ring buffer in WASM heap for main-thread routing.
     * Layout at bufPtr: [writeHead(Int32,4B), readHead(Int32,4B), stereoSamples(Float32)]
     * @param bufPtr        WASM heap byte offset (from _malloc)
     * @param capacityFrames  Stereo frame capacity of the sample region
     */
    _set_ring_buffer?: (bufPtr: number, capacityFrames: number) => void;

    /** Returns the current ring buffer write-head position (in stereo frames). */
    _get_ring_write_head?: () => number;

    /**
     * Initialise audio using an externally-provided AudioContext handle.
     * In this mode the AudioWorkletNode is NOT auto-connected to destination;
     * the caller wires it into their own audio graph.
     * @param ctxHandle  Emscripten audio context handle (emscriptenRegisterAudioObject)
     */
    _init_audio_with_context?: (ctxHandle: number) => number;

    // ── Emscripten audio object registry (injected by webaudio build) ──

    /**
     * Retrieve the JS AudioContext / AudioNode that was registered under this handle.
     * Available when compiled with -sAUDIO_WORKLET=1.
     */
    emscriptenGetAudioObject?: (handle: number) => (AudioContext | AudioNode | null);

    /**
     * Register a JS AudioContext or AudioNode and get back an integer handle.
     * The handle can then be passed to C++ exported functions.
     */
    emscriptenRegisterAudioObject?: (obj: AudioContext | AudioNode) => number;
}

/**
 * Factory function signature for the Emscripten module.
 * Generated by -sMODULARIZE=1 -sEXPORT_NAME=createOpenMPTModule
 */
export type CreateOpenMPTModule = (
    moduleOverrides?: Partial<EmscriptenOpenMPTModule>
) => Promise<EmscriptenOpenMPTModule>;
