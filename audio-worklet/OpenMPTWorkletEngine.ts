/**
 * OpenMPTWorkletEngine.ts – TypeScript wrapper for the C++/Wasm AudioWorklet.
 *
 * This class provides a clean, typed API for the React application to
 * control the Emscripten-compiled AudioWorklet processor. It handles:
 *   - Loading the WASM module
 *   - Sending module data and control commands to the C++ worklet
 *   - Polling position/VU data from shared memory
 *   - Providing an event-driven interface for the UI
 *
 * Usage:
 *   const engine = new OpenMPTWorkletEngine();
 *   await engine.init();
 *   await engine.load(arrayBuffer);
 *   engine.play();
 *   engine.on('position', (data) => { ... });
 */

import type {
    WorkletPositionData,
    WorkletPatternData,
    WorkletModuleMetadata,
    EngineState,
    EngineEventMap,
    EmscriptenOpenMPTModule,
    CreateOpenMPTModule,
} from './types';

// ── Public constants ─────────────────────────────────────────────────

/**
 * Default ring buffer capacity (stereo frames).
 * 8 192 frames at 48 kHz ≈ 170 ms — large enough to absorb scheduling jitter
 * while keeping latency well below a perceptible threshold.
 */
export const NATIVE_RING_BUF_FRAMES = 8192;

/**
 * Total byte size required for one ring buffer allocation:
 *   8 B header  (writeHead Int32 + readHead Int32)
 * + NATIVE_RING_BUF_FRAMES × 2 channels × 4 B  (interleaved Float32 stereo)
 */
export const NATIVE_RING_BUF_BYTES = 8 + NATIVE_RING_BUF_FRAMES * 2 * 4; // 65 544 B

// ── Construction options ──────────────────────────────────────────────

/**
 * Options accepted by the OpenMPTWorkletEngine constructor.
 */
export interface NativeEngineOptions {
    /** Base URL path for WASM assets (e.g. '/xm-player/worklets/'). */
    basePath?: string;

    /**
     * Pre-allocated SharedArrayBuffer that the caller wants to use as the audio
     * output ring buffer.  The engine will allocate an equivalently-sized buffer
     * inside WASM linear memory (which IS a SharedArrayBuffer in cross-origin-
     * isolated contexts) and expose it via getWasmMemory() / getRingBufByteOffset().
     *
     * Providing this value signals that the caller supports the ring-buffer bridge
     * path and has already verified window.crossOriginIsolated === true.
     *
     * Recommended size: NATIVE_RING_BUF_BYTES.
     */
    sharedOutputBuffer?: SharedArrayBuffer;
}

// ── Internal constants ───────────────────────────────────────────────

const MAX_VU_CHANNELS = 32;

// Byte offsets within the PositionInfo struct (must match C++ layout)
// struct PositionInfo {
//   double positionMs;      // offset 0, 8 bytes
//   int    currentRow;      // offset 8, 4 bytes
//   int    currentPattern;  // offset 12, 4 bytes
//   int    currentOrder;    // offset 16, 4 bytes
//   double bpm;             // offset 24, 8 bytes (aligned to 8)
//   int    numChannels;     // offset 32, 4 bytes
//   float  channelVU[32];   // offset 36, 128 bytes
// };
// Total: 164 bytes (with alignment padding)

const POS_OFFSET_POSITION_MS    = 0;
const POS_OFFSET_CURRENT_ROW    = 8;
const POS_OFFSET_CURRENT_PATTERN = 12;
const POS_OFFSET_CURRENT_ORDER  = 16;
const POS_OFFSET_BPM            = 24;
const POS_OFFSET_NUM_CHANNELS   = 32;
const POS_OFFSET_CHANNEL_VU     = 36;

// ── EventEmitter ─────────────────────────────────────────────────────

type Listener<T> = (data: T) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
class MiniEventEmitter<Events extends { [key: string]: any }> {
    private listeners = new Map<keyof Events, Set<Listener<unknown>>>();

