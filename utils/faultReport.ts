/**
 * Always-on fault capture, local-first (observability phase 1).
 *
 * Every fault the app can see lands here: global `error` / `unhandledrejection`, a worklet fault
 * (`handleWorkletFault`), the ScriptProcessor fallback, WebGPU `device.lost` and
 * `uncapturederror`, and the parser / export / create worker `error` events. Each becomes a
 * `FaultEntry` stamped with a context snapshot (transport phase history, renderer backend, the
 * `?v=` key of every wasm / worklet, user agent, adapter, the song *fingerprint*), kept in a ring of
 * the last `FAULT_RING_SIZE` entries in IndexedDB (in memory where IndexedDB is unavailable).
 *
 * "Copy diagnostics" in the debug panel serialises the ring with `buildDiagnosticsBundle()`;
 * `node scripts/symbolicate.mjs report.json` turns its `wasm-function[N]` frames into names
 * offline, from `vendor/symbol-maps/` or CI's `libopenmpt-symbol-maps` artifact, using the keys
 * recorded here.
 *
 * Privacy: nothing leaves the browser (no upload in this phase). Module bytes and file names never
 * enter an entry: every string goes through `sanitizeFaultText` (module / audio file names → a
 * hash, URL origins and `file://` paths dropped), binary values become their length, and the song
 * is identified only by its SHA-256 fingerprint.
 *
 * Framework-free: the engine (`audio/engine/`) and the audio graph import it; it imports no React.
 */
import { LIBOPENMPT_MODULE_EXTENSIONS } from './moduleFormats.generated';
import { getSongFingerprint } from './songIdentity';
import workletVersion from '../audio-worklet/js/worklet-version.generated.json';
import fxCharacterVersion from '../audio-worklet/js/fx-character-version.generated.json';
import libopenmptManifest from '../audio-worklet/js/libopenmpt-worklet.generated.json';
import playbackManifest from '../audio-worklet/js/libopenmpt-playback.generated.json';

export const FAULT_REPORT_SCHEMA = 1;
export const FAULT_RING_SIZE = 50;
export const FAULT_DB = 'xasm1-fault-reports';
export const FAULT_OBJECT_STORE = 'faults';

/** The same kind + message again within this window is counted, not stored again. */
export const FAULT_DEDUPE_WINDOW_MS = 2_000;
/** At most this many entries per minute are stored (an error loop must not churn IndexedDB). */
export const FAULT_MAX_PER_MINUTE = 20;

const MAX_MESSAGE_CHARS = 2_000;
const MAX_STACK_CHARS = 8_000;
const MAX_CONTEXT_DEPTH = 6;
const MAX_CONTEXT_ARRAY = 64;
const MAX_CONTEXT_KEYS = 64;

export type FaultKind =
  | 'error'
  | 'unhandledrejection'
  | 'worklet-fault'
  | 'sp-fallback'
  | 'gpu-device-lost'
  | 'gpu-error'
  | 'worker-error';

/** The two libopenmpt pairs (public/worklets/README.md); the symbol maps are keyed by these names. */
export type WasmPair = 'libopenmpt-worklet' | 'libopenmpt-playback';

export interface FaultEntry {
  schema: typeof FAULT_REPORT_SCHEMA;
  /** Wall-clock time, ISO 8601. */
  at: string;
  /** `performance.now()` at capture: ms since the page started. */
  uptimeMs: number;
  kind: FaultKind;
  /** Where it came from, e.g. `window`, `worklet:process-trap`, `parser-worker`. */
  source: string;
  message: string;
  stack?: string;
  /** The libopenmpt pair a `wasm-function[N]` frame in this entry most likely belongs to. */
  wasmPair: WasmPair;
  /** Same kind + message seen again (and not stored) within the dedupe window before this one. */
  repeats: number;
  context: Record<string, unknown>;
}

export interface FaultInput {
  kind: FaultKind;
  source: string;
  /** An Error (message + stack are read from it), or any thrown / rejected value. */
  error?: unknown;
  /** Used when `error` is absent, or prefixed to a non-Error value. */
  message?: string;
  /** Overrides the pair guessed from `source`. */
  wasmPair?: WasmPair;
}

// ── privacy ──────────────────────────────────────────────────────────────────────────────────

