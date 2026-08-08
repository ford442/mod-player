import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import {
  calculateNoteDurations,
  packPatternMatrixHighPrecision,
  PACKEDB_TRIGGER_FLAG,
  isTriggerFromPackedB,
} from '../utils/gpuPacking';
import { usesCircularRowPaging } from '../utils/shaderVersion';
import { circularPageStart, overlayActualRow } from '../utils/playheadPrediction';
import type { PatternMatrix, PlaybackState } from '../types';

export interface UseAppTestHooksParams {
  seekToStep: (step: number) => void;
  stopMusic: (ended?: boolean) => void;
  playGuarded: () => void;
  isPlaying: boolean;
  getAudioContext: () => AudioContext | null | undefined;
  isModuleLoaded: boolean;
  sequencerMatrix: PatternMatrix | null;
  loadFile: (fileData: Uint8Array, fileName: string) => void | Promise<void>;
  setPlaybackRowFraction: (value: number) => void;
  playbackStateRef: MutableRefObject<PlaybackState>;
  activeEngine: string;
  liteMode: boolean;
  getMasterGainValue: () => number | null;
  getMasterPanValue: () => number | null;
  applyAudioMasterLevels: (volume: number, pan: number) => void;
  volume: number;
  pan: number;
}

/** Headless Chrome / Playwright automation hooks (dev server + CI captures). */
export function useAppTestHooks(params: UseAppTestHooksParams): void {
  const {
    seekToStep,
    stopMusic,
    playGuarded,
    isPlaying,
    getAudioContext,
    isModuleLoaded,
    sequencerMatrix,
    loadFile,
    setPlaybackRowFraction,
    playbackStateRef,
    activeEngine,
    liteMode,
    getMasterGainValue,
    getMasterPanValue,
    applyAudioMasterLevels,
    volume,
    pan,
  } = params;

  useEffect(() => {
    window.__TEST_HOOKS__ = {
      seekToRow: (row: number) => seekToStep(row),
      stopPlayback: () => stopMusic(false),
      startPlayback: () => playGuarded(),
      getIsPlaying: () => isPlaying,
      getAudioContextState: () => getAudioContext()?.state ?? 'none',
      isModuleLoaded: () => isModuleLoaded,
      getPatternRenderer: () => window.currentPatternRenderer,
      loadModuleFromUrl: async (url: string) => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
        const buf = new Uint8Array(await resp.arrayBuffer());
        const name = url.split('/').pop() || 'module.mod';
        await loadFile(buf, name);
      },
      getTriggerTailStats: () => {
        if (!sequencerMatrix) return null;
        const d = calculateNoteDurations(sequencerMatrix);
        let triggers = 0;
        let sustains = 0;
        for (const row of d) {
          for (const cell of row) {
            if (cell.isTrigger) triggers++;
            if (cell.isSustained) sustains++;
          }
        }
        return {
          triggers,
          sustains,
          rows: sequencerMatrix.numRows,
          channels: sequencerMatrix.numChannels,
        };
      },
      /** Per-row note + TRIG-001 state for Playwright / grok cli verification */
      getRowNotes: (row: number) => {
        if (!sequencerMatrix) return null;
        const d = calculateNoteDurations(sequencerMatrix);
        const raw = sequencerMatrix.rows[row] ?? [];
        const channels = sequencerMatrix.numChannels;
        const cells = [];
        for (let ch = 0; ch < channels; ch++) {
          const cell = raw[ch];
          const info = d[row]?.[ch];
          cells.push({
            ch,
            note: cell?.note ?? 0,
            inst: cell?.inst ?? 0,
            isTrigger: info?.isTrigger ?? false,
            isSustained: info?.isSustained ?? false,
            duration: info?.duration ?? 0,
            rowOffset: info?.rowOffset ?? 0,
            isNoteOff: info?.isNoteOff ?? false,
          });
        }
        return { row, channels, cells };
      },
      /** Packed GPU cell + trigger bit for cross-check against duration oracle */
      getPackedCell: (row: number, ch: number) => {
        if (!sequencerMatrix) return null;
        const { packedData } = packPatternMatrixHighPrecision(sequencerMatrix, false);
        const cols = sequencerMatrix.numChannels;
        const offset = (row * cols + ch) * 2;
        const packedA = packedData[offset] ?? 0;
        const packedB = packedData[offset + 1] ?? 0;
        const durationFlags = (packedB >> 8) & 0x7f;
        const rowOffset = durationFlags >> 1;
        const isNoteOff = (durationFlags & 1) !== 0;
        const note = (packedA >> 24) & 0xff;
        const hasPitch = note >= 1 && note <= 119;
        return {
          row,
          ch,
          packedA,
          packedB,
          note,
          duration: (packedA >> 8) & 0xff,
          triggerFlag: (packedB & PACKEDB_TRIGGER_FLAG) !== 0,
          rowOffset,
          isNoteOff,
          isTrigger: isTriggerFromPackedB(packedB, rowOffset, isNoteOff, hasPitch),
        };
      },
      /** Force fractional playhead for paging regression (does not move audio) */
      setPlayheadFraction: (value: number) => {
        playbackStateRef.current = {
          ...playbackStateRef.current,
          playheadRow: value,
          lastUpdateTimestamp: performance.now() / 1000,
        };
        setPlaybackRowFraction(value);
      },
      getPlaybackRow: () => Math.floor(playbackStateRef.current.playheadRow),
      getPlaybackRowFraction: () => playbackStateRef.current.playheadRow,
      getActiveRenderer: () => window.currentPatternRenderer?.backend ?? null,
      getAudioEngine: () => activeEngine,
      getLiteMode: () => liteMode,
      getShaderFile: () => {
        const raw = localStorage.getItem('xasm1_last_shader');
        if (!raw) return null;
        try {
          return JSON.parse(raw) as string;
        } catch {
          return raw;
        }
      },
      selectShader: (shader: string) => {
        try {
          localStorage.setItem('xasm1_last_shader', JSON.stringify(shader));
          window.dispatchEvent(new StorageEvent('storage', { key: 'xasm1_last_shader' }));
        } catch {
          /* ignore */
        }
      },
      /** Circular hybrid paging — overlay must fetch rows from current page, not 0..N-1 */
      getCircularOverlayPaging: () => {
        const matrix = sequencerMatrix;
        if (!matrix) return { ok: false, reason: 'no matrix' };
        const raw = localStorage.getItem('xasm1_last_shader') ?? '';
        let shader = raw;
        try {
          shader = JSON.parse(raw) as string;
        } catch {
          /* keep raw */
        }
        if (!usesCircularRowPaging(shader)) {
          return { ok: true, skipped: true, reason: 'not circular-paging shader' };
        }
        const playhead = playbackStateRef.current.playheadRow;
        const numRows = matrix.numRows;
        const pageStart = circularPageStart(playhead, numRows);
        const overlayEl = document.querySelector('[data-overlay-canvas="true"]');
        const overlayActive =
          overlayEl != null && getComputedStyle(overlayEl).display !== 'none';
        const mismatches: Array<{
          stepIndex: number;
          expectedRow: number;
          staleRow: number;
          expectedNote: number;
          staleNote: number;
        }> = [];
        const sampleSteps = [0, 1, 16, 32, 63];
        for (const stepIndex of sampleSteps) {
          if (stepIndex >= numRows) continue;
          const expectedRow = overlayActualRow(stepIndex, playhead, numRows);
          const staleRow = stepIndex;
          if (pageStart === 0 || expectedRow === staleRow) continue;
          const expectedNote = matrix.rows[expectedRow]?.[1]?.note ?? 0;
          const staleNote = matrix.rows[staleRow]?.[1]?.note ?? 0;
          if (expectedNote !== staleNote) {
            mismatches.push({ stepIndex, expectedRow, staleRow, expectedNote, staleNote });
          }
        }
        return {
          ok: true,
          playhead,
          numRows,
          pageStart,
          overlayActive,
          mismatches,
          pagingDiffersAtPlayhead: pageStart > 0,
        };
      },
      getPlayheadDebug: () => window.__PLAYHEAD_DEBUG__ ?? null,
      getMasterGainValue,
      getMasterPanValue,
      setMasterVolume: (value: number) => applyAudioMasterLevels(Math.max(0, Math.min(1, value)), pan),
      setMasterPan: (value: number) => applyAudioMasterLevels(volume, Math.max(-1, Math.min(1, value))),
    };
    return () => { delete window.__TEST_HOOKS__; };
  }, [seekToStep, stopMusic, isModuleLoaded, sequencerMatrix, loadFile, setPlaybackRowFraction, playbackStateRef, activeEngine, liteMode, getMasterGainValue, getMasterPanValue, applyAudioMasterLevels, volume, pan]);
}
