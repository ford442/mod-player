import { startTransition } from 'react';
import type { ModuleInfo, PlayheadDebugSnapshot, SyncDebugInfo } from '../../types';
import { computeNoteAges } from '../../utils/patternExtractor';
import {
  getAudioHeardTime,
  predictPlayheadFromSample,
  rowsPerSecondFromBpm,
} from '../../utils/playheadPrediction';
import {
  trackPositionReport,
  updatePlayheadLagTracker,
} from '../../utils/playheadLagMonitor';
import {
  DIRECT_ROW_SMOOTHING,
  isPlayheadDebugEnabled,
  MAX_DRIFT_SECONDS,
  SYNC_DEBUG_UI_INTERVAL_MS,
  WORKLET_ROW_SMOOTHING,
} from './constants';
import type { UpdateUIParams } from './types';

/** TIMING FIX: Improved updateUI with drift compensation and proper interpolation */
export function createUpdateUI({
  refs,
  setters,
  activeEngine,
  kickTrigger,
  grooveAmount,
}: UpdateUIParams): () => void {
  const {
    libopenmptRef,
    currentModulePtr,
    audioContextRef,
    scriptProcessorRef,
    workletOrderRef,
    workletRowRef,
    workletTimeRef,
    workletBpmRef,
    workletRowsPerSecRef,
    workletPositionSampleRef,
    workletTimestampRef,
    audioClockStartRef,
    workletTimeAtStartRef,
    driftAccumulatorRef,
    lastCorrectedTimeRef,
    pendingSeekRef,
    seekAcknowledgedRef,
    patternMatricesRef,
    channelStatesRef,
    isPlayingRef,
    playheadLagTrackerRef,
    positionReportTrackerRef,
    lastPositionSampleTimeRef,
    updateUIRef,
    uiLoopActiveRef,
    lastUiOrderRef,
    lastUiRowIntRef,
    lastUiBpmRef,
    lastSyncDebugUiMsRef,
    noteAgesScratchRef,
    lastChannelStatePublishMsRef,
    playbackStateRef,
    animationFrameHandle,
    lastUpdateTimeRef,
    audioWorkletNodeRef,
    nativeEngineRef,
  } = refs;

  const {
    setModuleInfo,
    setSequencerMatrix,
    setSequencerCurrentRow,
    setSequencerGlobalRow,
    setPlaybackSeconds,
    setPlaybackRowFraction,
    setChannelStates,
    setBeatPhase,
    setSyncDebug,
  } = setters;

  return () => {
    if (!isPlayingRef.current) return;

    uiLoopActiveRef.current = true;

    const wallNowMs = performance.now();

    const lib = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    const audioCtx = audioContextRef.current;

    let order = 0;
    let row = 0;
    let time = 0;
    let currentBpm = workletBpmRef.current;
    let rowSmoothing = DIRECT_ROW_SMOOTHING;
    let playheadDebugSampleRow: number | undefined;
    let playheadDebugPredictedRow: number | undefined;
    let playheadDebugDtSec = 0;
    let playheadDebugRowsPerSec = 0;

    const usingWorkletEngine =
      (activeEngine === 'worklet' || activeEngine === 'native-worklet') &&
      (audioWorkletNodeRef.current != null || nativeEngineRef.current != null);

    if (usingWorkletEngine && audioCtx) {
      rowSmoothing = WORKLET_ROW_SMOOTHING;
      const sample = workletPositionSampleRef.current;
      order = workletOrderRef.current;
      row = workletRowRef.current;
      time = workletTimeRef.current;
      currentBpm = workletBpmRef.current;

      if (sample) {
        const heardTime = getAudioHeardTime(audioCtx);
        const rowsPerSec =
          workletRowsPerSecRef.current || rowsPerSecondFromBpm(sample.bpm || currentBpm);
        const predicted = predictPlayheadFromSample(sample, heardTime, rowsPerSec);
        row = predicted.playheadRow;
        time = predicted.positionSeconds;
        order = sample.order;
        if (sample.bpm > 0) currentBpm = sample.bpm;
        if (isPlayheadDebugEnabled()) {
          playheadDebugSampleRow = sample.row;
          playheadDebugPredictedRow = predicted.playheadRow;
          playheadDebugDtSec = predicted.dtSec;
          playheadDebugRowsPerSec = rowsPerSec;
        }
      }

      if (sample && audioClockStartRef.current > 0) {
        const heardTime = getAudioHeardTime(audioCtx);
        const expectedTime = workletTimeAtStartRef.current + (heardTime - audioClockStartRef.current);
        const drift = time - expectedTime;
        driftAccumulatorRef.current = driftAccumulatorRef.current * 0.9 + drift * 0.1;
        if (Math.abs(driftAccumulatorRef.current) > MAX_DRIFT_SECONDS) {
          audioClockStartRef.current = heardTime;
          workletTimeAtStartRef.current = time;
          driftAccumulatorRef.current = 0;
        }
        lastCorrectedTimeRef.current = audioCtx.currentTime;
      }
    } else if (scriptProcessorRef.current && lib && modPtr !== 0) {
      order = lib._openmpt_module_get_current_order(modPtr);
      row = lib._openmpt_module_get_current_row(modPtr);
      time = lib._openmpt_module_get_position_seconds(modPtr);
      const bpm = lib._openmpt_module_get_current_estimated_bpm(modPtr);
      if (bpm > 0) currentBpm = bpm;
      rowSmoothing = DIRECT_ROW_SMOOTHING;
      if (isPlayheadDebugEnabled()) {
        playheadDebugSampleRow = row;
        playheadDebugPredictedRow = row;
        playheadDebugRowsPerSec = rowsPerSecondFromBpm(currentBpm);
      }
    } else {
      if (!lib || modPtr === 0) return;
      order = lib._openmpt_module_get_current_order(modPtr);
      row = lib._openmpt_module_get_current_row(modPtr);
      time = lib._openmpt_module_get_position_seconds(modPtr);
    }

    if (pendingSeekRef.current && !seekAcknowledgedRef.current) {
      const seekAge =
        (audioCtx ? audioCtx.currentTime : performance.now() / 1000) -
        pendingSeekRef.current.timestamp;
      if (seekAge > 0.5) {
        seekAcknowledgedRef.current = true;
        pendingSeekRef.current = null;
      }
    }

    const targetPlayhead = row;
    const prevPlayhead = playbackStateRef.current.playheadRow;
    // Worklet path: prediction already tracks the audio clock — skip EMA lag.
    let smoothedPlayhead = usingWorkletEngine
      ? targetPlayhead
      : prevPlayhead + (targetPlayhead - prevPlayhead) * rowSmoothing;

    const orderUnchanged = order === lastUiOrderRef.current;
    const snapThreshold = orderUnchanged ? 0.5 : 1.0;
    if (Math.abs(targetPlayhead - prevPlayhead) > snapThreshold) {
      smoothedPlayhead = targetPlayhead;
    }
    if (smoothedPlayhead < 0) smoothedPlayhead = 0;

    const engineMode = scriptProcessorRef.current ? 'scriptprocessor' : activeEngine;
    const rowIntUi = Math.floor(smoothedPlayhead);
    const orderChanged = order !== lastUiOrderRef.current;
    const rowChanged = rowIntUi !== lastUiRowIntRef.current;
    const bpmChanged = Math.abs(currentBpm - lastUiBpmRef.current) >= 0.5;

    if (orderChanged) {
      const newMatrix = patternMatricesRef.current[order];
      let globalRow = 0;
      for (let i = 0; i < order; i++) {
        globalRow += patternMatricesRef.current[i]?.numRows || 64;
      }
      startTransition(() => {
        if (newMatrix) setSequencerMatrix(newMatrix);
        setModuleInfo((prev: ModuleInfo) => ({ ...prev, order, row: rowIntUi, bpm: currentBpm }));
        setSequencerCurrentRow(rowIntUi);
        setPlaybackSeconds(time);
        setPlaybackRowFraction(smoothedPlayhead);
        setSequencerGlobalRow(globalRow + rowIntUi);
      });
      lastUiOrderRef.current = order;
      lastUiRowIntRef.current = rowIntUi;
      lastUiBpmRef.current = currentBpm;
    } else {
      if (rowChanged || bpmChanged) {
        setModuleInfo((prev: ModuleInfo) => ({ ...prev, order, row: rowIntUi, bpm: currentBpm }));
        lastUiBpmRef.current = currentBpm;
      }

      if (rowChanged) {
        setSequencerCurrentRow(rowIntUi);
        setPlaybackSeconds(time);
        setPlaybackRowFraction(smoothedPlayhead);
        lastUiRowIntRef.current = rowIntUi;

        let globalRow = 0;
        for (let i = 0; i < order; i++) {
          globalRow += patternMatricesRef.current[i]?.numRows || 64;
        }
        setSequencerGlobalRow(globalRow + rowIntUi);
      }
    }

    const playheadRow = smoothedPlayhead;
    const currentMatrix = patternMatricesRef.current[order];
    const numChannels = channelStatesRef.current.length;
    if (currentMatrix && numChannels > 0) {
      let agesScratch = noteAgesScratchRef.current;
      if (agesScratch.length !== numChannels) {
        agesScratch = new Array(numChannels);
        noteAgesScratchRef.current = agesScratch;
      }
      const noteAges = computeNoteAges(currentMatrix, playheadRow, agesScratch);
      let stateChanged = false;
      const publishChannelUi =
        rowChanged ||
        orderChanged ||
        wallNowMs - lastChannelStatePublishMsRef.current >= 100;

      const spLib = activeEngine !== 'worklet' && activeEngine !== 'native-worklet' ? lib : null;
      const spPtr = spLib && modPtr !== 0 ? modPtr : 0;

      for (let c = 0; c < numChannels; c++) {
        const existing = channelStatesRef.current[c];
        if (!existing) continue;

        const newAge = noteAges[c] ?? 1000;
        if ((newAge | 0) !== (existing.noteAge | 0)) {
          stateChanged = true;
        }
        existing.noteAge = newAge;

        if (spLib && spPtr) {
          const vu: number = spLib._openmpt_module_get_current_channel_vu_mono(spPtr, c) as number;
          existing.volume = vu;
          existing.trigger = vu > 0.05 ? 1 : 0;
        }
      }

      if (stateChanged && publishChannelUi) {
        const snapshot = channelStatesRef.current.slice();
        lastChannelStatePublishMsRef.current = wallNowMs;
        startTransition(() => {
          setChannelStates(snapshot);
        });
      }
    }

    const beatPhaseValue = (time * 2) % 1;
    const now = workletTimestampRef.current ?? (audioCtx?.currentTime ?? performance.now() / 1000);
    playbackStateRef.current = {
      playheadRow: smoothedPlayhead,
      currentOrder: order,
      timeSec: time,
      beatPhase: beatPhaseValue,
      kickTrigger,
      grooveAmount,
      lastUpdateTimestamp: now,
    };

    if (isPlayheadDebugEnabled()) {
      const sampleRow = playheadDebugSampleRow ?? smoothedPlayhead;
      const lagUpdate = updatePlayheadLagTracker(
        playheadLagTrackerRef.current,
        sampleRow,
        smoothedPlayhead,
        wallNowMs,
      );
      playheadLagTrackerRef.current = lagUpdate.tracker;

      const sampleTime = workletPositionSampleRef.current?.workletTime;
      let positionReportHz = positionReportTrackerRef.current.hz;
      if (sampleTime != null && sampleTime !== lastPositionSampleTimeRef.current) {
        lastPositionSampleTimeRef.current = sampleTime;
        const rateUpdate = trackPositionReport(positionReportTrackerRef.current, wallNowMs);
        positionReportTrackerRef.current = rateUpdate.tracker;
        positionReportHz = rateUpdate.tracker.hz;
        if (rateUpdate.warning) {
          console.warn(`[Playhead] ${rateUpdate.warning}`);
        }
      }

      if (lagUpdate.warning) {
        console.warn(`[Playhead] ${lagUpdate.warning}`);
      }

      const snapshot: PlayheadDebugSnapshot = {
        sampleRow,
        predictedRow: playheadDebugPredictedRow ?? smoothedPlayhead,
        smoothedRow: smoothedPlayhead,
        dtSec: playheadDebugDtSec,
        rowsPerSec: playheadDebugRowsPerSec || rowsPerSecondFromBpm(currentBpm),
        predictionLagRows: smoothedPlayhead - sampleRow,
        driftMs: Math.round(driftAccumulatorRef.current * 1000),
        mode: engineMode,
        maxAbsLagRows: lagUpdate.tracker.maxAbsLagRows,
        positionReportHz,
      };
      window.__PLAYHEAD_DEBUG__ = snapshot;
    }

    if (wallNowMs - lastSyncDebugUiMsRef.current >= SYNC_DEBUG_UI_INTERVAL_MS) {
      lastSyncDebugUiMsRef.current = wallNowMs;
      setBeatPhase(beatPhaseValue);
      setSyncDebug((prev: SyncDebugInfo) => {
        const {
          sampleRow: _sr,
          predictedRow: _pr,
          smoothedRow: _sm,
          dtSec: _dt,
          rowsPerSec: _rps,
          predictionLagRows: _plr,
          ...base
        } = prev;
        const next: SyncDebugInfo = {
          ...base,
          driftMs: Math.round(driftAccumulatorRef.current * 1000),
          row: rowIntUi,
          mode: engineMode,
          bufferMs: Math.round(
            ((audioContextRef.current?.baseLatency ?? 0) +
              (audioContextRef.current?.outputLatency ?? 0)) *
              1000,
          ),
          audioContextState: audioContextRef.current?.state || 'none',
          sampleRate: audioContextRef.current?.sampleRate || 0,
          baseLatency: audioContextRef.current?.baseLatency ?? 0,
          outputLatency: audioContextRef.current?.outputLatency ?? 0,
          workletSupported: typeof AudioWorklet !== 'undefined',
          wasmSupported: typeof WebAssembly !== 'undefined',
          driftAccumulator: driftAccumulatorRef.current,
          lastCorrectedTime: lastCorrectedTimeRef.current,
          lastWorkletUpdate: refs.lastWorkletUpdateRef.current,
          seekPending: !!pendingSeekRef.current,
        };
        if (isPlayheadDebugEnabled()) {
          if (playheadDebugSampleRow != null) next.sampleRow = playheadDebugSampleRow;
          if (playheadDebugPredictedRow != null) next.predictedRow = playheadDebugPredictedRow;
          next.smoothedRow = smoothedPlayhead;
          next.dtSec = playheadDebugDtSec;
          next.rowsPerSec = playheadDebugRowsPerSec || rowsPerSecondFromBpm(currentBpm);
          if (playheadDebugSampleRow != null) {
            next.predictionLagRows = smoothedPlayhead - playheadDebugSampleRow;
          }
        }
        return next;
      });
    }

    lastUpdateTimeRef.current = wallNowMs / 1000;
    if (uiLoopActiveRef.current) {
      animationFrameHandle.current = requestAnimationFrame(() => {
        updateUIRef.current?.();
      });
    }
  };
}
