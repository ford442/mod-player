/**
 * Main-thread fetch + validation of the real-WASM libopenmpt pair the JS AudioWorklet needs.
 *
 * The worklet scope has no fetch(), so the main thread downloads glue + wasm and posts them via
 * initLib {scriptText, wasmBytes}. Everything a bad deploy can get wrong (404 HTML masquerading
 * as JS or wasm, a stale wasm2js glue, a truncated binary) is rejected HERE with a specific
 * message, not discovered later as a silent worklet init timeout.
 */
import {
  LIBOPENMPT_GLUE_FILE,
  LIBOPENMPT_PLAYBACK_GLUE_FILE,
  LIBOPENMPT_PLAYBACK_WASM_FILE,
  LIBOPENMPT_WASM_FILE,
  getLibOpenMPTJsUrl,
  getLibOpenMPTPlaybackJsUrl,
  getLibOpenMPTPlaybackWasmUrl,
  getLibOpenMPTWasmUrl,
} from './libopenmptAssets';

/**
 * Which pair the worklet gets: `playback` (shared-memory heap; loads are created on the create
 * worker, #513) or `shared` (the main thread's non-threaded pair; loads are created in the worklet).
 */
export type WorkletLibArtifact = 'playback' | 'shared';

export interface WorkletLibAssets {
  artifact: WorkletLibArtifact;
  scriptText: string;
  wasmBytes: ArrayBuffer;
}

/** WebAssembly binary magic: \0asm. */
export function hasWasmMagic(bytes: ArrayBuffer | Uint8Array): boolean {
  const head = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  return head.length >= 4 && head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d;
}

/** Emscripten wasm2js emits `isWasm2js:!0` (minified) or `isWasm2js: true`. The JS engine no longer supports it. */
export function looksLikeWasm2jsGlue(text: string): boolean {
  return /isWasm2js\s*:\s*!\s*0/.test(text) || /isWasm2js\s*:\s*true/.test(text);
}

function previewOf(bytes: ArrayBuffer | Uint8Array): string {
  const head = bytes instanceof Uint8Array ? bytes.subarray(0, 40) : new Uint8Array(bytes, 0, Math.min(40, bytes.byteLength));
  return JSON.stringify(new TextDecoder('utf-8', { fatal: false }).decode(head).replace(/\s+/g, ' '));
}

export interface FetchWorkletLibAssetsOptions {
  fetchImpl?: typeof fetch;
  /** Default `shared`. */
  artifact?: WorkletLibArtifact;
  jsUrl?: string;
  wasmUrl?: string;
}

export async function fetchWorkletLibAssets(
  opts: FetchWorkletLibAssetsOptions = {},
): Promise<WorkletLibAssets> {
  const doFetch = opts.fetchImpl ?? fetch;
  const artifact = opts.artifact ?? 'shared';
  const playback = artifact === 'playback';
  const glueFile = playback ? LIBOPENMPT_PLAYBACK_GLUE_FILE : LIBOPENMPT_GLUE_FILE;
  const wasmFile = playback ? LIBOPENMPT_PLAYBACK_WASM_FILE : LIBOPENMPT_WASM_FILE;
  const jsUrl = opts.jsUrl ?? (playback ? getLibOpenMPTPlaybackJsUrl() : getLibOpenMPTJsUrl());
  const wasmUrl = opts.wasmUrl ?? (playback ? getLibOpenMPTPlaybackWasmUrl() : getLibOpenMPTWasmUrl());

  const [jsResp, wasmResp] = await Promise.all([doFetch(jsUrl), doFetch(wasmUrl)]);

  if (!jsResp.ok) throw new Error(`HTTP ${jsResp.status} for ${glueFile}`);
  if (!wasmResp.ok) throw new Error(`HTTP ${wasmResp.status} for ${wasmFile}`);

  const [scriptText, wasmBytes] = await Promise.all([jsResp.text(), wasmResp.arrayBuffer()]);

  if (!scriptText.trim()) throw new Error(`${glueFile} is empty`);
  if (looksLikeWasm2jsGlue(scriptText)) {
    throw new Error(
      `${glueFile} is a wasm2js build — the JS engine requires real WebAssembly ` +
        `(rebuild with npm run build:js-libopenmpt; stale deploy?)`,
    );
  }
  if (!hasWasmMagic(wasmBytes)) {
    throw new Error(
      `${wasmFile} is not a valid WebAssembly binary (missing \\0asm magic; ` +
        `starts with ${previewOf(wasmBytes)}). Refusing to hand corrupt HTML/text to the worklet.`,
    );
  }

  return { artifact, scriptText, wasmBytes };
}
