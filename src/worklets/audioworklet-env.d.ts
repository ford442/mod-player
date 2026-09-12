/**
 * Ambient declarations for AudioWorkletGlobalScope.
 *
 * `tsconfig.worklet.json` compiles src/worklets/** with `lib: ["ES2020"]` and
 * **no DOM lib** — that is deliberate. AudioWorkletGlobalScope has no `window`,
 * `document`, `fetch`, `importScripts()` or dynamic `import()`, so anything the
 * processor is allowed to touch must be declared here explicitly. A DOM API that
 * sneaks into the processor is then a compile error instead of a runtime crash
 * on the audio thread.
 */

/** Audio-clock time of the current render quantum, in seconds. */
declare const currentTime: number;
/** Render quantum sample rate (44100 in practice). */
declare const sampleRate: number;

interface WorkletMessageEvent<T = unknown> {
  readonly data: T;
}

interface WorkletMessagePort {
  postMessage(message: unknown, transfer?: unknown[]): void;
  onmessage: ((event: WorkletMessageEvent) => void) | null;
  close(): void;
  start(): void;
}

interface AudioWorkletNodeOptions {
  numberOfInputs?: number;
  numberOfOutputs?: number;
  outputChannelCount?: number[];
  processorOptions?: unknown;
}

declare abstract class AudioWorkletProcessor {
  readonly port: WorkletMessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

/**
 * Chrome 116+ exposes timers in AudioWorkletGlobalScope; older browsers do not,
 * so openmpt-processor.ts installs a process()-driven polyfill before first use.
 */
declare function setTimeout(handler: () => void, timeout?: number): number;
declare function clearTimeout(id: number): void;

/** Often absent (or polyfilled from the frozen currentTime) inside the worklet. */
declare const performance: { now(): number };

/** Minimal console surface — the audio thread must stay off console I/O in production. */
declare const console: {
  log(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
};