    on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(fn as Listener<unknown>);
    }

    off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
        this.listeners.get(event)?.delete(fn as Listener<unknown>);
    }

    protected emit<K extends keyof Events>(event: K, data: Events[K]): void {
        this.listeners.get(event)?.forEach(fn => fn(data));
    }

    removeAllListeners(): void {
        this.listeners.clear();
    }
}

// ── Engine ────────────────────────────────────────────────────────────

export class OpenMPTWorkletEngine extends MiniEventEmitter<EngineEventMap> {
    private module: EmscriptenOpenMPTModule | null = null;
    private state: EngineState = 'uninitialized';
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private lastRow = -1;
    private lastPatternOrder = -1;
    private basePath: string;
    /** SharedArrayBuffer provided at construction (signals ring-buffer bridge intent). */
    private sharedOutputBuffer: SharedArrayBuffer | null;
    /** WASM heap byte offset of the allocated ring buffer (0 = not allocated). */
    private ringBufPtr = 0;

    /**
     * @param options  Construction options, including an optional basePath and
     *                 sharedOutputBuffer for the ring-buffer bridge path.
     */
    constructor(options?: NativeEngineOptions) {
        super();
        // Default to Vite's BASE_URL + worklets/
        this.basePath = options?.basePath ?? `${import.meta.env.BASE_URL}worklets/`;
        this.sharedOutputBuffer = options?.sharedOutputBuffer ?? null;
    }

    /** Current engine state */
    get currentState(): EngineState { return this.state; }

    /** Whether the engine is ready for playback */
    get isReady(): boolean { return this.state === 'ready' || this.state === 'playing' || this.state === 'paused'; }

    /** Whether audio is currently playing */
    get isPlaying(): boolean { return this.state === 'playing'; }

    // ── Initialization ───────────────────────────────────────────────

    /**
     * Load the Emscripten module and initialize the AudioContext + worklet thread.
     * Must be called once before any other methods.
     */
    async init(sampleRate = 0): Promise<void> {
        if (this.module) return; // Already initialized

        this.setState('initializing');

        try {
            // Dynamically import the Emscripten glue code.
            // IMPORTANT: Use absolute paths rooted at BASE_URL so the browser
            // fetches from /worklets/, not from /assets/ (where the Vite bundle lives).
            // The /* @vite-ignore */ comment prevents Vite from rewriting these imports.
            //
            // ⚠️  NEVER import() an AudioWorklet processor script (e.g. openmpt-worklet.js)
            //     on the main thread — it references AudioWorkletProcessor which only exists
            //     inside AudioWorkletGlobalScope. See docs/WORKLET_AUDIO_BUG.md.
            let glueModule: Record<string, unknown>;
            // The JS worklet processor (openmpt-worklet.js) references AudioWorkletProcessor
            // and cannot be imported on the main thread. Only try the native Emscripten glue.
            const nativeUrl = `${import.meta.env.BASE_URL}worklets/openmpt-native.js`;
            glueModule = await import(/* @vite-ignore */ nativeUrl) as Record<string, unknown>;
            const createModule = (glueModule.default || glueModule['createOpenMPTModule']) as CreateOpenMPTModule;

            if (typeof createModule !== 'function') {
                throw new Error('Failed to load Emscripten module factory');
            }

            // Instantiate with WASM file path override
            this.module = await createModule({
                locateFile: (path: string) => `${this.basePath}${path}`,
            } as Partial<EmscriptenOpenMPTModule>);

            // Initialize audio context and worklet thread
            const result = this.module._init_audio(sampleRate);
            if (!result) {
                throw new Error('Failed to initialize AudioContext');
            }

            // If a shared output buffer was requested AND the WASM module supports
            // the ring-buffer API, allocate a ring buffer inside WASM linear memory.
            // WASM memory is itself a SharedArrayBuffer (in cross-origin-isolated
            // contexts), so the bridge worklet can read from it via Atomics.
            if (this.sharedOutputBuffer && typeof this.module._set_ring_buffer === 'function') {
                const frameCapacity = NATIVE_RING_BUF_FRAMES;
                const byteSize = 8 + frameCapacity * 2 * 4; // header + samples
                const ptr = this.module._malloc(byteSize);
                if (ptr) {
                    // Zero-initialise header (writeHead + readHead) and sample area
                    this.module.HEAPU8.fill(0, ptr, ptr + byteSize);
                    this.module._set_ring_buffer(ptr, frameCapacity);
                    this.ringBufPtr = ptr;
                    console.log('[OpenMPTWorkletEngine] Ring buffer allocated at WASM ptr', ptr,
                        '– capacity:', frameCapacity, 'frames');
                } else {
                    console.warn('[OpenMPTWorkletEngine] _malloc failed for ring buffer');
                }
            }

            // Start polling for position data
            this.startPolling();

            this.setState('ready');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.setState('error');
            this.emit('error', { message, code: 'INIT_FAILED' });
            throw err;
        }
    }

