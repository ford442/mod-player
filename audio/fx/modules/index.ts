/** Module factory for the FX rack (#453). */
import type { FxModuleId, FxParamsById } from '../types';
import { createCharacterModule } from './characterModule';
import { createCompModule } from './compModule';
import { createEqModule } from './eqModule';
import { createRoomModule } from './roomModule';
import type { FxModuleEnv, FxModuleFactory, FxModuleInstance } from './types';

export const createFxModule: FxModuleFactory = async <K extends FxModuleId>(
  id: K,
  ctx: BaseAudioContext,
  params: FxParamsById[K],
  env: FxModuleEnv,
): Promise<FxModuleInstance<K> | null> => {
  switch (id) {
    case 'eq':
      return createEqModule(ctx, params as FxParamsById['eq']) as unknown as FxModuleInstance<K>;
    case 'comp':
      return createCompModule(ctx, params as FxParamsById['comp']) as unknown as FxModuleInstance<K>;
    case 'character':
      return (await createCharacterModule(ctx, params as FxParamsById['character'], env)) as unknown as FxModuleInstance<K>;
    case 'room':
      return (await createRoomModule(ctx, params as FxParamsById['room'], env)) as unknown as FxModuleInstance<K> | null;
    default:
      return null;
  }
};
