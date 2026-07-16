
/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

/** Web MIDI API (Chrome / Edge) — not in all TS DOM libs */
interface Navigator {
  requestMIDIAccess(options?: { sysex?: boolean }): Promise<MIDIAccess>;
}

interface MIDIAccess extends EventTarget {
  readonly inputs: MIDIInputMap;
  readonly outputs: MIDIOutputMap;
  onstatechange: ((this: MIDIAccess, ev: MIDIConnectionEvent) => void) | null;
  readonly sysexEnabled: boolean;
}

type MIDIInputMap = ReadonlyMap<string, MIDIInput>;

interface MIDIInput extends MIDIPort {
  onmidimessage: ((this: MIDIInput, ev: MIDIMessageEvent) => void) | null;
}

interface MIDIPort extends EventTarget {
  readonly id: string;
  readonly manufacturer?: string;
  readonly name?: string;
  readonly type: 'input' | 'output';
  readonly version?: string;
  readonly state: 'connected' | 'disconnected';
  onstatechange: ((this: MIDIPort, ev: MIDIConnectionEvent) => void) | null;
  open(): Promise<MIDIPort>;
  close(): Promise<MIDIPort>;
}

interface MIDIConnectionEvent extends Event {
  readonly port: MIDIPort;
}

interface MIDIMessageEvent extends Event {
  readonly data: Uint8Array;
}

interface ImportMetaEnv {
  readonly VITE_STORAGE_API_URL?: string;
  /** Optional CDN override for libopenmpt JS/WASM (dev / experiments). */
  readonly VITE_LIBOPENMPT_CDN_URL?: string;
}
