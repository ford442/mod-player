import type { LibOpenMPT } from '../types';

/** Byte offset of set_channel_mute_status in openmpt_module_ext_interface_interactive. */
const INTERACTIVE_MUTE_FN_OFFSET = 10 * 4;

/** Size of openmpt_module_ext_interface_interactive (16 function pointers). */
export const INTERACTIVE_INTERFACE_SIZE = 16 * 4;

type ExtLib = LibOpenMPT & {
  _openmpt_module_ext_create_from_memory?: (
    filePtr: number,
    fileSize: number,
    logFunc: number,
    errorFunc: number,
    errorCodePtr: number,
    errorMsgPtr: number,
    ctls: number,
  ) => number;
  _openmpt_module_ext_destroy?: (modExtPtr: number) => void;
  _openmpt_module_ext_get_module?: (modExtPtr: number) => number;
  _openmpt_module_ext_get_interface?: (
    modExtPtr: number,
    interfaceIdPtr: number,
    interfacePtr: number,
    interfaceSize: number,
  ) => number;
  getValue?: (ptr: number, type: string) => number;
  dynCall?: (sig: string, ptr: number, args: number[]) => number;
};

export interface OpenMPTExtModule {
  modExtPtr: number;
  modPtr: number;
  interfacePtr: number;
}

function requireExtFn<T>(lib: ExtLib, name: keyof ExtLib): T {
  const fn = lib[name];
  if (typeof fn !== 'function') {
    throw new Error(`libopenmpt ext API missing: ${String(name)}`);
  }
  return fn as T;
}

/** Create an ext module handle from raw file bytes (caller frees filePtr after). */
export function createExtModuleFromMemory(
  lib: LibOpenMPT,
  filePtr: number,
  fileSize: number,
): OpenMPTExtModule {
  const extLib = lib as ExtLib;
  const createFromMemory = requireExtFn<
    NonNullable<ExtLib['_openmpt_module_ext_create_from_memory']>
  >(extLib, '_openmpt_module_ext_create_from_memory');
  const getModule = requireExtFn<NonNullable<ExtLib['_openmpt_module_ext_get_module']>>(
    extLib,
    '_openmpt_module_ext_get_module',
  );
  const getInterface = requireExtFn<NonNullable<ExtLib['_openmpt_module_ext_get_interface']>>(
    extLib,
    '_openmpt_module_ext_get_interface',
  );

  const modExtPtr = createFromMemory(filePtr, fileSize, 0, 0, 0, 0, 0);
  if (!modExtPtr) {
    throw new Error('openmpt_module_ext_create_from_memory returned 0');
  }

  const modPtr = getModule(modExtPtr);
  if (!modPtr) {
    extLib._openmpt_module_ext_destroy?.(modExtPtr);
    throw new Error('openmpt_module_ext_get_module returned 0');
  }

  const interfacePtr = lib._malloc(INTERACTIVE_INTERFACE_SIZE);
  const interfaceIdPtr = lib.stringToUTF8('interactive');
  const ok = getInterface(modExtPtr, interfaceIdPtr, interfacePtr, INTERACTIVE_INTERFACE_SIZE);
  lib._free(interfaceIdPtr);

  if (!ok) {
    lib._free(interfacePtr);
    extLib._openmpt_module_ext_destroy?.(modExtPtr);
    throw new Error('openmpt_module_ext_get_interface("interactive") failed');
  }

  return { modExtPtr, modPtr, interfacePtr };
}

export function destroyExtModule(lib: LibOpenMPT, handle: OpenMPTExtModule): void {
  const extLib = lib as ExtLib;
  lib._free(handle.interfacePtr);
  extLib._openmpt_module_ext_destroy?.(handle.modExtPtr);
}

/** Apply a per-channel mute mask before offline render. */
export function applyChannelMuteMask(
  lib: LibOpenMPT,
  handle: OpenMPTExtModule,
  muteMask: boolean[],
  numChannels: number,
): void {
  const extLib = lib as ExtLib;
  const getValue = requireExtFn<NonNullable<ExtLib['getValue']>>(extLib, 'getValue');
  const dynCall = requireExtFn<NonNullable<ExtLib['dynCall']>>(extLib, 'dynCall');
  const muteFnPtr = getValue(handle.interfacePtr + INTERACTIVE_MUTE_FN_OFFSET, 'i32');
  if (!muteFnPtr) {
    throw new Error('interactive.set_channel_mute_status function pointer is null');
  }

  for (let ch = 0; ch < numChannels; ch++) {
    const muted = muteMask[ch] === true ? 1 : 0;
    dynCall('iiii', muteFnPtr, [handle.modExtPtr, ch, muted]);
  }
}
