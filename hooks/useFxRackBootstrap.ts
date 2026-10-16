import { useEffect } from 'react';
import { startFxBootstrap } from '../audio/fx/fxBootstrap';

/** Load the FX rack (#453) once any module is enabled. Call once, in App. */
export function useFxRackBootstrap(): void {
  useEffect(() => startFxBootstrap(), []);
}
