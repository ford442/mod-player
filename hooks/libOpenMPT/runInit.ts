import { logWorkletDiagnostics } from '../../audio-worklet/diagnostics';
import { OpenMPTWorkletEngine } from '../../audio-worklet/OpenMPTWorkletEngine';
import {
  resolveAudioEnginePreference,
  shouldPromoteNativeEngine,
  writeStoredAudioEngineOverride,
  isPublicModeAudioBuild,
} from '../../utils/audioEngineSelection';
import {
  getNativeGlueUrl,
  isNativeGlueAvailable,
} from '../useWorkletLoader';
import { verifyParserWorkerUrl } from '../../utils/parserWorker';
import type { LibOpenMPTRefs, LibOpenMPTSetters } from './types';
import { WORKLET_URL } from './constants';
import { setPcmDemandListener } from '../../utils/pcmBus';

export interface InitDeps {
  refs: LibOpenMPTRefs;
  setters: Pick<
    LibOpenMPTSetters,
    | 'setStatus'
    | 'setIsReady'
    | 'setIsWorkletSupported'
    | 'setActiveEngine'
    | 'setWorkletLoadError'
    | 'setIsNativeWorkletAvailable'
  >;
  checkWorkletSupport: () => boolean;
  verifyWorkletFile: () => Promise<boolean>;
}

function polyfillLibStrings(lib: import('../../types').LibOpenMPT) {
  if (!lib.UTF8ToString) {
    console.warn('Polyfilling libopenmpt.UTF8ToString...');
    lib.UTF8ToString = (ptr) => {
      let str = '';
      if (!ptr) return str;
      const heap = lib.HEAPU8;
      for (let i = 0; ; i++) {
        const byte = heap[ptr + i];
        if (byte === undefined || byte === 0) break;
        str += String.fromCharCode(byte);
      }
      return str;
    };
  }
  if (!lib.stringToUTF8) {
    console.warn('Polyfilling libopenmpt.stringToUTF8...');
    lib.stringToUTF8 = (jsString) => {
      const length = (jsString.length << 2) + 1;
      const ptr = lib._malloc(length);
      const heap = lib.HEAPU8;
      let i = 0;
      let j = 0;
      while (i < jsString.length) heap[ptr + j++] = jsString.charCodeAt(i++);
      heap[ptr + j] = 0;
      return ptr;
    };
  }
}

