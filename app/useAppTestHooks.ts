import { useEffect } from 'react';
import {
  calculateNoteDurations,
  packPatternMatrixHighPrecision,
  PACKEDB_TRIGGER_FLAG,
  isTriggerFromPackedB,
} from '../utils/gpuPacking';
import { usesCircularRowPaging } from '../utils/shaderVersion';
import { circularPageStart, overlayActualRow } from '../utils/playheadPrediction';
import { useFxStore } from '../store/fxStore';
import { usePlayerUiStore } from '../store/playerUiStore';
import { usePlayerEngineInstance } from '../hooks/usePlayerEngine';

/**
 * Headless Chrome / Playwright automation hooks (dev server + CI captures). They read the PlayerEngine
 * when called (#492), so they are installed once instead of on every transport or pattern change.
 */
export function useAppTestHooks(): void {
  const engine = usePlayerEngineInstance();

  useEffect(() => {
    window.__TEST_HOOKS__ = {
      fx: {
        setEnabled: (module, enabled) => useFxStore.getState().setModuleEnabled(module, enabled),
        setParam: (module, key, value) => useFxStore.getState().setParam(module, key, value),
        getState: () => {
          const s = useFxStore.getState();
          return { rackStatus: s.rackStatus, moduleStatus: s.moduleStatus, effective: s.effective };
        },
      },
      seekToRow: (row: number) => engine.seekToStep(row),
      stopPlayback: () => engine.stop(false),
      startPlayback: () => { void engine.play(); },
      pausePlayback: () => engine.pause(),
      getIsPlaying: () => engine.getSnapshot().isPlaying,
      getTransportState: () => engine.getSnapshot().transportState,
      getAudioContextState: () => engine.getAudioContext()?.state ?? 'none',
      // #411 acceptance: a JS play and an ?engine=native play in the same tab
      // must report the same state and rate — there is one context per session.
      getAudioContextSampleRate: () => engine.getAudioContext()?.sampleRate ?? 0,
      isModuleLoaded: () => engine.getSnapshot().isModuleLoaded,
      getPatternRenderer: () => window.currentPatternRenderer,
      loadModuleFromUrl: async (url: string) => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
        const buf = new Uint8Array(await resp.arrayBuffer());
        const name = url.split('/').pop() || 'module.mod';
        await engine.loadFile(buf, name);
      },
      getTriggerTailStats: () => {
        const sequencerMatrix = engine.getSnapshot().sequencerMatrix;
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
        const sequencerMatrix = engine.getSnapshot().sequencerMatrix;
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
        const sequencerMatrix = engine.getSnapshot().sequencerMatrix;
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
      setPlayheadFraction: (value: number) => engine.setPlayheadForTest(value),
      getPlaybackRow: () => Math.floor(engine.playbackStateRef.current.playheadRow),
      getPlaybackRowFraction: () => engine.playbackStateRef.current.playheadRow,
      getActiveRenderer: () => window.currentPatternRenderer?.backend ?? null,
      getAudioEngine: () => engine.getSnapshot().activeEngine,
      getLiteMode: () => usePlayerUiStore.getState().liteMode,
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
        const matrix = engine.getSnapshot().sequencerMatrix;
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
        const playhead = engine.playbackStateRef.current.playheadRow;
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
      getMasterGainValue: () => engine.getMasterGainValue(),
      getMasterPanValue: () => engine.getMasterPanValue(),
      setMasterVolume: (value: number) => engine.setMasterVolume(value),
      setMasterPan: (value: number) => engine.setMasterPan(value),
      getPositionPathStats: () => engine.getPositionPathStats(),
      // #492 allocation check: run a position path N times in a tight loop (measured by the caller,
      // e.g. CDP heap sampling in scripts/audio-smoke.mjs). The bench module is a lazy chunk.
      runPositionPathBenchmark: async (path: 'ring' | 'message', iterations: number) => {
        const { createMessageBench, createRingBench } = await import('../utils/positionRingBenchmark');
        const bench = path === 'ring' ? createRingBench() : createMessageBench();
        bench.run(Math.min(iterations, 2000)); // warm up (JIT) outside whatever the caller measures
        return { applied: bench.applied(), run: (n: number) => { bench.run(n); return bench.applied(); } };
      },
    };
    return () => { delete window.__TEST_HOOKS__; };
  }, [engine]);
}
