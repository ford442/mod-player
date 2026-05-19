import React from 'react';
import { UploadIcon } from './icons';
import type { MediaItem } from '../types';
import { BLOOM_PRESETS, COLOR_SCHEMES, NIGHT_PRESET_OPTIONS, type BloomPreset, type ColorScheme, type NightPreset } from '../types/bloomPresets';
import { cn } from '../utils/cn';

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
  // Bloom and color scheme selection
  bloomPreset?: BloomPreset;
  onBloomPresetChange?: (preset: BloomPreset) => void;
  colorScheme?: ColorScheme;
  onColorSchemeChange?: (scheme: ColorScheme) => void;
  chassisDark?: boolean;
  onToggleChassisDark?: () => void;
  // Night Mode 2.0
  nightModeEnabled?: boolean;
  nightModePreset?: NightPreset;
  onNightModeToggle?: () => void;
  onNightPresetChange?: (preset: NightPreset) => void;
  isNightShader?: boolean;
}

export const Controls: React.FC<ControlsProps> = ({
  isReady,
  isPlaying: _isPlaying,
  isModuleLoaded,
  onFileSelected,
  onPlay,
  onStop,
  onLoopToggle,
  isLooping,
  volume,
  setVolume,
  pan,
  setPan,
  onMediaAdd,
  onRemoteMediaSelect,
  remoteMediaList = [],
  // Bloom and color scheme
  bloomPreset,
  onBloomPresetChange,
  colorScheme,
  onColorSchemeChange,
  chassisDark,
  onToggleChassisDark,
  // Night Mode 2.0
  nightModeEnabled = false,
  nightModePreset = 'midnight',
  onNightModeToggle,
  onNightPresetChange,
  isNightShader = false,
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

      {/* Playback Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPlay();
          }}
          disabled={!isReady || !isModuleLoaded}
          className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg shadow-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          ▶️ Play
        </button>
        <button
          onClick={onStop}
          disabled={!isReady}
          className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg shadow-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          ⏹️ Stop
        </button>
        <button
          onClick={onLoopToggle}
          className={`px-4 py-2 text-sm font-semibold rounded-lg shadow-lg transition-colors ${isLooping ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-600 text-white hover:bg-gray-700'}`}
        >
          🔄 Loop
        </button>
        {onToggleChassisDark !== undefined && (
          <button
            onClick={onToggleChassisDark}
            className={cn(
              'px-4 py-2 text-sm font-semibold rounded-lg shadow-lg transition-colors border',
              chassisDark
                ? 'bg-gray-900 text-gray-100 hover:bg-gray-800 border-gray-600'
                : 'bg-gray-200 text-gray-800 hover:bg-gray-300 border-gray-400',
            )}
          >
            {chassisDark ? '🌑 Dark Chassis' : '☀️ Light Chassis'}
          </button>
        )}
      </div>

      {/* Night Mode 2.0 Toggle + Preset — shown only on v0.35_bloom */}
      {isNightShader && onNightModeToggle && (
        <div className="flex items-center gap-2 border-l border-gray-600 pl-4">
          <button
            onClick={onNightModeToggle}
            title={nightModeEnabled ? 'Switch to Day Mode' : 'Switch to Night Mode'}
            className={cn(
              'px-3 py-2 text-sm font-semibold rounded-lg shadow-lg transition-all duration-300 border',
              nightModeEnabled
                ? 'bg-indigo-950 text-indigo-300 border-indigo-700 hover:bg-indigo-900'
                : 'bg-gray-700 text-gray-200 border-gray-500 hover:bg-gray-600',
            )}
          >
            {nightModeEnabled ? '🌙 Night' : '☀️ Day'}
          </button>
          {nightModeEnabled && onNightPresetChange && (
            <select
              value={nightModePreset}
              onChange={(e) => onNightPresetChange(e.target.value as NightPreset)}
              title="Night Mode Preset"
              className="bg-indigo-950 text-indigo-200 text-sm px-2 py-2 rounded border border-indigo-700 focus:border-indigo-400 outline-none transition-colors"
            >
              {NIGHT_PRESET_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Bloom Preset Dropdown */}
      {onBloomPresetChange && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400 flex items-center gap-2">
            <span className="hidden md:inline">💡 Bloom:</span>
            <select
              className="bg-gray-700 text-white text-sm px-2 py-1 rounded border border-gray-600 focus:border-blue-500 outline-none"
              value={bloomPreset?.name ?? 'Standard'}
              onChange={(e) => {
                const preset = BLOOM_PRESETS.find(p => p.name === e.target.value);
                if (preset) onBloomPresetChange(preset);
              }}
            >
              {BLOOM_PRESETS.map(preset => (
                <option key={preset.name} value={preset.name} title={preset.description}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* Color Scheme Dropdown */}
      {onColorSchemeChange && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400 flex items-center gap-2">
            <span className="hidden md:inline">🎨 Colors:</span>
            <select
              className="bg-gray-700 text-white text-sm px-2 py-1 rounded border border-gray-600 focus:border-blue-500 outline-none"
              value={colorScheme?.name ?? 'Golden Ratio'}
              onChange={(e) => {
                const scheme = COLOR_SCHEMES.find(s => s.name === e.target.value);
                if (scheme) onColorSchemeChange(scheme);
              }}
            >
              {COLOR_SCHEMES.map(scheme => (
                <option key={scheme.name} value={scheme.name} title={scheme.description}>
                  {scheme.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* Volume and Pan Controls */}
      {setVolume && volume !== undefined && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Vol:</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-20"
          />
        </div>
      )}
      {setPan && pan !== undefined && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Pan:</label>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={pan}
            onChange={(e) => setPan(parseFloat(e.target.value))}
            className="w-20"
          />
        </div>
      )}
    </section>
  );
};

export default Controls;
