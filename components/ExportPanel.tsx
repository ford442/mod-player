import { useMemo } from 'react';
import { cn } from '../utils/cn';
import type { OfflineExportState } from '../hooks/useOfflineExport';
import type { PerformanceCaptureState } from '../hooks/usePerformanceCapture';
import type { PatternRendererBackend } from '../src/renderers/types';
import { probeCanvasCaptureSupport } from '../utils/performanceCapture';

interface ExportPanelProps {
  isModuleLoaded: boolean;
  isDarkMode: boolean;
  moduleFileName: string;
  moduleDurationSeconds: number;
  numChannels: number;
  channelMuteMask: boolean[];
  onToggleChannelMute: (channel: number) => void;
  onExportWav: () => void;
  onStartCapture: () => void;
  onStopCapture: () => void;
  offlineExport: OfflineExportState;
  isExporting: boolean;
  captureState: PerformanceCaptureState;
  isRecording: boolean;
  rendererBackend: PatternRendererBackend | null | undefined;
  dualAudioContext: boolean;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ExportPanel({
  isModuleLoaded,
  isDarkMode,
  moduleFileName,
  moduleDurationSeconds,
  numChannels,
  channelMuteMask,
  onToggleChannelMute,
  onExportWav,
  onStartCapture,
  onStopCapture,
  offlineExport,
  isExporting,
  captureState,
  isRecording,
  rendererBackend,
  dualAudioContext,
}: ExportPanelProps) {
  const captureSupport = useMemo(
    () => probeCanvasCaptureSupport(rendererBackend),
    [rendererBackend],
  );

  const mutedCount = channelMuteMask.filter(Boolean).length;

  return (
    <section
      className={cn(
        'rounded-xl border p-4 space-y-4 text-sm',
        isDarkMode ? 'bg-gray-900 border-white/10' : 'bg-white border-gray-200',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className={cn('font-semibold', isDarkMode ? 'text-cyan-300' : 'text-cyan-700')}>
          Export
        </h3>
        {isModuleLoaded && moduleDurationSeconds > 0 && (
          <span className={cn('text-xs font-mono', isDarkMode ? 'text-gray-400' : 'text-gray-500')}>
            {formatTime(moduleDurationSeconds)}
          </span>
        )}
      </div>

      <div className="space-y-2">
        <p className={cn('text-xs', isDarkMode ? 'text-gray-400' : 'text-gray-600')}>
          Offline WAV render runs in a worker (faster than realtime). Channel mutes apply to export when any channel is muted.
        </p>
        <button
          type="button"
          disabled={!isModuleLoaded || isExporting || isRecording}
          onClick={onExportWav}
          className={cn(
            'w-full px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-50',
            isDarkMode
              ? 'bg-cyan-700 hover:bg-cyan-600 text-white'
              : 'bg-cyan-600 hover:bg-cyan-500 text-white',
          )}
        >
          {isExporting ? `Exporting… ${offlineExport.progress}%` : 'Download WAV'}
        </button>
        {offlineExport.message && (
          <p
            className={cn(
              'text-xs font-mono',
              offlineExport.stage === 'error'
                ? 'text-red-400'
                : isDarkMode
                  ? 'text-gray-400'
                  : 'text-gray-600',
            )}
          >
            {offlineExport.message}
          </p>
        )}
      </div>

      {numChannels > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className={cn('text-xs font-medium', isDarkMode ? 'text-gray-300' : 'text-gray-700')}>
              Channel mute mask
            </span>
            <span className="text-[10px] font-mono text-gray-500">
              {mutedCount > 0 ? `${mutedCount} muted` : 'all on'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: numChannels }, (_, i) => {
              const muted = channelMuteMask[i] === true;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onToggleChannelMute(i)}
                  className={cn(
                    'w-8 h-8 rounded text-xs font-mono border transition-colors',
                    muted
                      ? 'bg-red-900/60 border-red-500 text-red-200'
                      : isDarkMode
                        ? 'bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700'
                        : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200',
                  )}
                  title={muted ? `Unmute channel ${i + 1}` : `Mute channel ${i + 1}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="border-t border-white/10 pt-4 space-y-2">
        <p className={cn('text-xs', isDarkMode ? 'text-gray-400' : 'text-gray-600')}>
          Performance capture records the visualizer canvas + live audio mix via MediaRecorder.
        </p>
        {!captureSupport.captureStream && (
          <p className="text-xs text-amber-400 font-mono">
            {captureSupport.notes[0] ?? 'Canvas capture unavailable'}
          </p>
        )}
        {dualAudioContext && (
          <p className="text-xs text-amber-400 font-mono">
            Native engine uses a separate AudioContext — switch to JS worklet to record audio.
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!isModuleLoaded || isExporting || isRecording || !captureSupport.captureStream || dualAudioContext}
            onClick={onStartCapture}
            className={cn(
              'flex-1 px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-50',
              isDarkMode
                ? 'bg-emerald-800 hover:bg-emerald-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white',
            )}
          >
            Record clip
          </button>
          <button
            type="button"
            disabled={!isRecording}
            onClick={onStopCapture}
            className={cn(
              'px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-50',
              isDarkMode
                ? 'bg-gray-700 hover:bg-gray-600 text-white'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-800',
            )}
          >
            Stop
          </button>
        </div>
        {isRecording && (
          <p className="text-xs font-mono text-red-400">
            ● REC {formatTime(captureState.elapsedSeconds)}
          </p>
        )}
        {captureState.message && !isRecording && captureState.stage !== 'idle' && (
          <p className="text-xs font-mono text-gray-400">{captureState.message}</p>
        )}
        <p className="text-[10px] text-gray-500 font-mono truncate" title={moduleFileName}>
          {moduleFileName || 'No module'}
        </p>
      </div>
    </section>
  );
}
