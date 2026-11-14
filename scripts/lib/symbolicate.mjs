/**
 * Offline symbolication of fault reports (observability phase 1).
 *
 * A production stack frame from libopenmpt is `wasm-function[1234]` — the release wasm carries no
 * name section. The release build writes the function index → name map next to it instead
 * (`--emit-symbol-map`, moved to `vendor/symbol-maps/<pair>.<cache key>.symbols` by
 * scripts/build-js-libopenmpt.sh; CI uploads them as the `libopenmpt-symbol-maps` artifact). The
 * cache key is the `?v=` the app loads, and every fault report records it (`context.assets` in
 * utils/faultReport.ts), so a report pasted by a user names the exact map that decodes it.
 *
 * Imported by scripts/symbolicate.mjs (the CLI) and tests/unit/symbolicate.test.ts.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The two libopenmpt pairs (public/worklets/README.md). */
export const WASM_PAIRS = /** @type {const} */ (['libopenmpt-worklet', 'libopenmpt-playback']);

/** @typedef {'libopenmpt-worklet' | 'libopenmpt-playback'} WasmPair */
/** @typedef {Map<number, string>} SymbolMap */
/** @typedef {{ pair: WasmPair, key: string, file: string, map: SymbolMap }} LoadedSymbolMap */

const FRAME_RE = /wasm-function\[(\d+)\]/g;
const PAIR_IN_LINE_RE = /(libopenmpt-(?:worklet|playback))\.wasm/;

/**
 * Parse an emscripten symbol map: one `index:name` per line (the name may itself contain `:`, as
 * C++ names do — only the first colon separates).
 * @param {string} text
 * @returns {SymbolMap}
 */
export function parseSymbolMap(text) {
  /** @type {SymbolMap} */
  const map = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const index = line.slice(0, colon);
    if (!/^\d+$/.test(index)) continue;
    const name = line.slice(colon + 1);
    if (name) map.set(Number(index), name);
  }
  return map;
}

/**
 * @param {WasmPair} pair
 * @param {string} key
 */
export function symbolMapFileName(pair, key) {
  return `${pair}.${key}.symbols`;
}

/**
 * Find `<pair>.<key>.symbols` in any of `dirs` (searched in order; one level of subdirectories
 * too, so an unzipped CI artifact can be passed as is).
 * @param {readonly string[]} dirs
 * @param {WasmPair} pair
 * @param {string} key
 * @returns {LoadedSymbolMap | null}
 */
export function loadSymbolMap(dirs, pair, key) {
  const wanted = symbolMapFileName(pair, key);
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const candidates = [join(dir, wanted)];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(join(dir, entry.name, wanted));
    }
    for (const file of candidates) {
      if (existsSync(file)) return { pair, key, file, map: parseSymbolMap(readFileSync(file, 'utf8')) };
    }
  }
  return null;
}

/**
 * Annotate every line of `text` that holds a `wasm-function[N]` frame with the function's name:
 * `… wasm-function[123]:0x4a2  → openmpt::module_impl::read(...)`. The pair is the one named in
 * the line's URL, else `defaultPair`.
 * @param {string} text
 * @param {(pair: WasmPair) => SymbolMap | null} mapFor
 * @param {WasmPair} defaultPair
 * @returns {{ text: string, resolved: number, unresolved: number, pairsNeeded: Set<WasmPair> }}
 */
export function symbolicateText(text, mapFor, defaultPair) {
  let resolved = 0;
  let unresolved = 0;
  /** @type {Set<WasmPair>} */
  const pairsNeeded = new Set();
  const lines = text.split('\n').map((line) => {
    const indices = [...new Set([...line.matchAll(FRAME_RE)].map((m) => Number(m[1])))];
    if (indices.length === 0) return line;
    const pair = /** @type {WasmPair} */ (PAIR_IN_LINE_RE.exec(line)?.[1] ?? defaultPair);
    pairsNeeded.add(pair);
    const map = mapFor(pair);
    const names = indices.map((index) => {
      const name = map?.get(index);
      if (name === undefined) {
        unresolved += 1;
        return `wasm-function[${index}]=?`;
      }
      resolved += 1;
      return name;
    });
    return `${line}  → ${names.join(', ')}`;
  });
  return { text: lines.join('\n'), resolved, unresolved, pairsNeeded };
}

