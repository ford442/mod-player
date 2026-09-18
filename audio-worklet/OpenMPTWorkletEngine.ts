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
    WorkletModuleMetadata,
    EngineState,
    EngineEventMap,
    EmscriptenOpenMPTModule,
    NativePcmChunk,
} from './types';
import { withBase } from '../src/lib/paths';
import { decodePositionInfo } from './positionInfoLayout';
import {
    installNativeAwJsModuleRewrite,
    resolveCreateOpenMPTModule,
    resolveEmscriptenRegisterAudioObject,
    withNativeWebAssembly,
    withPreservedMainThreadTimers,
} from './resolveNativeFactory';
import {
    nativeModuleFingerprint,
    type NativeModuleFingerprint,
} from '../utils/workletAudioLifecycle';
import {
    OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH,
    type OpenMPTInterpolationLength,
} from '../utils/openmptRenderParams';

export {
    OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH,
    type OpenMPTInterpolationLength,
};

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
export const NATIVE_PCM_CHUNK_FRAMES = 128;

/**
 * Map a native error string onto the engine's `error` event code.
 * Native messages are `ERR_CODE: human detail`; older builds have no string at
 * all, which stays the generic LOAD_FAILED.
 */
function nativeErrorCode(detail: string | null): string {
    const code = detail?.match(/^(ERR_[A-Z_]+)/)?.[1];
    return code ?? 'LOAD_FAILED';
}

function writeCString(mod: EmscriptenOpenMPTModule, text: string): number {
    const bytes = new TextEncoder().encode(text);
    const ptr = mod._malloc(bytes.length + 1);
    mod.HEAPU8.set(bytes, ptr);
    mod.HEAPU8[ptr + bytes.length] = 0;
    return ptr;
}

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

