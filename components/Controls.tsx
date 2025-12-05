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
    <section className="bg-gray-800 p-4 rounded-lg shadow-lg mb-6 flex flex-wrap gap-4 items-center">
      <div className="flex items-center gap-2">
        <UploadIcon className="w-5 h-5 text-gray-400" />
        <input
          type="file"
          id="file-input"
          className="text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
          disabled={!isReady}
          onChange={handleFileChange}
          accept=".mod,.s3m,.it,.xm,.mo3"
        />
      </div>

      <div className="flex items-center gap-2">
        <UploadIcon className="w-5 h-5 text-gray-400" />
        <input
          type="file"
          id="media-input"
          className="text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
          onChange={handleMediaFile}
          accept=".png,.jpg,.jpeg,.gif,.mp4"
        />
      </div>

      {/* NEW: Remote Media Dropdown */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-400 flex items-center gap-2">
          <span className="hidden md:inline">Server Media:</span>
          <select 
            className="bg-gray-700 text-white text-sm px-2 py-1 rounded border border-gray-600 focus:border-blue-500 outline-none"
            onChange={(e) => {
              const selectedId = e.target.value;
              const item = remoteMediaList.find(m => m.id === selectedId);
              if (item && onRemoteMediaSelect) {
                onRemoteMediaSelect(item);
                // Reset select if desired, or keep selected
                e.target.value = ""; 
              }
            }}
            defaultValue=""
          >
            <option value="" disabled>Select File...</option>
            {remoteMediaList.map(item => (
              <option key={item.id} value={item.id}>
                {item.fileName}
              </option>
            ))}
          </select>
        </label>
        {/* Optional: Refresh button */}
      </div>

      <div className="flex gap-4">
        <button
          id="play-button"
          className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2"
          onClick={onPlay}
          disabled={!isModuleLoaded || isPlaying}
          aria-label="Play"
        >
          <PlayIcon className="w-5 h-5" />
          Play
        </button>

        <button
          id="stop-button"
          className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2"
          onClick={() => onStop()}
          disabled={!isPlaying}
          aria-label="Stop"
        >
          <StopIcon className="w-5 h-5" />
          Stop
        </button>

        <button
          id="loop-button"
          className={`font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2 ${isLooping ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-600 hover:bg-gray-700 text-gray-300'}`}
          onClick={onLoopToggle}
          disabled={!isModuleLoaded}
          aria-label="Toggle Loop"
        >
          <LoopIcon className="w-5 h-5" />
          Loop
        </button>
      </div>

      <div className="flex items-center gap-4 text-gray-300">
        <label className="flex items-center gap-2 text-sm">
          Vol
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume ?? 1}
            onChange={e => setVolume && setVolume(Number(e.target.value))}
            className="w-20 h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Pan
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={pan ?? 0}
            onChange={e => setPan && setPan(Number(e.target.value))}
            className="w-20 h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
          />
        </label>
      </div>
    </section>
  );
};
