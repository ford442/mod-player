/**
 * The JS AudioWorklet postMessage protocol, declared once (#492).
 *
 * Message-type strings *and* every message's fields live here. Both validators are generated from
 * this table, so they cannot drift apart:
 *
 *   - main thread: zod schemas (audio-worklet/protocol.ts, `zodFromTable`);
 *   - worklet:     a tiny allocation-free guard (audio-worklet/workletProtocolGuard.ts), bundled into
 *                  public/worklets/openmpt-worklet.js by esbuild (scripts/build-js-worklet.mjs).
 *
 * tests/workletProtocolParity.test.ts runs every message type, valid and broken, through both.
 * Keep this file DOM-free and import-free: it is part of the AudioWorkletGlobalScope bundle.
 */

/** Main thread → AudioWorklet processor */
export const MAIN_TO_WORKLET = {
  initLib: 'initLib',
  load: 'load',
  play: 'play',
  pause: 'pause',
  seek: 'seek',
  getOscBuffer: 'getOscBuffer',
  setAudioLite: 'setAudioLite',
  setProjectmPcm: 'setProjectmPcm',
  setAudioDiag: 'setAudioDiag',
  setChannelMute: 'setChannelMute',
  setRenderParam: 'setRenderParam',
  ctlSetText: 'ctlSetText',
  /** Hands a consumed projectm-pcm buffer back to the worklet's allocation pool. */
  returnPcmBuffer: 'returnPcmBuffer',
  /** Shared position/VU ring (audio-worklet/positionRing.ts); replaces `position` messages when sent. */
  setPositionRing: 'setPositionRing',
  /** Hands the worklet its end of the create-worker channel (#513). */
  attachCreatePort: 'attachCreatePort',
} as const;

/** AudioWorklet processor → main thread */
export const WORKLET_TO_MAIN = {
  position: 'position',
  loaded: 'loaded',
  ended: 'ended',
  seekAck: 'seekAck',
  error: 'error',
  oscBuffer: 'oscBuffer',
  needData: 'needData',
  starvation: 'starvation',
  projectmPcm: 'projectm-pcm',
  audioDiag: 'audioDiag',
  /** The worklet's libopenmpt is the shared-memory playback heap: memory + a stack for the create worker (#513). */
  createHeap: 'createHeap',
} as const;

export type MainToWorkletType = (typeof MAIN_TO_WORKLET)[keyof typeof MAIN_TO_WORKLET];
export type WorkletToMainType = (typeof WORKLET_TO_MAIN)[keyof typeof WORKLET_TO_MAIN];

export const ALL_MAIN_TO_WORKLET_TYPES = Object.values(MAIN_TO_WORKLET);
export const ALL_WORKLET_TO_MAIN_TYPES = Object.values(WORKLET_TO_MAIN);

/** Per-channel VU slots the JS worklet reports (IT / MPTM go up to 64 channels). */
export const MAX_VU_CHANNELS = 64;

/** Minimum size of the `oscBuffer` SharedArrayBuffer: (OSC_SAMPLE_COUNT + AUDIO_REACTIVE_FLOATS) × 4. */
export const OSC_BUFFER_MIN_BYTES = (2048 + 16) * 4;

// ── Field table ────────────────────────────────────────────────────────────────────────────────

/** The value kinds a field can have. Both validators implement exactly these, nothing else. */
export type FieldKind =
  /** Safe integer ≥ 0. */
  | 'nonNegInt'
  /** Finite number (no NaN / ±Infinity). */
  | 'finite'
  | 'boolean'
  | 'string'
  | 'nonEmptyString'
  | 'arrayBuffer'
  /** ArrayBuffer or Uint8Array (module bytes). */
  | 'modulePayload'
  | 'float32Array'
  | 'sharedArrayBuffer'
  /** Array of finite numbers, at most `maxLength` long. */
  | 'finiteArray'
  /** 1 or 2. */
  | 'pcmChannels'
  /** Safe integer > 0. */
  | 'positiveInt'
  /**
   * A MessagePort. Duck-typed (`postMessage` is a function): a port transferred into the worklet
   * realm is not `instanceof MessagePort` of the realm that built the message.
   */
  | 'messagePort'
  /** `WebAssembly.Memory` (the shared playback heap). */
  | 'wasmMemory';