/** Extensions whose file names are reduced to a hash: every module format, archives, audio exports. */
const SENSITIVE_EXTENSIONS = [
  ...LIBOPENMPT_MODULE_EXTENSIONS,
  'zip', 'lha', 'lzh', 'gz', 'rar', '7z',
  'wav', 'flac', 'ogg', 'opus', 'mp3', 'm4a', 'aac', 'webm',
];

// Longest first, so `mptm` wins over `mpt`-like prefixes. Escaped for the regex.
const EXT_ALTERNATION = [...new Set(SENSITIVE_EXTENSIONS)]
  .sort((a, b) => b.length - a.length)
  .map((ext) => ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

/** A bare file name (no spaces, path separators, quotes or brackets) ending in a sensitive extension. */
const SENSITIVE_FILE_RE = new RegExp(String.raw`[^\s/\\'"\x60()<>\[\]{}|:]+\.(${EXT_ALTERNATION})(?![\w.])`, 'gi');
/** A quoted or parenthesised name (spaces allowed — the loader logs `"${fileName}"` / `(${fileName})`). */
const DELIMITED_FILE_RE = new RegExp(String.raw`(["'\x60(])([^"'\x60()<>\n]{1,255}?\.(${EXT_ALTERNATION}))(?=["'\x60)])`, 'gi');
/** A whole value that *is* a file name or path (a context field such as `fileName`). */
const SENSITIVE_TAIL_RE = new RegExp(String.raw`\.(${EXT_ALTERNATION})$`, 'i');
const FILE_URL_RE = /file:\/\/\/?[^\s'"\x60()<>]+/gi;
/** http(s) / ws(s) / blob URLs: the origin is dropped; a URL that names a module is hashed whole. */
const URL_RE = /\b(?:https?|wss?|blob):\/\/[^/\s'"\x60()<>]*([^\s'"\x60()<>]*)/gi;

/** FNV-1a, 32-bit: a short, stable, non-reversible-enough tag for a file name (not a security hash). */
export function hashFileName(name: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function hashedName(name: string, ext: string): string {
  return `<file:${hashFileName(name.toLowerCase())}>.${ext.toLowerCase()}`;
}

/**
 * Strip what could identify the user or their files from free text: `file://` paths, URL origins
 * (a URL that names a module → `<url:hash>.ext`), and file names with a module / audio / archive
 * extension (→ `<file:hash>.ext`) — bare, or quoted / parenthesised with spaces. Best effort for
 * free text: an *unquoted* name with spaces keeps the words before its last one.
 */
export function sanitizeFaultText(text: string, maxChars = MAX_MESSAGE_CHARS): string {
  let out = text.length > maxChars * 2 ? text.slice(0, maxChars * 2) : text;
  out = out.replace(FILE_URL_RE, (url) => `file:<${hashFileName(url)}>`);
  out = out.replace(URL_RE, (url, path: string) => {
    const ext = SENSITIVE_TAIL_RE.exec(path.split(/[?#]/, 1)[0] ?? '')?.[1];
    return ext ? `<url:${hashFileName(url)}>.${ext.toLowerCase()}` : path;
  });
  out = out.replace(DELIMITED_FILE_RE, (_m, open: string, name: string, ext: string) => `${open}${hashedName(name, ext)}`);
  out = out.replace(SENSITIVE_FILE_RE, (name, ext: string) => hashedName(name, ext));
  return out.length > maxChars ? `${out.slice(0, maxChars)}… [truncated]` : out;
}

/** A JSON-safe, sanitised copy: strings cleaned, binary reduced to its length, depth / size capped. */
export function sanitizeFaultValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  switch (typeof value) {
    case 'string': {
      const ext = value.length <= 300 && !value.includes('\n') ? SENSITIVE_TAIL_RE.exec(value.trim())?.[1] : undefined;
      return ext ? hashedName(value.trim(), ext) : sanitizeFaultText(value, 500);
    }
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return undefined;
    default:
      break;
  }
  if (ArrayBuffer.isView(value)) return `[binary ${value.byteLength} bytes]`;
  if (value instanceof ArrayBuffer) return `[binary ${value.byteLength} bytes]`;
  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) {
    return `[binary ${value.byteLength} bytes]`;
  }
  if (value instanceof Error) return sanitizeFaultText(`${value.name}: ${value.message}`, 500);
  if (depth >= MAX_CONTEXT_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_CONTEXT_ARRAY).map((v) => sanitizeFaultValue(v, depth + 1) ?? null);
    if (value.length > MAX_CONTEXT_ARRAY) items.push(`[+${value.length - MAX_CONTEXT_ARRAY} more]`);
    return items;
  }
  const out: Record<string, unknown> = {};
  let keys = 0;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (keys++ >= MAX_CONTEXT_KEYS) {
      out['…'] = 'truncated';
      break;
    }
    const clean = sanitizeFaultValue(v, depth + 1);
    if (clean !== undefined) out[sanitizeFaultText(key, 100)] = clean;
  }
  return out;
}

// ── context ──────────────────────────────────────────────────────────────────────────────────

type ContextProvider = () => unknown;
const providers = new Map<string, ContextProvider>();

/**
 * Add a named section to every fault's context (the engine registers `transport`, PatternDisplay
 * `renderer`). Last registration wins; the returned function removes it only if it is still the
 * registered one.
 */
export function registerFaultContext(name: string, provider: ContextProvider): () => void {
  providers.set(name, provider);
  return () => {
    if (providers.get(name) === provider) providers.delete(name);
  };
}

/** The `?v=` cache keys of every wasm / worklet this build loads (and the symbol maps are named by). */
export function faultAssetKeys(): Record<string, string> {
  return {
    'libopenmpt-worklet': libopenmptManifest.version,
    'libopenmpt-playback': playbackManifest.version,
    'openmpt-worklet': workletVersion.version,
    'fx-character-worklet': fxCharacterVersion.version,
    libopenmpt: libopenmptManifest.libopenmpt,
    emsdk: libopenmptManifest.emsdk,
  };
}

function isCrossOriginIsolated(): boolean {
  return typeof globalThis.crossOriginIsolated === 'boolean' && globalThis.crossOriginIsolated;
}

function builtInContext(): Record<string, unknown> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const win = typeof window !== 'undefined' ? window : undefined;
  const probe = win?.__WEBGPU_PROBE__;
  const heap = win?.libopenmpt?.HEAPU8;
  return {
    assets: faultAssetKeys(),
    env: {
      userAgent: nav?.userAgent ?? null,
      hardwareConcurrency: nav?.hardwareConcurrency ?? null,
      deviceMemory: (nav as { deviceMemory?: number } | undefined)?.deviceMemory ?? null,
      crossOriginIsolated: isCrossOriginIsolated(),
      visibility: typeof document !== 'undefined' ? document.visibilityState : null,
    },
    song: { fingerprint: getSongFingerprint() },
    gpu: probe
      ? { ok: probe.ok, stage: probe.stage, browserBrand: probe.browserBrand, adapter: probe.adapterInfo ?? null, error: probe.error ?? null }
      : null,
    wasmHeapBytes: heap instanceof Uint8Array ? heap.byteLength : null,
    audioDiag: win?.__AUDIO_DIAG__ ?? null,
  };
}

/** The current context: the built-in sections plus every registered provider, sanitised. */
export function captureFaultContext(): Record<string, unknown> {
  const context: Record<string, unknown> = builtInContext();
  for (const [name, provider] of providers) {
    try {
      context[name] = provider();
    } catch (e) {
      context[name] = { providerError: e instanceof Error ? e.message : String(e) };
    }
  }
  return sanitizeFaultValue(context) as Record<string, unknown>;
}

function guessWasmPair(kind: FaultKind, source: string): WasmPair {
  if (source.startsWith('create-worker')) return 'libopenmpt-playback';
  // The AudioWorklet runs the shared-memory playback pair on an isolated page, the shared pair otherwise.
  if (kind === 'worklet-fault' || source.startsWith('worklet')) {
    return isCrossOriginIsolated() ? 'libopenmpt-playback' : 'libopenmpt-worklet';
  }
  return 'libopenmpt-worklet';
}

function describe(input: FaultInput): { message: string; stack?: string } {
  const { error, message } = input;
  if (error instanceof Error) {
    const text = `${error.name}: ${error.message}`;
    return {
      message: message ? `${message}: ${text}` : text,
      ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
    };
  }
  if (error === undefined) return { message: message ?? '(no message)' };
  let text: string;
  try {
    text = typeof error === 'string' ? error : JSON.stringify(sanitizeFaultValue(error)) ?? String(error);
  } catch {
    text = String(error);
  }
  return { message: message ? `${message}: ${text}` : text };
}

// ── storage ──────────────────────────────────────────────────────────────────────────────────

export interface FaultStore {
  add(entry: FaultEntry): Promise<void>;
  /** Oldest first. */
  list(): Promise<FaultEntry[]>;
  clear(): Promise<void>;
}

export function createMemoryFaultStore(limit = FAULT_RING_SIZE): FaultStore {
  let entries: FaultEntry[] = [];
  return {
    add(entry) {
      entries.push(entry);
      if (entries.length > limit) entries = entries.slice(entries.length - limit);
      return Promise.resolve();
    },
    list: () => Promise.resolve([...entries]),
    clear() {
      entries = [];
      return Promise.resolve();
    },
  };
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function idbDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** The ring in IndexedDB: one auto-increment object store, trimmed to `limit` on every add. */
export function createIndexedDbFaultStore(
  factory: IDBFactory = indexedDB,
  dbName = FAULT_DB,
  limit = FAULT_RING_SIZE,
): FaultStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(FAULT_OBJECT_STORE, { autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    }).catch((e: unknown) => {
      db = null; // retry on the next call (private mode, blocked upgrade, …)
      throw e;
    });
    return db;
  };
  return {
    async add(entry) {
      const tx = (await open()).transaction(FAULT_OBJECT_STORE, 'readwrite');
      const done = idbDone(tx);
      const store = tx.objectStore(FAULT_OBJECT_STORE);
      await idbRequest(store.add(entry));
      const keys = await idbRequest(store.getAllKeys());
      for (const key of keys.slice(0, Math.max(0, keys.length - limit))) store.delete(key);
      await done;
    },
    async list() {
      const tx = (await open()).transaction(FAULT_OBJECT_STORE, 'readonly');
      return idbRequest(tx.objectStore(FAULT_OBJECT_STORE).getAll() as IDBRequest<FaultEntry[]>);
    },
    async clear() {
      const tx = (await open()).transaction(FAULT_OBJECT_STORE, 'readwrite');
      const done = idbDone(tx);
      tx.objectStore(FAULT_OBJECT_STORE).clear();
      await done;
    },
  };
}

// ── the recorder ─────────────────────────────────────────────────────────────────────────────

interface RecorderState {
  store: FaultStore | null;
  /** The newest entries in memory too: survives an IndexedDB that rejects every write. */
  recent: FaultEntry[];
  lastKey: string | null;
  lastAt: number;
  repeats: number;
  windowStart: number;
  windowCount: number;
  dropped: number;
  storeErrors: number;
}

const state: RecorderState = {
  store: null,
  recent: [],
  lastKey: null,
  lastAt: -Infinity,
  repeats: 0,
  windowStart: -Infinity,
  windowCount: 0,
  dropped: 0,
  storeErrors: 0,
};

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function defaultStore(): FaultStore {
  try {
    if (typeof indexedDB !== 'undefined') return createIndexedDbFaultStore(indexedDB);
  } catch { /* fall through */ }
  return createMemoryFaultStore();
}

function getStore(): FaultStore {
  state.store ??= defaultStore();
  return state.store;
}

/** Point the recorder at another store and forget its counters (tests). */
export function setFaultStoreForTests(store: FaultStore | null): void {
  state.store = store;
  state.recent = [];
  state.lastKey = null;
  state.lastAt = -Infinity;
  state.repeats = 0;
  state.windowStart = -Infinity;
  state.windowCount = 0;
  state.dropped = 0;
  state.storeErrors = 0;
}

/** Wait for every write started so far (tests, and "Copy diagnostics" right after a fault). */
let pendingWrites: Promise<void> = Promise.resolve();
export function flushFaultWrites(): Promise<void> {
  return pendingWrites;
}

/**
 * Record a fault. Returns the stored entry, or null when it was folded into the previous one
 * (same kind + message within `FAULT_DEDUPE_WINDOW_MS`) or rate-limited. Never throws: a fault
 * recorder that faults must not take the caller down with it.
 */
export function recordFault(input: FaultInput): FaultEntry | null {
  try {
    const t = now();
    const { message: rawMessage, stack } = describe(input);
    const message = sanitizeFaultText(rawMessage);
    const key = `${input.kind}\u0000${input.source}\u0000${message}`;
    if (key === state.lastKey && t - state.lastAt < FAULT_DEDUPE_WINDOW_MS) {
      state.lastAt = t;
      state.repeats += 1;
      return null;
    }
    if (t - state.windowStart >= 60_000) {
      state.windowStart = t;
      state.windowCount = 0;
    }
    if (state.windowCount >= FAULT_MAX_PER_MINUTE) {
      state.dropped += 1;
      return null;
    }
    state.windowCount += 1;
    const repeats = key === state.lastKey ? state.repeats : 0;
    state.lastKey = key;
    state.lastAt = t;
    state.repeats = 0;

    const entry: FaultEntry = {
      schema: FAULT_REPORT_SCHEMA,
      at: new Date().toISOString(),
      uptimeMs: Math.round(t),
      kind: input.kind,
      source: sanitizeFaultText(input.source, 100),
      message,
      ...(stack ? { stack: sanitizeFaultText(stack, MAX_STACK_CHARS) } : {}),
      wasmPair: input.wasmPair ?? guessWasmPair(input.kind, input.source),
      repeats,
      context: captureFaultContext(),
    };
    state.recent.push(entry);
    if (state.recent.length > FAULT_RING_SIZE) state.recent.shift();
    const write = getStore()
      .add(entry)
      .catch((e: unknown) => {
        state.storeErrors += 1;
        if (state.storeErrors === 1) console.warn('[FaultReport] could not persist a fault report:', e);
      });
    pendingWrites = pendingWrites.then(() => write);
    return entry;
  } catch (e) {
    console.warn('[FaultReport] recordFault failed:', e);
    return null;
  }
}

// ── global capture ───────────────────────────────────────────────────────────────────────────

/** Browser noise that is not a fault of ours. */
const IGNORED_ERROR_MESSAGES = [/ResizeObserver loop/i];

type FaultEventTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
const installed = new WeakSet<FaultEventTarget>();

/**
 * Listen for uncaught errors and unhandled rejections on `target` (the window). Idempotent per
 * target; returns an uninstall. The events are observed, never `preventDefault()`ed, so the console
 * still shows them.
 */
export function installGlobalFaultCapture(target: FaultEventTarget = window): () => void {
  if (installed.has(target)) return () => {};
  installed.add(target);
  const onError = (event: Event) => {
    const e = event as ErrorEvent;
    const message = typeof e.message === 'string' ? e.message : '';
    if (IGNORED_ERROR_MESSAGES.some((re) => re.test(message))) return;
    const where = e.filename ? ` (${e.filename}:${e.lineno ?? 0}:${e.colno ?? 0})` : '';
    recordFault({
      kind: 'error',
      source: 'window',
      ...(e.error !== undefined && e.error !== null ? { error: e.error } : { message: `${message || 'error'}${where}` }),
    });
  };
  const onRejection = (event: Event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    recordFault({
      kind: 'unhandledrejection',
      source: 'window',
      ...(reason instanceof Error ? { error: reason } : { message: 'Unhandled rejection', error: reason ?? null }),
    });
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
    installed.delete(target);
  };
}

// ── the diagnostics bundle ───────────────────────────────────────────────────────────────────

export interface DiagnosticsBundle {
  kind: 'xasm1-diagnostics';
  schema: typeof FAULT_REPORT_SCHEMA;
  createdAt: string;
  /** Context at the time of the copy (the same sections every fault carries). */
  current: Record<string, unknown>;
  /** Oldest first, at most `FAULT_RING_SIZE`. */
  faults: FaultEntry[];
  recorder: { dropped: number; storeErrors: number; storage: 'indexeddb' | 'memory' };
}

/** The stored ring (or, if IndexedDB fails, the in-memory copy) plus the current context. */
export async function buildDiagnosticsBundle(): Promise<DiagnosticsBundle> {
  await flushFaultWrites();
  let faults: FaultEntry[];
  let storage: 'indexeddb' | 'memory' = 'indexeddb';
  try {
    faults = await getStore().list();
  } catch {
    faults = [...state.recent];
    storage = 'memory';
  }
  return {
    kind: 'xasm1-diagnostics',
    schema: FAULT_REPORT_SCHEMA,
    createdAt: new Date().toISOString(),
    current: captureFaultContext(),
    faults,
    recorder: { dropped: state.dropped, storeErrors: state.storeErrors, storage },
  };
}

export function serializeDiagnosticsBundle(bundle: DiagnosticsBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** Forget every stored fault (debug panel). */
export async function clearFaultReports(): Promise<void> {
  state.recent = [];
  await getStore().clear();
}
