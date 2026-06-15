import React, { useEffect, useRef } from 'react';
import { SeekBar } from './SeekBar';
import { PlayIcon, StopIcon, UploadIcon, LoopIcon } from './icons';

/**
 * Compact, audio-only transport UI for Project-M embed mode (?projectm=1).
 *
 * This view is rendered instead of the full MainLayout / App3DView when
 * appConfig.IS_PROJECTM_EMBED is true. Because the heavy PatternDisplay
 * (WebGPU/WebGL pattern + spectrum renderer) is never mounted in this path,
 * the GPU budget is left free for the Project-M visualizer running in the
 * host page. Audio still flows to Project-M via utils/projectMBridge.ts,
 * which forwards PCM to window.opener / window.parent independently.
 *
 * The UI is intentionally minimal: file load, play/pause/stop, loop toggle,
 * and a seek bar. No shader, panel, library, or 3D controls.
 */
interface ProjectMEmbedViewProps {
  status: string;
  isReady: boolean;
  isModuleLoaded: boolean;
  isPlaying: boolean;
  isLooping: boolean;
  playbackSeconds: number;
  playbackRow: number;
  totalRows: number;
  moduleTitle: string | null;
  play: () => void;
  stopMusic: (resetPosition?: boolean) => void;
  seekToStep: (row: number) => void;
  setIsLooping: (looping: boolean) => void;
  handleFileSelected: (file: File) => void | Promise<void>;
}

export const ProjectMEmbedView: React.FC<ProjectMEmbedViewProps> = ({
  status,
  isReady,
  isModuleLoaded,
  isPlaying,
  isLooping,
  playbackSeconds,
  playbackRow,
  totalRows,
  moduleTitle,
  play,
  stopMusic,
  seekToStep,
  setIsLooping,
  handleFileSelected,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hint that this tab is acting as an audio feeder for Project-M.
  useEffect(() => {
    const previous = document.title;
    document.title = '🎵 mod-player → Project-M';
    return () => { document.title = previous; };
  }, []);

  const togglePlay = () => {
    if (!isModuleLoaded) return;
    if (isPlaying) {
      stopMusic(false);
    } else {
      play();
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelected(file);
    // Reset so selecting the same file again re-triggers onChange.
    e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-panel-base text-[var(--text-primary)] p-4 flex flex-col items-center justify-center gap-4 transition-colors duration-300">
      <div className="w-full max-w-md flex flex-col gap-4 rounded-xl border border-edge-subtle bg-panel-raised/40 p-5 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono uppercase tracking-wider text-cyan-400">
            Project-M audio feed
          </span>
          <span className={`text-[10px] font-mono ${isReady ? 'text-green-400' : 'text-gray-500'}`}>
            {isReady ? 'engine ready' : 'loading…'}
          </span>
        </div>

        {/* Track title / status */}
        <div className="min-h-[2.5rem] flex items-center">
          <span className="text-sm font-medium truncate" title={moduleTitle ?? status}>
            {moduleTitle ?? (isModuleLoaded ? status : 'No module loaded')}
          </span>
        </div>

        {/* Seek bar */}
        <SeekBar
          currentSeconds={playbackSeconds}
          durationSeconds={0}
          currentRow={playbackRow}
          totalRows={totalRows}
          isPlaying={isPlaying}
          onSeekRow={seekToStep}
        />

        {/* Transport controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            disabled={!isModuleLoaded}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="flex items-center justify-center w-11 h-11 rounded-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            {isPlaying ? <StopIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />}
          </button>

          <button
            type="button"
            onClick={() => stopMusic(true)}
            disabled={!isModuleLoaded}
            aria-label="Stop"
            className="flex items-center justify-center w-9 h-9 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 transition-colors"
          >
            <StopIcon className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsLooping(!isLooping)}
            aria-pressed={isLooping}
            aria-label="Toggle loop"
            className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors ${
              isLooping ? 'bg-cyan-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
          >
            <LoopIcon className="w-4 h-4" />
          </button>

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 h-9 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm transition-colors"
          >
            <UploadIcon className="w-4 h-4" />
            Load module
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mod,.xm,.it,.s3m,.mptm,.mtm,.umx,.mo3,.stm,.669,.med,.far,.okt,.ptm,.dbm,.amf,.psm"
            className="hidden"
            onChange={onFileChange}
          />
        </div>

        <p className="text-[10px] text-gray-500 leading-relaxed">
          Pattern display disabled — this window only forwards audio to the
          Project-M visualizer. Close it to stop the feed.
        </p>
      </div>
    </div>
  );
};
