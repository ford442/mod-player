import type { PatternMatrix } from '../../types';
import { parseModuleWithNative } from '../../audio-worklet/NativePatternReader';
import { backfillPatternMatrices } from '../../utils/parseModuleWithLib';
import { parserLog } from '../../utils/parserDebug';
import { createParserWorker, PARSER_SLOW_HINT_MS } from '../../utils/parserWorker';
import { rowsPerSecondFromBpm } from '../../utils/playheadPrediction';
import {
  createPlayheadLagTracker,
  createPositionReportTracker,
} from '../../utils/playheadLagMonitor';
import {
  emptyInstrumentTable,
  isLibReadyForParse,
  resolveParsedModule,
} from './parseModule';
import type { LibOpenMPTRefs, LibOpenMPTSetters } from './types';

export interface ModuleActionsDeps {
  refs: LibOpenMPTRefs;
  setters: LibOpenMPTSetters;
  stopMusic: (destroy?: boolean) => void;
}

export function createEnsureMainThreadModule(refs: LibOpenMPTRefs) {
  return async (data: Uint8Array) => {
    const lib = refs.libopenmptRef.current;
    if (!lib) {
      console.error('[ensureMainThreadModule] libopenmpt not initialized');
      return;
    }
    if (refs.currentModulePtr.current !== 0) return;

    const bufferSize = data.byteLength;
    const bufferPtr = lib._malloc(bufferSize);
    lib.HEAPU8.set(data, bufferPtr);
    const modPtr = lib._openmpt_module_create_from_memory2(
      bufferPtr, bufferSize, 0, 0, 0, 0, 0, 0, 0,
    );
    lib._free(bufferPtr);

    if (modPtr !== 0) {
      refs.currentModulePtr.current = modPtr;
      console.log('[ensureMainThreadModule] Main-thread module created for fallback');
    } else {
      console.error('[ensureMainThreadModule] Failed to create main-thread module');
    }
  };
}

