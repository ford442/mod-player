export const NATIVE_TRIO: readonly [
  'openmpt-native.js',
  'openmpt-native.wasm',
  'openmpt-native.aw.js',
];

export type NativeEngineStatus = 'absent' | 'complete' | 'partial' | 'invalid';

export interface NativeEngineClassification {
  status: NativeEngineStatus;
  present: string[];
  missing: string[];
  sizes: Record<string, number>;
  errors: string[];
}

export function classifyNativeEngine(workletsDir: string): NativeEngineClassification;

export function formatNativeEngineSummary(result: NativeEngineClassification): string;

export function exitCodeForResult(
  result: NativeEngineClassification,
  requireComplete?: boolean,
): number;
