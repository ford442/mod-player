/**
 * Room IR catalog (#453): what scripts/generate-irs.mjs committed under
 * public/ir/. `?v=` is each file's content hash, so a regenerated IR is never
 * served from a stale cache.
 */
import { detectRuntimeBase } from '../../../src/lib/paths';
import type { RoomIrId } from '../types';
import manifest from './ir-manifest.generated.json';

export interface IrEntry {
  file: string;
  version: string;
  bytes: number;
  durationSeconds: number;
  channels: number;
  sampleRate: number;
}

export const IR_MANIFEST = manifest as Record<RoomIrId, IrEntry>;

export function irUrl(id: RoomIrId): string {
  const entry = IR_MANIFEST[id];
  return `${detectRuntimeBase()}ir/${entry.file}?v=${entry.version}`;
}