export function createProcessModuleData(deps: ModuleActionsDeps) {
  const { refs, setters, stopMusic } = deps;
  const {
    libopenmptRef,
    currentModulePtr,
    fileDataRef,
    workerRef,
    parserWorkerHealthyRef,
    patternBackfillAbortRef,
    patternMatricesRef,
    workletBpmRef,
    workletRowsPerSecRef,
    audioClockStartRef,
    workletTimeAtStartRef,
    nativeClockAnchorRef,
    driftAccumulatorRef,
    lastCorrectedTimeRef,
    lastWorkletUpdateRef,
    workletPositionSampleRef,
    pendingSeekRef,
    lastUiOrderRef,
    lastUiRowIntRef,
    lastUiBpmRef,
    lastSyncDebugUiMsRef,
    seekAcknowledgedRef,
    playbackStateRef,
    channelStatesRef,
    workletModuleTokenRef,
    playheadLagTrackerRef,
    positionReportTrackerRef,
    lastPositionSampleTimeRef,
  } = refs;

  const {
    setStatus,
    setIsModuleLoaded,
    setPlaybackRowFraction,
    setModuleInfo,
    setInstrumentNames,
    setSampleNames,
    setModuleFormat,
    setInstrumentTable,
    setModuleComments,
    setModuleDurationSeconds,
    setModuleFileName,
    setTotalPatternRows,
    setSequencerMatrix,
    setSequencerCurrentRow,
    setSequencerGlobalRow,
    setChannelStates,
  } = setters;

  return async (fileData: Uint8Array, fileName: string) => {
    const lib = libopenmptRef.current;
    if (!lib) {
      console.error('[processModuleData] libopenmpt not initialized');
      setStatus('Error: Audio library not initialized');
      return;
    }

    console.log('[processModuleData] Processing module:', fileName, 'size:', fileData.byteLength);

    workletModuleTokenRef.current += 1;
    playheadLagTrackerRef.current = createPlayheadLagTracker();
    positionReportTrackerRef.current = createPositionReportTracker();
    lastPositionSampleTimeRef.current = -1;
    stopMusic(false);

    setIsModuleLoaded(false);
    setPlaybackRowFraction(0);

    if (currentModulePtr.current !== 0) {
      console.log('[processModuleData] Destroying previous main-thread module');
      lib._openmpt_module_destroy(currentModulePtr.current);
      currentModulePtr.current = 0;
    }

    const fileDataCopy = fileData.slice();
    fileDataRef.current = fileDataCopy;

    const nativeEngineEarly = refs.nativeEngineRef.current;
    const useNativeParse =
      refs.activeEngineRef.current === 'native-worklet' && nativeEngineEarly != null;

    const useWorkerParse = !useNativeParse && !isLibReadyForParse(lib);
    if (useWorkerParse && !workerRef.current && parserWorkerHealthyRef.current) {
      try {
        workerRef.current = createParserWorker((message) => {
          parserWorkerHealthyRef.current = false;
          if (workerRef.current) {
            try { workerRef.current.terminate(); } catch { /* ignore */ }
            workerRef.current = null;
          }
          console.error(`[Parser] worker unhealthy (${fileName}):`, message);
        });
      } catch (workerErr) {
        parserWorkerHealthyRef.current = false;
        console.warn(`[processModuleData] Failed to create parser worker (${fileName}):`, workerErr);
      }
    }

    setStatus(`Parsing "${fileName}"…`);
    parserLog('processModuleData start', fileName);

    const slowHintTimer = window.setTimeout(() => {
      setStatus(`Parsing "${fileName}"… (still loading)`);
    }, PARSER_SLOW_HINT_MS);

    const onParseProgress = (stage: 'fetch' | 'wasm' | 'patterns' | 'instruments') => {
      if (stage === 'fetch') {
        setStatus(`Parsing "${fileName}"… (fetching parser engine)`);
      } else if (stage === 'patterns') {
        setStatus(`Parsing "${fileName}"… (reading patterns)`);
      }
    };

    let patternMatrices: PatternMatrix[];
    let metadata: import('../../types').WorkerParseResponse['metadata'];
    let loadedInstrumentTable = emptyInstrumentTable();

    try {
      if (useNativeParse && nativeEngineEarly) {
        onParseProgress?.('patterns');
        const nativeBuf = new Uint8Array(fileDataCopy.byteLength);
        nativeBuf.set(fileDataCopy);
        await nativeEngineEarly.load(nativeBuf.buffer);
        const nativeMod = nativeEngineEarly.getNativeModule();
        if (!nativeMod || nativeMod._get_num_orders() <= 0) {
          throw new Error('Native pattern reader: module not ready after load');
        }
        const parsed = parseModuleWithNative(nativeMod, fileDataCopy, fileName);
        patternMatrices = parsed.patternMatrices;
        metadata = parsed.metadata;
        loadedInstrumentTable = parsed.instrumentTable ?? emptyInstrumentTable();
      } else {
        const parsed = await resolveParsedModule(
          lib,
          useWorkerParse && parserWorkerHealthyRef.current ? workerRef.current : null,
          workerRef,
          fileData,
          fileDataCopy,
          fileName,
          onParseProgress,
        );
        patternMatrices = parsed.patternMatrices;
        metadata = parsed.metadata;
        loadedInstrumentTable = parsed.instrumentTable ?? emptyInstrumentTable();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Module parse failed';
      console.error(`[processModuleData] Parse failed (${fileName}):`, err);
      setStatus(`Error: ${message}`);
      return;
    } finally {
      window.clearTimeout(slowHintTimer);
    }

    if (!patternMatrices.length || !metadata.numOrders) {
      setStatus('Error: No pattern data in module');
      console.error('[Parser] empty patternMatrices after parse');
      return;
    }

    patternBackfillAbortRef.current?.abort();
    const matrices: (PatternMatrix | null)[] = new Array(metadata.numOrders).fill(null);
    matrices[0] = patternMatrices[0] ?? null;
    for (let i = 1; i < patternMatrices.length; i++) {
      matrices[i] = patternMatrices[i] ?? null;
    }
    patternMatricesRef.current = matrices;

    const patternsComplete = patternMatrices.length >= metadata.numOrders;
    if (!patternsComplete && isLibReadyForParse(lib) && refs.activeEngineRef.current !== 'native-worklet') {
      const backfillAbort = new AbortController();
      patternBackfillAbortRef.current = backfillAbort;
      const backfillFileName = fileName;
      void backfillPatternMatrices(
        lib,
        fileDataCopy,
        metadata.numOrders,
        matrices,
        { startOrder: patternMatrices.length, signal: backfillAbort.signal },
      )
        .then(() => {
          if (backfillAbort.signal.aborted) return;
          console.log(
            `[Parser] pattern backfill complete (${backfillFileName}):`,
            metadata.numOrders,
            'orders',
          );
        })
        .catch((err) => {
          if (!backfillAbort.signal.aborted) {
            console.warn(`[Parser] pattern backfill failed (${backfillFileName}):`, err);
          }
        });
    }

    workletBpmRef.current = metadata.initialBpm || 125;

    setModuleInfo({
      title: metadata.title || fileName,
      order: 0,
      row: 0,
      bpm: metadata.initialBpm,
      numChannels: metadata.numChannels,
    });
    setInstrumentNames(metadata.instruments ?? []);
    setSampleNames(metadata.samples ?? []);
    setModuleFormat(metadata.format ?? '');
    setInstrumentTable(loadedInstrumentTable);
    setModuleComments(metadata.comments ?? '');
    setModuleDurationSeconds(metadata.durationSeconds);
    setModuleFileName(fileName);
    setTotalPatternRows(metadata.totalPatternRows);

    setSequencerMatrix(patternMatrices[0] ?? null);
    setSequencerCurrentRow(0);
    setSequencerGlobalRow(0);
    setChannelStates(
      new Array(metadata.numChannels).fill({
        volume: 0, pan: 128, freq: 0, trigger: 0, noteAge: 0,
        activeEffect: 0, effectValue: 0, isMuted: 0,
      }),
    );
    channelStatesRef.current = new Array(metadata.numChannels)
      .fill(null)
      .map(() => ({
        volume: 0, pan: 128, freq: 0, trigger: 0, noteAge: 0,
        activeEffect: 0, effectValue: 0, isMuted: 0,
      }));

    audioClockStartRef.current = 0;
    workletTimeAtStartRef.current = 0;
    nativeClockAnchorRef.current = null;
    driftAccumulatorRef.current = 0;
    lastCorrectedTimeRef.current = 0;
    lastWorkletUpdateRef.current = 0;
    workletPositionSampleRef.current = null;
    workletRowsPerSecRef.current = rowsPerSecondFromBpm(125);
    pendingSeekRef.current = null;
    lastUiOrderRef.current = -1;
    lastUiRowIntRef.current = -1;
    lastUiBpmRef.current = -1;
    lastSyncDebugUiMsRef.current = 0;
    seekAcknowledgedRef.current = true;

    playbackStateRef.current = {
      playheadRow: 0,
      currentOrder: 0,
      timeSec: 0,
      beatPhase: 0,
      kickTrigger: 0,
      grooveAmount: 0.5,
      lastUpdateTimestamp: 0,
    };

    setIsModuleLoaded(true);
    setStatus(`Loaded "${metadata.title || fileName}"`);
  };
}

export function createLoadModule(
  refs: LibOpenMPTRefs,
  setStatus: (status: string) => void,
  processModuleData: (fileData: Uint8Array, fileName: string) => Promise<void>,
) {
  return async (fileData: Uint8Array, fileName: string) => {
    if (!refs.libopenmptRef.current) return;
    refs.userModuleLoadedRef.current = true;
    setStatus(`Loading "${fileName}"...`);
    await processModuleData(fileData, fileName);
    if (refs.playRef.current) refs.playRef.current({ forceModuleLoad: true });
  };
}
