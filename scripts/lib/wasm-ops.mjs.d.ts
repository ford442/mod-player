/** Instruction-level opcode-class counts of a .wasm binary (#491). */
export interface WasmOpCounts {
  functions: number;
  instructions: number;
  simd: number;
  tryBlocks: number;
  catches: number;
  throws: number;
  truncSat: number;
  truncTrapping: number;
  memoryCopy: number;
  memoryFill: number;
  signExt: number;
  atomics: number;
  sections: number[];
}
export function scanWasm(bytes: Uint8Array | ArrayBuffer): WasmOpCounts;