    // ── Module loading ───────────────────────────────────────────────

    /**
     * Load a tracker module from an ArrayBuffer.
     * @param data  Module file data (.mod, .xm, .s3m, .it, etc.)
     * @returns Metadata about the loaded module
     */
    async load(data: ArrayBuffer): Promise<WorkletModuleMetadata | null> {
        if (!this.module) {
            this.emit('error', { message: 'Engine not initialized', code: 'NOT_INIT' });
            return null;
        }

        try {
            const uint8 = new Uint8Array(data);
            const ptr = this.module._malloc(uint8.length);
            if (!ptr) throw new Error('Failed to allocate WASM memory');

            this.module.HEAPU8.set(uint8, ptr);
            const result = this.module._load_module(ptr, uint8.length);
            this.module._free(ptr);

            if (!result) {
                this.emit('error', { message: 'Invalid module format', code: 'LOAD_FAILED' });
                return null;
            }

            // Module metadata will be available after the worklet thread processes the load
            // For now, return a placeholder that gets filled in via position polling
            const metadata: WorkletModuleMetadata = {
                title: '',
                numOrders: 0,
                numPatterns: 0,
                numChannels: 0,
                durationSeconds: 0,
                initialBpm: 0,
            };

            this.emit('loaded', metadata);
            return metadata;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.emit('error', { message, code: 'LOAD_ERROR' });
            return null;
        }
    }

    /**
     * Load a module from a URL.
     */
    async loadFromURL(url: string): Promise<WorkletModuleMetadata | null> {
        if (!this.module) {
            this.emit('error', { message: 'Engine not initialized', code: 'NOT_INIT' });
            return null;
        }

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

            const contentLength = response.headers.get('content-length');
            const totalSize = contentLength ? parseInt(contentLength, 10) : 0;

            if (totalSize > 0 && response.body) {
                // Pre-allocate exactly on the WASM heap to avoid intermediate ArrayBuffer allocation and GC spikes
                const ptr = this.module._malloc(totalSize);
                if (!ptr) throw new Error('Failed to allocate WASM memory');

                const reader = response.body.getReader();
                let offset = 0;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                        this.module.HEAPU8.set(value, ptr + offset);
                        offset += value.length;
                    }
                }

                const result = this.module._load_module(ptr, offset);
                this.module._free(ptr);

                if (!result) {
                    this.emit('error', { message: 'Invalid module format', code: 'LOAD_FAILED' });
                    return null;
                }

                // Module metadata will be available after the worklet thread processes the load
                // For now, return a placeholder that gets filled in via position polling
                const metadata: WorkletModuleMetadata = {
                    title: '',
                    numOrders: 0,
                    numPatterns: 0,
                    numChannels: 0,
                    durationSeconds: 0,
                    initialBpm: 0,
                };