export interface FieldSpec {
  readonly kind: FieldKind;
  /** May be absent (or `undefined`). `null` is never "absent". */
  readonly optional?: true;
  /** `finiteArray`: maximum length. */
  readonly maxLength?: number;
  /** `sharedArrayBuffer`: minimum byteLength. */
  readonly minBytes?: number;
}

export interface MessageSpec {
  readonly fields: { readonly [field: string]: FieldSpec };
  /** Unknown fields are kept (diagnostic messages carry free-form extras). Otherwise they are dropped. */
  readonly passthrough?: true;
}

const req = <K extends FieldKind>(kind: K) => ({ kind }) as const;
const opt = <K extends FieldKind>(kind: K) => ({ kind, optional: true }) as const;

/** Every main → worklet message, keyed by its `type`. */
export const MAIN_TO_WORKLET_SPEC = {
  [MAIN_TO_WORKLET.initLib]: {
    fields: { scriptText: req('nonEmptyString'), wasmBytes: opt('arrayBuffer') },
  },
  [MAIN_TO_WORKLET.load]: { fields: { moduleData: req('modulePayload') } },
  [MAIN_TO_WORKLET.play]: { fields: {} },
  [MAIN_TO_WORKLET.pause]: { fields: {} },
  [MAIN_TO_WORKLET.seek]: {
    fields: { order: req('nonNegInt'), row: req('nonNegInt'), timestamp: opt('finite') },
  },
  [MAIN_TO_WORKLET.getOscBuffer]: { fields: {} },
  [MAIN_TO_WORKLET.setAudioLite]: { fields: { lite: req('boolean') } },
  [MAIN_TO_WORKLET.setProjectmPcm]: { fields: { enabled: req('boolean') } },
  [MAIN_TO_WORKLET.setAudioDiag]: { fields: { enabled: req('boolean') } },
  [MAIN_TO_WORKLET.setChannelMute]: { fields: { channel: req('nonNegInt'), muted: req('boolean') } },
  [MAIN_TO_WORKLET.setRenderParam]: { fields: { param: req('finite'), value: req('finite') } },
  [MAIN_TO_WORKLET.ctlSetText]: { fields: { key: req('string'), value: req('string') } },
  [MAIN_TO_WORKLET.returnPcmBuffer]: { fields: { buffer: req('float32Array') } },
  [MAIN_TO_WORKLET.setPositionRing]: { fields: { buffer: req('sharedArrayBuffer') } },
  [MAIN_TO_WORKLET.attachCreatePort]: { fields: { port: req('messagePort') } },
} as const satisfies Record<MainToWorkletType, MessageSpec>;

/** The pre-`type` load shim some callers still send: `{ moduleData }`. */
export const LEGACY_LOAD_SPEC = { fields: { moduleData: req('modulePayload') } } as const satisfies MessageSpec;

