/**
 * Loads the FX rack only when it's needed (#453). Main chunk: imports the
 * store and appConfig, never the rack itself.
 *
 * The lazy chunk (fxRackController → FxRack, modules, worklet loader, IR
 * loader) is imported the first time any module is effectively enabled —
 * including straight away when persisted state has one on — or when the FX
 * panel asks for it. With FX_RACK_ENABLED off this does nothing at all.
 */
import { FX_RACK_ENABLED } from '../../appConfig';
import { useFxStore } from '../../store/fxStore';
import { anyModuleActive } from './types';

type ControllerModule = typeof import('./fxRackController');

let controller: Promise<ControllerModule> | null = null;

/** Import and start the live controller (idempotent). */
export function loadFxRackController(): Promise<ControllerModule> | null {
  if (!FX_RACK_ENABLED) return null;
  if (!controller) {
    useFxStore.getState().setRackStatus('loading');
    controller = import('./fxRackController').then(
      (mod) => {
        mod.startFxRackController();
        return mod;
      },
      (err: unknown) => {
        controller = null;
        console.error('[FX] Failed to load the FX rack', err);
        useFxStore.getState().setRackStatus('error');
        throw err;
      },
    );
    controller.catch(() => {});
  }
  return controller;
}

/** Start watching the store; returns the unsubscribe. Call once (App). */
export function startFxBootstrap(): () => void {
  if (!FX_RACK_ENABLED) return () => {};
  const check = (effective = useFxStore.getState().effective) => {
    if (anyModuleActive(effective)) void loadFxRackController();
  };
  check();
  return useFxStore.subscribe((s, prev) => {
    if (s.effective !== prev.effective) check(s.effective);
  });
}
