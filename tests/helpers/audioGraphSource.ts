import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** All production sources that replaced the monolithic useAudioGraph.ts body. */
const AUDIO_GRAPH_SOURCE_FILES = [
  'hooks/useAudioGraph.ts',
  'hooks/audioGraph/types.ts',
  'hooks/audioGraph/masterGraph.ts',
  'hooks/audioGraph/scriptProcessorFallback.ts',
  'hooks/audioGraph/startNativePlayback.ts',
  'hooks/audioGraph/startJsWorkletPlayback.ts',
] as const;

/** Concatenated audio-graph sources for source-invariant tests (post-split layout). */
export function readAudioGraphSources(root: string = process.cwd()): string {
  return AUDIO_GRAPH_SOURCE_FILES.map((rel) => readFileSync(join(root, rel), 'utf8')).join(
    '\n// --- file boundary ---\n',
  );
}
