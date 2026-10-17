import type { WasmOpCounts } from './lib/wasm-ops.mjs';
export const PROFILES: Record<string, { file: string; rules: Array<[string, (c: WasmOpCounts) => boolean, string]> }>;
export function checkWasmProfile(bytes: Uint8Array, profileName: string): { counts: WasmOpCounts; failures: string[] };