                this.emit('loaded', metadata);
                return metadata;
            } else {
                // Fallback for servers without Content-Length
                const data = await response.arrayBuffer();
                return this.load(data);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.emit('error', { message, code: 'FETCH_ERROR' });
            return null;
        }
    }

    // ── Playback control ─────────────────────────────────────────────

    /** Resume/start playback. Requires a user gesture on first call. */
    play(): void {
        if (!this.module) return;
        this.module._resume_audio();
        this.setState('playing');
    }

    /** Pause playback. */
    pause(): void {
        if (!this.module) return;
        this.module._suspend_audio();
        this.setState('paused');
    }

    /** Seek to a specific order + row. */
    seek(order: number, row: number): void {
        this.module?._seek_order_row(order, row);
    }

    /** Seek to a position in milliseconds. */
    seekMs(_ms: number): void {
        // Convert ms to seconds and use the seconds-based seek
        // This requires the C++ side to support it; for now, order/row seek
        // is the primary method.
        console.warn('[OpenMPTWorkletEngine] seekMs() not yet implemented in C++ side; use seek(order, row)');
    }

    /** Set playback volume (0.0 – 1.0). */
    setVolume(vol: number): void {
        this.module?._set_volume(Math.max(0, Math.min(1, vol)));
    }

    /** Set loop mode. */
    setLoop(loop: boolean): void {
        this.module?._set_loop(loop ? 1 : 0);
    }

    // ── Position queries ─────────────────────────────────────────────

    /** Get last known position data (from polling). */
    getPosition(): WorkletPositionData | null {
        return this.pollPositionOnce();
    }

    /** Get current playback row. */
    getCurrentRow(): number {
        const pos = this.pollPositionOnce();
        return pos?.currentRow ?? 0;
    }

    /** Get current pattern index. */
    getCurrentPattern(): number {
        const pos = this.pollPositionOnce();
        return pos?.currentPattern ?? 0;
    }

    /** Get current BPM. */
    getBPM(): number {
        const pos = this.pollPositionOnce();
        return pos?.bpm ?? 0;
    }

    // ── Audio graph access ───────────────────────────────────────────

    /**
     * Get the underlying AudioContext handle.
     * Useful for connecting analyser nodes, etc.
     */
    getAudioContextHandle(): number {
        return this.module?._get_audio_context() ?? 0;
    }

    /**
     * Get the AudioWorkletNode handle.
     * Can be used with emscriptenGetAudioObject() on the JS side.
     */
    getWorkletNodeHandle(): number {
        return this.module?._get_worklet_node() ?? 0;
    }

    // ── Bridge / routing helpers ─────────────────────────────────────

    /**
     * Returns the SharedArrayBuffer provided at construction, or null.
     * This is the "intent" buffer; the actual ring buffer lives in WASM memory
     * (see getWasmMemory() / getRingBufByteOffset()).
     */
    getSharedOutputBuffer(): SharedArrayBuffer | null {
        return this.sharedOutputBuffer;
    }

    /**
     * Returns the WASM linear memory as a SharedArrayBuffer.
     * Available only when the page is cross-origin isolated and the WASM module
     * was compiled with -sWASM_WORKERS=1 (shared memory required).
     * Returns null if the buffer is not a SharedArrayBuffer (non-isolated context).
     */
    getWasmMemory(): SharedArrayBuffer | null {
        if (!this.module) return null;
        const buf = this.module.HEAPU8.buffer;
        return buf instanceof SharedArrayBuffer ? buf : null;
    }

    /**
     * Returns the byte offset within WASM linear memory where the ring buffer
     * header begins.  Zero means the ring buffer was not allocated (either
     * sharedOutputBuffer was not provided, or _set_ring_buffer is unavailable
     * in the current WASM build).
     */
    getRingBufByteOffset(): number {
        return this.ringBufPtr;
    }

    /**
     * Waits for the C++ worklet thread to create its AudioWorkletNode and returns it.
     *
     * Background: `init_audio()` starts the worklet thread asynchronously.
     * The node handle stored in `g_workletNode` (C++ side) is set by the
     * `worklet_thread_initialized` callback some milliseconds after `init_audio()`
     * returns.  This method polls until the handle is non-zero.
     *
     * @param timeoutMs  Maximum wait time in milliseconds (default 5 000).
     * @returns          The AudioWorkletNode, or null on timeout.
     */
    async getOutputNode(timeoutMs = 5000): Promise<AudioWorkletNode | null> {
        if (!this.module) return null;

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const handle = this.module._get_worklet_node();
            if (handle) {
                const fn = this.module.emscriptenGetAudioObject;
                if (typeof fn === 'function') {
                    return fn(handle) as AudioWorkletNode | null;
                }
                // emscriptenGetAudioObject not available in this build
                console.warn('[OpenMPTWorkletEngine] emscriptenGetAudioObject not available');
                return null;
            }
            await new Promise<void>(r => setTimeout(r, 50));
        }
        console.warn('[OpenMPTWorkletEngine] getOutputNode() timed out after', timeoutMs, 'ms');
        return null;
    }

    /**
     * Bridge the native engine's AudioWorkletNode to an external audio graph via
     * a MediaStream.  This allows the C++ engine (which runs on its own AudioContext)
     * to feed audio through the main-thread GainNode / AnalyserNode chain.
     *
     * Flow:
     *   C++ AudioWorkletNode
     *     → MediaStreamDestinationNode  (on C++ AudioContext)
     *     → MediaStream (audio track)
     *     → MediaStreamAudioSourceNode  (on mainCtx)
     *     → destNode  (e.g. AnalyserNode on mainCtx)
     *
     * @param mainCtx   Main-thread AudioContext to create the source node on.
     * @param destNode  First node in the main-thread chain (typically AnalyserNode).
     * @returns         The MediaStreamAudioSourceNode, or null on failure.
     */
    async bridgeToAudioGraph(
        mainCtx: AudioContext,
        destNode: AudioNode,
    ): Promise<MediaStreamAudioSourceNode | null> {
        if (!this.module) return null;

        // Wait for the worklet thread to produce a node handle
        const cppNode = await this.getOutputNode(3000);
        if (!cppNode) {
            console.warn('[OpenMPTWorkletEngine] bridgeToAudioGraph: getOutputNode() timed out');
            return null;
        }

        const ctxHandle = this.module._get_audio_context();
        if (!ctxHandle || typeof this.module.emscriptenGetAudioObject !== 'function') {
            console.warn('[OpenMPTWorkletEngine] bridgeToAudioGraph: cannot resolve C++ AudioContext');
            return null;
        }

        const cppCtx = this.module.emscriptenGetAudioObject(ctxHandle) as AudioContext | null;
        if (!cppCtx || typeof cppCtx.createMediaStreamDestination !== 'function') {
            console.warn('[OpenMPTWorkletEngine] bridgeToAudioGraph: C++ AudioContext not resolvable');
            return null;
        }

        // disconnect() throws InvalidStateError if the node is already disconnected.
        // That is expected and harmless here — the caller may have disconnected it already.
        try { cppNode.disconnect(); } catch (_e) { /* node not connected — safe to ignore */ }

        // Route via MediaStream so the audio crosses AudioContext boundaries
        const mediaDest = cppCtx.createMediaStreamDestination();
        cppNode.connect(mediaDest);

        const mediaSrc = mainCtx.createMediaStreamSource(mediaDest.stream);
        mediaSrc.connect(destNode);

        console.log('[OpenMPTWorkletEngine] MediaStream bridge established: C++ → MediaStream → main graph');
        return mediaSrc;
    }

    // ── Cleanup ──────────────────────────────────────────────────────

    /** Destroy the engine and release all resources. */
    destroy(): void {
        this.stopPolling();
        this.module?._cleanup_audio();
        this.module = null;
        this.setState('uninitialized');
        this.removeAllListeners();
    }

    // ── Internal helpers ─────────────────────────────────────────────

    private setState(state: EngineState): void {
        if (this.state === state) return;
        this.state = state;
        this.emit('statechange', state);
    }

    /**
     * Start polling the shared-memory position buffer from the worklet.
     * Runs at ~60fps via setInterval(16).
     */
    private startPolling(): void {
        if (this.pollTimer) return;
        this.pollTimer = setInterval(() => {
            const data = this.pollPositionOnce();
            if (data) {
                // Check for "ended" sentinel
                if (data.currentRow === -1) {
                    this.emit('ended', undefined as unknown as void);
                    this.setState('paused');
                    return;
                }

                // Attach pattern data when the order (pattern) changes
                if (data.currentOrder !== this.lastPatternOrder) {
                    this.lastPatternOrder = data.currentOrder;
                    const patternData = this.readPatternData(data.currentPattern, data.numChannels);
                    if (patternData) {
                        data.patternData = patternData;
                    }
                }

                this.emit('position', data);

                // Detect row change for higher-frequency updates
                if (data.currentRow !== this.lastRow) {
                    this.lastRow = data.currentRow;
                }
            }
        }, 16);
    }

    private stopPolling(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * Read all cell commands for the given pattern from C++ WASM memory
     * and return a structured WorkletPatternData object.
     * Returns null when the module or pattern data functions are unavailable.
     */
    private readPatternData(patternIndex: number, numChannels: number): WorkletPatternData | null {
        const m = this.module;
        if (!m || typeof m._get_pattern_num_rows !== 'function') return null;

        const numRows = m._get_pattern_num_rows(patternIndex);
        if (numRows <= 0) return null;

        const rows = [];
        for (let r = 0; r < numRows; r++) {
            const notes: number[]        = [];
            const instruments: number[]  = [];
            const volCmds: number[]      = [];
            const volVals: number[]      = [];
            const effCmds: number[]      = [];
            const effVals: number[]      = [];
            for (let c = 0; c < numChannels; c++) {
                notes.push(m._get_pattern_row_channel_command(patternIndex, r, c, 0));
                instruments.push(m._get_pattern_row_channel_command(patternIndex, r, c, 1));
                volCmds.push(m._get_pattern_row_channel_command(patternIndex, r, c, 2));
                volVals.push(m._get_pattern_row_channel_command(patternIndex, r, c, 3));
                effCmds.push(m._get_pattern_row_channel_command(patternIndex, r, c, 4));
                effVals.push(m._get_pattern_row_channel_command(patternIndex, r, c, 5));
            }
            rows.push({ notes, instruments, volCmds, volVals, effCmds, effVals });
        }

        return { patternIndex, numRows, numChannels, rows };
    }

    /**
     * Read position data from the C++ shared-memory struct.
     */
    private pollPositionOnce(): WorkletPositionData | null {
        if (!this.module) return null;

        const ptr = this.module._poll_position();
        if (!ptr) return null;

        // Read fields from the PositionInfo struct in WASM memory
        const view = new DataView(this.module.HEAPU8.buffer);

        const positionMs     = view.getFloat64(ptr + POS_OFFSET_POSITION_MS, true);
        const currentRow     = view.getInt32(ptr + POS_OFFSET_CURRENT_ROW, true);
        const currentPattern = view.getInt32(ptr + POS_OFFSET_CURRENT_PATTERN, true);
        const currentOrder   = view.getInt32(ptr + POS_OFFSET_CURRENT_ORDER, true);
        const bpm            = view.getFloat64(ptr + POS_OFFSET_BPM, true);
        const numChannels    = view.getInt32(ptr + POS_OFFSET_NUM_CHANNELS, true);

        // Read channel VU array
        const vuCount = Math.min(numChannels, MAX_VU_CHANNELS);
        const channelVU = new Float32Array(MAX_VU_CHANNELS);
        for (let i = 0; i < vuCount; i++) {
            channelVU[i] = view.getFloat32(ptr + POS_OFFSET_CHANNEL_VU + i * 4, true);
        }

        return {
            positionMs,
            currentRow,
            currentPattern,
            currentOrder,
            bpm,
            numChannels,
            channelVU,
        };
    }
}