/** Every worklet → main message, keyed by its `type`. */
export const WORKLET_TO_MAIN_SPEC = {
  [WORKLET_TO_MAIN.position]: {
    fields: {
      order: req('nonNegInt'),
      row: req('nonNegInt'),
      rowFraction: opt('finite'),
      positionSeconds: req('finite'),
      bpm: req('finite'),
      speed: opt('finite'),
      /** Audio timeline of the pre-render snapshot (preferred name). */
      audioTime: opt('finite'),
      /** Alias of audioTime kept for older handlers. */
      workletTime: opt('finite'),
      samplesWritten: opt('nonNegInt'),
      sampleRate: opt('finite'),
      channelVU: { kind: 'finiteArray', optional: true, maxLength: MAX_VU_CHANNELS },
    },
  },
  [WORKLET_TO_MAIN.loaded]: { fields: {} },
  [WORKLET_TO_MAIN.ended]: { fields: {} },
  [WORKLET_TO_MAIN.seekAck]: { fields: {} },
  [WORKLET_TO_MAIN.error]: {
    fields: {
      message: req('string'),
      /** process() caught a wasm trap and silenced output: the node needs a restart. */
      fatal: opt('boolean'),
    },
  },
  [WORKLET_TO_MAIN.oscBuffer]: {
    fields: { buffer: { kind: 'sharedArrayBuffer', minBytes: OSC_BUFFER_MIN_BYTES } },
  },
  [WORKLET_TO_MAIN.needData]: { fields: {}, passthrough: true },
  [WORKLET_TO_MAIN.starvation]: { fields: {}, passthrough: true },
  [WORKLET_TO_MAIN.projectmPcm]: {
    fields: {
      buffer: req('float32Array'),
      channels: req('pcmChannels'),
      sampleRate: opt('finite'),
      samplesPerChannel: opt('nonNegInt'),
    },
  },
  [WORKLET_TO_MAIN.audioDiag]: {
    fields: {
      budgetMs: req('finite'),
      quanta: req('nonNegInt'),
      avgProcessMs: req('finite'),
      maxProcessMs: req('finite'),
      overruns: req('nonNegInt'),
      wraps: req('nonNegInt'),
      wrapMaxProcessMs: req('finite'),
      wrapOverruns: req('nonNegInt'),
      order: req('nonNegInt'),
      row: req('nonNegInt'),
      audioTime: opt('finite'),
      /** Quantum that set maxProcessMs in this window (not necessarily the wrap). */
      slowMs: opt('finite'),
      slowOrder: opt('nonNegInt'),
      slowRow: opt('nonNegInt'),
      pcmEnabled: opt('boolean'),
      audioLite: opt('boolean'),
      /** First wrap windows' maxProcessMs (session; wrap-0 vs wrap-N). */
      wrapProcessMs: opt('finiteArray'),
      /** Worst scheduling gap in this window (late callback), ms. */
      maxCallbackGapMs: opt('finite'),
      heapBytes: opt('nonNegInt'),
      heapMoves: opt('nonNegInt'),
      playingChannels: opt('nonNegInt'),
      /** Worst wall-clock gap between two process() calls (ms) — a blocked audio thread shows here. */
      maxWallGapMs: opt('finite'),
      /** Worst audio-thread time spent bringing in a module this window (ms). */
      loadBlockMs: opt('finite'),
      /** Loads are created on the create worker, not this thread (#513). */
      createThread: opt('boolean'),
    },
  },
  [WORKLET_TO_MAIN.createHeap]: {
    fields: {
      memory: req('wasmMemory'),
      /** Stable per heap (per AudioWorkletGlobalScope); the Memory object itself is a new wrapper per message. */
      heapId: req('positiveInt'),
      stackLow: req('nonNegInt'),
      stackSize: req('nonNegInt'),
    },
  },
} as const satisfies Record<WorkletToMainType, MessageSpec>;

// ── Message types, derived from the table ─────────────────────────────────────────────────────

interface FieldKindTypes {
  nonNegInt: number;
  finite: number;
  boolean: boolean;
  string: string;
  nonEmptyString: string;
  arrayBuffer: ArrayBuffer;
  modulePayload: ArrayBuffer | Uint8Array;
  float32Array: Float32Array<ArrayBuffer>;
  sharedArrayBuffer: SharedArrayBuffer;
  finiteArray: number[];
  pcmChannels: 1 | 2;
  positiveInt: number;
  /**
   * Structural, not `MessagePort` / `WebAssembly.Memory`: this file is also type-checked in the
   * worklet project, whose lib is ES2022 only. A real MessagePort / Memory is assignable.
   */
  messagePort: { postMessage(message: unknown, transfer?: unknown[]): void };
  wasmMemory: { buffer: ArrayBufferLike };
}

type Fields = MessageSpec['fields'];
type RequiredKeys<F extends Fields> = {
  [K in keyof F]: F[K] extends { readonly optional: true } ? never : K;
}[keyof F];
type OptionalKeys<F extends Fields> = Exclude<keyof F, RequiredKeys<F>>;
type Flatten<T> = { [K in keyof T]: T[K] };

/** The TypeScript type of one message, read off its table entry. */
export type MessageOf<T extends string, S extends MessageSpec> = Flatten<
  { type: T }
  & { [K in RequiredKeys<S['fields']>]: FieldKindTypes[S['fields'][K]['kind']] }
  & { [K in OptionalKeys<S['fields']>]?: FieldKindTypes[S['fields'][K]['kind']] }
>;

type MainSpec = typeof MAIN_TO_WORKLET_SPEC;
type WorkletSpec = typeof WORKLET_TO_MAIN_SPEC;

export type MainToWorkletMessage = { [T in keyof MainSpec & string]: MessageOf<T, MainSpec[T]> }[keyof MainSpec & string];
export type WorkletToMainMessage = { [T in keyof WorkletSpec & string]: MessageOf<T, WorkletSpec[T]> }[keyof WorkletSpec & string];
export type LegacyLoadMessage = Flatten<{ type?: undefined } & { moduleData: FieldKindTypes['modulePayload'] }>;