// PositionInfo layout: audio-worklet/positionInfoLayout.ts (must match cpp/openmpt_wrapper.h)

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
    /** When true, copy PCM out of the C++ ring each poll (pcmBus / Project-M). */
    private pcmCapture = false;
    private basePath: string;
    /** SharedArrayBuffer provided at construction (signals ring-buffer bridge intent). */
    private sharedOutputBuffer: SharedArrayBuffer | null;
    /** WASM heap byte offset of the allocated ring buffer (0 = not allocated). */
    private ringBufPtr = 0;
    /** True after attachAudioContext. */
    private audioAttached = false;
    private attachedContext: AudioContext | null = null;
    /** Fingerprint of the last successful load() — skip duplicate parse on play. */
    private loadedFingerprint: NativeModuleFingerprint | null = null;
    /** Last native error string (see getLastErrorMessage). */
    private lastErrorMessage: string | null = null;

    /**
     * @param options  Construction options, including an optional basePath and
     *                 sharedOutputBuffer for the ring-buffer bridge path.
     */
    constructor(options?: NativeEngineOptions) {
        super();
        this.basePath = options?.basePath ?? withBase('worklets/');
        this.sharedOutputBuffer = options?.sharedOutputBuffer ?? null;
    }

    getNativeModule(): EmscriptenOpenMPTModule | null {
        return this.module;
    }

    /**
     * Read and clear the native typed error string (ERR_OUT_OF_MEMORY,
     * ERR_UNSUPPORTED_MODULE, …). Returns null when the native build predates
     * the export or there is no pending error.
     */
    takeNativeError(): string | null {
        const get = this.module?._get_last_error;
        if (!this.module || typeof get !== 'function') return null;
        const ptr = get();
        if (!ptr) return null;
        const message = this.module.UTF8ToString(ptr);
        this.module._clear_last_error?.();
        this.lastErrorMessage = message || null;
        return this.lastErrorMessage;
    }

    /**
     * The most recent native error message, kept after `takeNativeError()` has
     * cleared it on the C++ side so a caller that only sees a null return from
     * `load()` can still report why.
     */
    getLastErrorMessage(): string | null {
        return this.lastErrorMessage;
    }

    /**
     * Release the transient main-thread metadata parse and hand the module to
     * the audio thread. Call it as soon as pattern extraction is done so only
     * one libopenmpt instance is ever resident (the 128mb heap is sized for one).
     * Idempotent — `play()` commits implicitly for hosts that never read patterns.
     */
    commitModule(): void {
        this.module?._commit_module?.();
    }

    /** Current engine state */
    get currentState(): EngineState { return this.state; }

    /** Whether the engine is ready for playback */
    get isReady(): boolean { return this.state === 'ready' || this.state === 'playing' || this.state === 'paused'; }

    /** Whether audio is currently playing */
    get isPlaying(): boolean { return this.state === 'playing'; }

    // ── Initialization ───────────────────────────────────────────────

    /**
     * Load the Emscripten glue + WASM. Does **not** create an AudioContext.
     * Call `attachAudioContext` on play with the one player AudioContext.
     */
    async init(_sampleRate = 0): Promise<void> {
        if (this.module) return; // Already initialized

        this.setState('initializing');

        try {
            const nativeUrl = withBase('worklets/openmpt-native.js');
            const glueModule = await import(/* @vite-ignore */ nativeUrl) as Record<string, unknown>;
            const createModule = resolveCreateOpenMPTModule(glueModule);

            if (!createModule) {
                throw new Error('Failed to load Emscripten module factory');
            }

            this.module = await withPreservedMainThreadTimers(() =>
                withNativeWebAssembly(() =>
                    createModule({
                        wasmBasePath: this.basePath,
                        locateFile: (path: string) => `${this.basePath}${path}`,
                    } as Partial<EmscriptenOpenMPTModule>),
                ),
            );

            installNativeAwJsModuleRewrite(this.basePath);
            this.setState('ready');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.setState('error');
            this.emit('error', { message, code: 'INIT_FAILED' });
            throw err;
        }
    }

    /**
     * Start the C++ AudioWorklet thread on `ctx` — the single player
     * AudioContext from `utils/audioContextFactory.ts`.
     *
     * Always `init_audio_with_context`: the engine never creates a context of
     * its own. (`init_audio()` remains a C++ export for the headless harness
     * only — see `cpp/worklet_processor.cpp`.)
     */
    async attachAudioContext(ctx: AudioContext): Promise<void> {
        if (!this.module) {
            throw new Error('Engine not initialized');
        }
        if (this.audioAttached) {
            this.attachedContext = ctx;
            return;
        }

        const register = resolveEmscriptenRegisterAudioObject(this.module);
        if (!register) {
            throw new Error(
                'emscriptenRegisterAudioObject is not exported — rebuild native with AUDIO_WORKLET runtime methods',
            );
        }
        const handle = register(ctx);
        const initWithCtx = this.module._init_audio_with_context;
        if (typeof initWithCtx !== 'function') {
            throw new Error('_init_audio_with_context missing from native WASM');
        }
        const result = initWithCtx(handle);
        if (!result) {
            throw new Error('Failed to initialize native AudioWorklet');
        }

        const readyDeadline = Date.now() + 8000;
        while (Date.now() < readyDeadline && this.module._get_worklet_node() === 0) {
            await new Promise((r) => setTimeout(r, 50));
        }
        if (this.module._get_worklet_node() === 0) {
            throw new Error('Native AudioWorklet thread failed to start');
        }

        // PCM ring is demand-driven (setPcmCapture). Writing
        // it every quantum on the audio thread contended with the mixer.
        this.startPolling();
        this.audioAttached = true;
        this.attachedContext = ctx;
    }

    private allocatePcmRing(): void {
        if (!this.module || this.ringBufPtr !== 0) return;
        if (typeof this.module._set_ring_buffer !== 'function') return;
        const frameCapacity = NATIVE_RING_BUF_FRAMES;
        const byteSize = 8 + frameCapacity * 2 * 4;
        const ptr = this.module._malloc(byteSize);
        if (!ptr) {
            console.warn('[OpenMPTWorkletEngine] _malloc failed for PCM ring buffer');
            return;
        }
        this.module.HEAPU8.fill(0, ptr, ptr + byteSize);
        this.module._set_ring_buffer(ptr, frameCapacity);
        this.ringBufPtr = ptr;
        console.log(
            '[OpenMPTWorkletEngine] PCM ring allocated at WASM ptr',
            ptr,
            '– capacity:',
            frameCapacity,
            'frames',
        );
    }

    getAttachedAudioContext(): AudioContext | null {
        return this.attachedContext;
    }

    isAudioAttached(): boolean {
        return this.audioAttached;
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
            // _load_module adopts ptr — do not _free it here (see types.ts).
            const result = this.module._load_module(ptr, uint8.length);

            if (!result) {
                const detail = this.takeNativeError();
                this.emit('error', {
                    message: detail ?? 'Invalid module format',
                    code: nativeErrorCode(detail),
                });
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

            this.loadedFingerprint = nativeModuleFingerprint(data);
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

                // _load_module adopts ptr — do not _free it here (see types.ts).
                const result = this.module._load_module(ptr, offset);

                if (!result) {
                    const detail = this.takeNativeError();
                    this.emit('error', {
                        message: detail ?? 'Invalid module format',
                        code: nativeErrorCode(detail),
                    });
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
        // No-op when the host already committed after pattern extraction.
        this.commitModule();
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

    /** Enable/disable the 16 ms HEAPF32 PCM copy (off unless a consumer exists). */
    setPcmCapture(enabled: boolean): void {
        this.pcmCapture = enabled;
        if (enabled) this.allocatePcmRing();
    }

    /** Last successful load fingerprint, or null if nothing has been loaded. */
    getLoadedFingerprint(): NativeModuleFingerprint | null {
        return this.loadedFingerprint;
    }

    /** Mute or unmute one tracker channel (libopenmpt interactive). */
    setChannelMute(channel: number, muted: boolean): void {
        this.module?._set_channel_mute(channel | 0, muted ? 1 : 0);
    }

    /** Interpolation filter length: 1=nearest, 2=linear, 4=cubic, 8=Sinc+LP. */
    setInterpolationLength(length: OpenMPTInterpolationLength): void {
        this.setRenderParam(OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH, length);
    }

    setRenderParam(param: number, value: number): void {
        this.module?._set_render_param(param | 0, value | 0);
    }

    /** Post-load ctl_set_text (e.g. play.at_end, render.resampler.emulate_amiga). */
    ctlSetText(key: string, value: string): void {
        const m = this.module;
        if (!m) return;
        const keyPtr = writeCString(m, key);
        const valPtr = writeCString(m, value);
        m._ctl_set_text(keyPtr, valPtr);
        m._free(keyPtr);
        m._free(valPtr);
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
     * Background: `init_audio_with_context()` starts the worklet thread asynchronously.
     * The node handle stored in `g_workletNode` (C++ side) is set by the
     * `worklet_thread_initialized` callback some milliseconds after attach
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

    // ── Cleanup ──────────────────────────────────────────────────────

    /** Destroy the engine and release all resources. */
    destroy(): void {
        this.stopPolling();
        this.module?._cleanup_audio();
        this.module = null;
        this.loadedFingerprint = null;
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

                // Pattern matrices are extracted once at module load
                // (parseModuleWithNative). Do not walk cells here — that was
                // rows×channels×6 WASM calls on the shared heap at every order
                // change, concurrent with the audio thread mixer.
                this.emit('position', data);
                if (this.pcmCapture) this.emitPcmChunk(data.sampleRate);

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

    private emitPcmChunk(sampleRateHint?: number): void {
        const chunk = this.copyPcmChunk(sampleRateHint);
        if (chunk) this.emit('pcm', chunk);
    }

    /**
     * Copy the last NATIVE_PCM_CHUNK_FRAMES stereo frames from the C++ ring.
     */
    copyPcmChunk(sampleRateHint?: number): NativePcmChunk | null {
        if (!this.module || this.ringBufPtr <= 0) return null;
        const writeHead = typeof this.module._get_ring_write_head === 'function'
            ? this.module._get_ring_write_head()
            : 0;
        const cap = NATIVE_RING_BUF_FRAMES;
        const frames = NATIVE_PCM_CHUNK_FRAMES;
        const samplesOffsetBytes = this.ringBufPtr + 8;
        const f32Index = samplesOffsetBytes / 4;
        const heap = this.module.HEAPF32;
        const out = new Float32Array(frames * 2);
        for (let i = 0; i < frames; i++) {
            const pos = (writeHead - frames + i + cap) % cap;
            const src = f32Index + pos * 2;
            out[i * 2] = heap[src] ?? 0;
            out[i * 2 + 1] = heap[src + 1] ?? 0;
        }
        const sampleRate = sampleRateHint
            || this.attachedContext?.sampleRate
            || 48000;
        return {
            buffer: out,
            channels: 2,
            sampleRate,
            samplesPerChannel: frames,
        };
    }

    /**
     * Read position data from the C++ shared-memory struct.
     */
    private pollPositionOnce(): WorkletPositionData | null {
        if (!this.module) return null;

        const ptr = this.module._poll_position();
        if (!ptr) return null;

        const view = new DataView(this.module.HEAPU8.buffer);
        return decodePositionInfo(view, ptr, {
            bufferByteLength: this.module.HEAPU8.byteLength,
        });
    }
}
