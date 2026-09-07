import { Controls } from './Controls';
import { SeekBar } from './SeekBar';
import { cn } from '../utils/cn';
import { IS_PUBLIC_MODE, LIGHT_THEMES } from '../appConfig';
import { usePlayerSession } from '../context/PlayerSessionContext';
import { usePlayerFeatures } from '../context/PlayerFeaturesContext';
import { usePlayerUiStore } from '../store/playerUiStore';
import { useShaderPrefsStore } from '../store/shaderPrefsStore';

/** Full transport: `Controls`, `SeekBar`, and panel-visibility toggle buttons (chrome mode only). */
export function TransportBar() {
  const session = usePlayerSession();
  const features = usePlayerFeatures();
  const {
    theme,
    chassisDark,
    setChassisDark,
    showChannelMeters,
    setShowChannelMeters,
    showMetadata,
    setShowMetadata,
    showInstruments,
    setShowInstruments,
    showPlaylist,
    setShowPlaylist,
    showLibraryBrowser,
    setShowLibraryBrowser,
    showLocalLibrary,
    setShowLocalLibrary,
  } = usePlayerUiStore();
  const {
    bloomPreset,
    setBloomPreset,
    colorScheme,
    setColorScheme,
    nightModeEnabled,
    setNightModeEnabled,
    nightModePreset,
    setNightModePreset,
    crtEnabled,
    setCrtEnabled,
  } = useShaderPrefsStore();

  const isDarkMode = !LIGHT_THEMES.has(theme);
  const showDevSurface = !IS_PUBLIC_MODE;
  const {
    isReady,
    isPlaying,
    isModuleLoaded,
    isLooping,
    playbackSeconds,
    playbackRowFraction,
    totalPatternRows,
    volume,
    pan,
    moduleDurationSeconds,
    isNightShader,
    play,
    stopMusic,
    seekToStep,
    setIsLooping,
    setVolume,
    setPan,
    handleFileSelected,
  } = session;
  const { handleMediaAdd, handleRemoteMediaSelect } = features;

  return (
    <>
      {/* Controls */}
      <Controls
        isReady={isReady}
        isPlaying={isPlaying}
        isModuleLoaded={isModuleLoaded}
        onFileSelected={handleFileSelected}
        onPlay={play}
        onStop={() => stopMusic(false)}
        isLooping={isLooping}
        onLoopToggle={() => setIsLooping(!isLooping)}
        volume={volume}
        setVolume={setVolume}
        pan={pan}
        setPan={setPan}
        minimalSurface={IS_PUBLIC_MODE}
        {...(showDevSurface ? {
          onMediaAdd: handleMediaAdd,
          onRemoteMediaSelect: handleRemoteMediaSelect,
          remoteMediaList: [
            { id: '1', kind: 'video', url: 'clouds.mp4', fileName: 'Clouds Demo (MP4)', mimeType: 'video/mp4' },
          ],
          bloomPreset,
          onBloomPresetChange: setBloomPreset,
          colorScheme,
          onColorSchemeChange: setColorScheme,
          chassisDark,
          onToggleChassisDark: () => setChassisDark(!chassisDark),
          nightModeEnabled,
          nightModePreset,
          onNightModeToggle: () => setNightModeEnabled(!nightModeEnabled),
          onNightPresetChange: setNightModePreset,
          isNightShader,
          crtEnabled,
          onToggleCrt: () => setCrtEnabled(!crtEnabled),
        } : {})}
      />

      {/* Seek Bar */}
      {isModuleLoaded && (
        <div className="mt-4">
          <SeekBar
            currentSeconds={playbackSeconds}
            durationSeconds={moduleDurationSeconds}
            currentRow={playbackRowFraction}
            totalRows={totalPatternRows}
            isPlaying={isPlaying}
            onSeekRow={seekToStep}
          />
        </div>
      )}

      {/* Panel Toggle Buttons */}
      <div className="mt-4 flex flex-wrap gap-2">
        {[
          { key: 'meters', label: '📊 VU Meters', state: showChannelMeters, toggle: setShowChannelMeters },
          { key: 'meta', label: 'ℹ️ Metadata', state: showMetadata, toggle: setShowMetadata },
          ...(showDevSurface ? [
            { key: 'instruments', label: '🎹 Instruments', state: showInstruments, toggle: setShowInstruments },
          ] : []),
          { key: 'playlist', label: '📋 Playlist', state: showPlaylist, toggle: setShowPlaylist },
          ...(showDevSurface ? [
            { key: 'library', label: '☁️ Browse Library', state: showLibraryBrowser, toggle: setShowLibraryBrowser },
            { key: 'collection', label: '📁 Library', state: showLocalLibrary, toggle: setShowLocalLibrary },
          ] : []),
        ].map(({ key, label, state, toggle }) => (
          <button
            key={key}
            onClick={() => toggle(!state)}
            className={cn(
              'px-3 py-1 text-xs font-mono rounded-lg border transition-colors',
              state
                ? 'bg-cyan-900/30 text-cyan-300 border-cyan-800'
                : isDarkMode
                  ? 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300'
                  : 'bg-gray-200 text-gray-500 border-gray-300 hover:text-gray-700',
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
