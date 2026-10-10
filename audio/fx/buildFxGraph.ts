/**
 * The one graph builder shared by live playback, WAV export, the vitest
 * Web Audio tests and the Chromium harness (#453): a static-mode FxRack, i.e.
 * every value set immediately from the serialized state. Export parity rests
 * on this being the same code path as the live rack.
 */
import { FxRack, type FxRackEnv } from './FxRack';
import type { FxRackState } from './types';

export function buildFxGraph(
  ctx: BaseAudioContext,
  state: FxRackState,
  env: Omit<FxRackEnv, 'mode'> = {},
): Promise<FxRack> {
  return FxRack.create(ctx, state, { ...env, mode: 'static' });
}
