import React from 'react';
import { PlayIcon, StopIcon, UploadIcon, LoopIcon } from './icons';
import type { MediaItem } from '../types';

interface ControlsProps {
  isReady: boolean;
  isPlaying: boolean;
  isModuleLoaded: boolean;
  onFileSelected: (file: File) => void;
  onPlay: () => void;
  onStop: () => void;
  onMediaAdd?: (file: File) => void;
  isLooping: boolean;
  onLoopToggle: () => void;
  volume?: number;
  setVolume?: (v: number) => void;
  pan?: number;
  setPan?: (p: number) => void;
  onRemoteMediaSelect?: (item: MediaItem) => void;
  remoteMediaList?: MediaItem[];
}

export const Controls: React.FC<ControlsProps> = ({
  isReady,
  isPlaying,
  isModuleLoaded,
  onFileSelected,
  onPlay,
  onStop,
  onMediaAdd,
  isLooping,
  onLoopToggle,
  volume,
  setVolume,
  pan,
  setPan,
  onRemoteMediaSelect,
  remoteMediaList = [],
}) => {
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  const handleMediaFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && onMediaAdd) {
      onMediaAdd(file);
    }
  };

  return (
    <section className="mt-4 p-4 border-t border-gray-700/50 flex flex-wrap gap-4 items-center justify-between">
      <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="flex items-center justify-center p-2 rounded-lg bg-gray-700 hover:bg-gray-600 cursor-pointer transition-colors" title="Load Module">
                <UploadIcon className="w-5 h-5 text-blue-400" />
                <input
                type="file"
                id="file-input"
                className="hidden"
                disabled={!isReady}
                onChange={handleFileChange}
                accept=".mod,.s3m,.it,.xm,.mo3"
                />
            </label>
            <span className="text-xs text-gray-500 font-mono uppercase">Load</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center justify-center p-2 rounded-lg bg-gray-700 hover:bg-gray-600 cursor-pointer transition-colors" title="Load Background Media">
                <UploadIcon className="w-5 h-5 text-green-400" />
                <input
                type="file"
                id="media-input"
                className="hidden"
                onChange={handleMediaFile}
                accept=".png,.jpg,.jpeg,.gif,.mp4"
                />
            </label>
            <span className="text-xs text-gray-500 font-mono uppercase">Bg</span>
          </div>

          {/* Remote Media Dropdown */}
          <div className="flex items-center gap-2 border-l border-gray-700 pl-4">
            <select
                className="bg-gray-800 text-gray-300 text-xs px-2 py-1.5 rounded border border-gray-600 focus:border-blue-500 outline-none font-mono w-32 md:w-48"
                onChange={(e) => {
                const selectedId = e.target.value;
                const item = remoteMediaList.find(m => m.id === selectedId);
                if (item && onRemoteMediaSelect) {
                    onRemoteMediaSelect(item);
                    e.target.value = "";
                }
                }}
                defaultValue=""
            >
                <option value="" disabled>Select Server Media...</option>
                {remoteMediaList.map(item => (
                <option key={item.id} value={item.id}>
                    {item.fileName}
                </option>
                ))}
            </select>
          </div>
      </div>

      <div className="flex gap-2">
        <button
          id="play-button"
          className="bg-green-700/80 hover:bg-green-600 text-white font-bold py-2 px-6 rounded shadow-lg border-b-4 border-green-900 active:border-b-0 active:translate-y-1 transition-all flex items-center gap-2"
          onClick={onPlay}
          disabled={!isModuleLoaded || isPlaying}
          aria-label="Play"
        >
          <PlayIcon className="w-5 h-5" />
        </button>

        <button
          id="stop-button"
          className="bg-red-700/80 hover:bg-red-600 text-white font-bold py-2 px-6 rounded shadow-lg border-b-4 border-red-900 active:border-b-0 active:translate-y-1 transition-all flex items-center gap-2"
          onClick={() => onStop()}
          disabled={!isPlaying}
          aria-label="Stop"
        >
          <StopIcon className="w-5 h-5" />
        </button>

        <button
          id="loop-button"
          className={`font-bold py-2 px-4 rounded shadow-lg border-b-4 active:border-b-0 active:translate-y-1 transition-all flex items-center gap-2 ${isLooping ? 'bg-blue-600 border-blue-800 text-white' : 'bg-gray-600 border-gray-800 text-gray-300'}`}
          onClick={onLoopToggle}
          disabled={!isModuleLoaded}
          aria-label="Toggle Loop"
        >
          <LoopIcon className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-col gap-2 w-full md:w-auto mt-2 md:mt-0">
        <label className="flex items-center justify-end gap-2 text-xs font-mono text-gray-400">
          VOL
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume ?? 1}
            onChange={e => setVolume && setVolume(Number(e.target.value))}
            className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-green-500"
          />
        </label>
        <label className="flex items-center justify-end gap-2 text-xs font-mono text-gray-400">
          PAN
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={pan ?? 0}
            onChange={e => setPan && setPan(Number(e.target.value))}
            className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
        </label>
      </div>
    </section>
  );
};

export default Controls;