/**
 * @typedef {{
 *   kind?: string, source?: string, at?: string, message?: string, stack?: string,
 *   wasmPair?: WasmPair, context?: { assets?: Record<string, string> },
 *   symbolicated?: { message: string, stack?: string, resolved: number, unresolved: number, maps: string[], missing: string[] },
 * }} FaultLike
 */

/**
 * The fault entries in a diagnostics bundle (`{ faults: [...] }`), an array of entries, or one entry.
 * @param {unknown} report
 * @returns {FaultLike[]}
 */
export function faultsOf(report) {
  if (Array.isArray(report)) return report;
  if (report && typeof report === 'object') {
    const r = /** @type {Record<string, unknown>} */ (report);
    if (Array.isArray(r.faults)) return /** @type {FaultLike[]} */ (r.faults);
    if (typeof r.message === 'string' || typeof r.stack === 'string') return [/** @type {FaultLike} */ (r)];
  }
  throw new Error('not a fault report: expected a diagnostics bundle ({ faults: [...] }), an array of faults, or one fault');
}

/**
 * Symbolicate every fault in `report` in place (each gains a `symbolicated` field) and return it.
 * `fallbackKeys` supplies a pair's key when an entry did not record one (e.g. the current build's).
 * @template T
 * @param {T} report
 * @param {{ mapDirs: readonly string[], fallbackKeys?: Partial<Record<WasmPair, string>> }} options
 * @returns {{ report: T, resolved: number, unresolved: number, missing: string[] }}
 */
export function symbolicateReport(report, options) {
  /** @type {Map<string, LoadedSymbolMap | null>} */
  const cache = new Map();
  const load = (/** @type {WasmPair} */ pair, /** @type {string} */ key) => {
    const id = symbolMapFileName(pair, key);
    if (!cache.has(id)) cache.set(id, loadSymbolMap(options.mapDirs, pair, key));
    return cache.get(id) ?? null;
  };
  let resolved = 0;
  let unresolved = 0;
  /** @type {Set<string>} */
  const missing = new Set();
  for (const fault of faultsOf(report)) {
    const assets = fault.context?.assets ?? {};
    const defaultPair = fault.wasmPair && WASM_PAIRS.includes(fault.wasmPair) ? fault.wasmPair : 'libopenmpt-worklet';
    /** @type {Set<string>} */
    const used = new Set();
    /** @type {Set<string>} */
    const faultMissing = new Set();
    const mapFor = (/** @type {WasmPair} */ pair) => {
      const key = assets[pair] ?? options.fallbackKeys?.[pair];
      if (!key) {
        faultMissing.add(`${pair} (no ?v= key recorded)`);
        return null;
      }
      const loaded = load(pair, key);
      if (!loaded) {
        faultMissing.add(symbolMapFileName(pair, key));
        return null;
      }
      used.add(loaded.file);
      return loaded.map;
    };
    const message = symbolicateText(fault.message ?? '', mapFor, defaultPair);
    const stack = fault.stack === undefined ? null : symbolicateText(fault.stack, mapFor, defaultPair);
    const r = message.resolved + (stack?.resolved ?? 0);
    const u = message.unresolved + (stack?.unresolved ?? 0);
    resolved += r;
    unresolved += u;
    for (const m of faultMissing) missing.add(m);
    if (message.pairsNeeded.size > 0 || (stack && stack.pairsNeeded.size > 0)) {
      fault.symbolicated = {
        message: message.text,
        ...(stack ? { stack: stack.text } : {}),
        resolved: r,
        unresolved: u,
        maps: [...used],
        missing: [...faultMissing],
      };
    }
  }
  return { report, resolved, unresolved, missing: [...missing] };
}
