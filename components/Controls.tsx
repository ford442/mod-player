import React from 'react';
import { UploadIcon } from './icons';
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
  isDarkMode?: boolean;
  setIsDarkMode?: (value: boolean) => void;
}

export const Controls: React.FC<ControlsProps> = ({
  isReady,
  onFileSelected,
  onMediaAdd,
  onRemoteMediaSelect,
  remoteMediaList = [],
  isDarkMode,
  setIsDarkMode,
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
    <section className="bg-gray-800 p-4 rounded-lg shadow-lg flex flex-wrap gap-4 items-center">
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

      {/* Remote Media Dropdown */}
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
      </div>

      {/* Dark Mode Toggle */}
      {setIsDarkMode && (
        <button
          onClick={() => setIsDarkMode(!isDarkMode)}
          className={`px-3 py-1 text-sm rounded border transition-colors ${
             isDarkMode
               ? 'bg-gray-700 text-white border-gray-600 hover:bg-gray-600'
               : 'bg-gray-200 text-gray-800 border-gray-300 hover:bg-gray-300'
          }`}
        >
          {isDarkMode ? '🌙 Dark' : '☀️ Light'}
        </button>
      )}
    </section>
  );
};

export default Controls;
