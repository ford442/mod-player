import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * All production sources that replaced the monolithic useLibOpenMPT.ts hook body. Since #492 the state
 * lives in the PlayerEngine (audio/engine/), and `useLibOpenMPTState.ts` is gone (usePlayerEngine
 * replaced it).
 */
const LIB_OPENMPT_SOURCE_FILES = [
  'hooks/useLibOpenMPT.ts',
  'audio/engine/PlayerEngine.ts',
  'audio/engine/engineRefs.ts',
  'audio/engine/transport.ts',
  'hooks/libOpenMPT/constants.ts',
  'hooks/libOpenMPT/parseModule.ts',
  'hooks/libOpenMPT/types.ts',
  'hooks/libOpenMPT/useLibOpenMPTRefs.ts',
  'hooks/libOpenMPT/createUpdateUI.ts',
  'hooks/libOpenMPT/createModuleActions.ts',
  'hooks/libOpenMPT/createTransportActions.ts',
  'hooks/libOpenMPT/runInit.ts',
] as const;

/** Concatenated hook sources for source-invariant tests (post-split layout). */
export function readLibOpenMPTSources(root: string = process.cwd()): string {
  return LIB_OPENMPT_SOURCE_FILES.map((rel) => readFileSync(join(root, rel), 'utf8')).join(
    '\n// --- file boundary ---\n',
  );
}

export function readTransportActionsSource(root: string = process.cwd()): string {
  return readFileSync(join(root, 'hooks/libOpenMPT/createTransportActions.ts'), 'utf8');
}

export function readModuleActionsSource(root: string = process.cwd()): string {
  return readFileSync(join(root, 'hooks/libOpenMPT/createModuleActions.ts'), 'utf8');
}