export async function runLibOpenMPTInit(deps: InitDeps): Promise<void> {
  const { refs, setters, checkWorkletSupport, verifyWorkletFile } = deps;
  const {
    setStatus,
    setIsReady,
    setIsWorkletSupported,
    setActiveEngine,
    setWorkletLoadError,
    setIsNativeWorkletAvailable,
  } = setters;

  console.log('[INIT] Starting libopenmpt initialization...');

  if (!window.libopenmptReady) {
    setStatus('Error: libopenmpt initialization script not found.');
    console.error('[INIT] window.libopenmptReady promise not found. Check index.html.');
    return;
  }

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Initialization timed out')), 15000);
    });

    console.log('[INIT] Waiting for libopenmptReady...');
    const lib = await Promise.race([window.libopenmptReady, timeoutPromise]);
    console.log('[INIT] libopenmptReady resolved');

    polyfillLibStrings(lib);
    refs.libopenmptRef.current = lib;
    setIsReady(true);

    void verifyParserWorkerUrl().then((ok: boolean) => {
      if (!ok) {
        console.warn(
          '[Parser] Worker script HEAD check failed (diagnostic only; will still attempt worker parse)',
        );
      }
    });

    console.log('[INIT] Testing AudioWorklet support...');
    try {
      const hasWorkletSupport = checkWorkletSupport();
      logWorkletDiagnostics(WORKLET_URL);

      if (hasWorkletSupport) {
        const fileAccessible = await verifyWorkletFile();

        if (fileAccessible) {
          setIsWorkletSupported(true);
          setActiveEngine('worklet');
          console.log('✅ [INIT] AudioWorklet API available and file accessible');
        } else {
          console.warn('⚠️ [INIT] AudioWorklet API available but worklet file not accessible');
          setIsWorkletSupported(false);
          setWorkletLoadError(`Worklet file not found at ${WORKLET_URL}. Check deployment.`);
          setStatus('Error: Worklet file not accessible.');
        }
      } else {
        console.warn('⚠️ [INIT] AudioWorklet API not available in this browser');
        setIsWorkletSupported(false);
        setWorkletLoadError('AudioWorklet not supported in this browser');
        setStatus('Error: AudioWorklet not supported in this browser.');
      }
    } catch (e) {
      console.warn('⚠️ [INIT] AudioWorklet API check failed:', e);
      setIsWorkletSupported(false);
      setWorkletLoadError('AudioWorklet check failed: ' + (e as Error).message);
      setStatus('Error: AudioWorklet not supported in this browser.');
    }

    const enginePref = resolveAudioEnginePreference();
    console.log('[INIT] Audio engine preference:', enginePref);
    setActiveEngine('worklet');

    if (enginePref.mode === 'force-js') {
      console.log('[INIT] force-JS default — JS worklet is active engine');
    } else if (enginePref.mode === 'auto') {
      console.log('[INIT] auto mode — native promotes only when parity gate is open and glue is present');
    }

    const shouldProbeNative =
      enginePref.mode === 'prefer-native'
      || enginePref.mode === 'auto'
      || !isPublicModeAudioBuild();

    if (shouldProbeNative) {
      try {
        const nativeGlueUrl = getNativeGlueUrl();
        console.log('[INIT] Probing for native engine at:', nativeGlueUrl);
        const glueIsSafe = await isNativeGlueAvailable(nativeGlueUrl);

        if (glueIsSafe) {
          console.log('[INIT] Native C++/Wasm AudioWorklet glue detected');

          const engine = new OpenMPTWorkletEngine();
          await engine.init();
          refs.nativeEngineRef.current = engine;
          setIsNativeWorkletAvailable(true);

          if (shouldPromoteNativeEngine(enginePref, true)) {
            setActiveEngine('native-worklet');
            console.log('[INIT] Native engine initialized and promoted (preference:', enginePref.mode, ')');
          } else {
            if (enginePref.mode === 'force-js') {
              writeStoredAudioEngineOverride('js');
            }
            if (enginePref.mode === 'auto') {
              console.log('[INIT] Native glue present but parity gate closed — staying on JS worklet');
            }
            console.log('[INIT] Native engine initialized but not promoted — active engine is JS worklet');
          }
        } else if (enginePref.mode === 'prefer-native') {
          console.warn(
            '[INIT] ?engine=native / localStorage prefer-native but glue missing — soft-fail to JS worklet',
          );
          setActiveEngine('worklet');
        } else {
          console.log('[INIT] Native engine glue not available — using JS AudioWorklet');
          setActiveEngine('worklet');
        }
      } catch (nativeErr) {
        console.warn('[INIT] Native engine probe failed — using JS AudioWorklet fallback:', nativeErr);
        setIsNativeWorkletAvailable(false);
        setActiveEngine('worklet');
      }
    } else if (isPublicModeAudioBuild()) {
      setIsNativeWorkletAvailable(false);
    }
  } catch (e) {
    const error = e as Error;
    if (error.message === 'Initialization timed out') {
      setStatus('Error: libopenmpt initialization timed out.');
    } else {
      setStatus(`Error: ${error.message || 'Audio library failed to load'}`);
      console.error('Error awaiting libopenmptReady:', e);
    }
  }
}

export function cleanupLibOpenMPT(refs: LibOpenMPTRefs) {
  console.log('Cleaning up libopenmpt resources.');
  // Drop the PCM demand listener before the node goes away; the next
  // startJsWorkletPlayback installs a fresh one bound to the new node.
  setPcmDemandListener(null);
  if (refs.nativeEngineRef.current) {
    refs.nativeEngineRef.current.destroy();
    refs.nativeEngineRef.current = null;
  }
  if (refs.audioWorkletNodeRef.current) refs.audioWorkletNodeRef.current.disconnect();
  if (refs.stereoPannerRef.current) refs.stereoPannerRef.current.disconnect();
  if (refs.audioContextRef.current && refs.audioContextRef.current.state !== 'closed') {
    refs.audioContextRef.current.close();
  }
  if (refs.currentModulePtr.current !== 0 && refs.libopenmptRef.current) {
    refs.libopenmptRef.current._openmpt_module_destroy(refs.currentModulePtr.current);
  }
  if (refs.workerRef.current) {
    refs.workerRef.current.terminate();
    refs.workerRef.current = null;
  }
  cancelAnimationFrame(refs.animationFrameHandle.current);
}
