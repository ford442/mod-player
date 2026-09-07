import { Controls } from './Controls';
import { PatternDisplay } from './PatternDisplay';
import { MediaOverlay } from './MediaOverlay';
import { SeekBar } from './SeekBar';
import { cn } from '../utils/cn';
import { IS_PUBLIC_MODE, LIGHT_THEMES } from '../appConfig';
import { usePlayerSession } from '../context/PlayerSessionContext';
import { usePlayerFeatures } from '../context/PlayerFeaturesContext';
import { usePlayerUiStore } from '../store/playerUiStore';
import { useShaderPrefsStore } from '../store/shaderPrefsStore';

/**
 * The visualizer stage — `PatternDisplay` + `MediaOverlay`.
 * Rendered inside `ChromeLayout` in normal mode; rendered full-viewport
 * on its own (with a minimal transport + exit button) when `stageMode` is on.
 */
export function PerformanceStage() {
  const session = usePlayerSession();
  const features = usePlayerFeatures();
  const {
    theme,
    liteMode,
    chassisDark,
    debugPanelOpen,
    setDebugPanelOpen,
    reactiveMode,
    editMode,
    selectedInstrumentIndex,
    stageMode,
    toggleStageMode,
  } = usePlayerUiStore();
  const {
    colorPalette,
    paletteMode,
    stepsLength,
    setStepsLength,
    bloomPreset,
    nightModeEnabled,
    crtEnabled,
    reducedMotion,
    highContrast,
    cvdPalette,
  } = useShaderPrefsStore();

  const isDarkMode = !LIGHT_THEMES.has(theme);
  const showDevSurface = !IS_PUBLIC_MODE;
  const {
    isReady,
    isModuleLoaded,
    isPlaying,
    isLooping,
    playbackSeconds,
    playbackRowFraction,
    totalPatternRows,
    sequencerMatrix,
    channelStates,
    beatPhase,
    grooveAmount,
    kickTrigger,
    activeChannels,
    volume,
    pan,
    syncDebug,
    analyserNode,
    moduleDurationSeconds,
    displayShaderFile,
    instrumentPalette,
    dimFactor,
    isNightShader,
    nightConfig,
    playbackStateRef,
    channelStatesRef,
    oscBufferRef,
    audioReactiveRef,
    play,
    stopMusic,
    seekToStep,
    setIsLooping,
    setVolume,
    setPan,
    handleFileSelected,
  } = session;
  const {
    mediaItem,
    mediaVisible,
    mediaFades,
    setMediaVisible,
    setMediaItem,
    onSequencerCellEdit,
  } = features;

  return (
    <div
      className={cn(
        'relative',
        stageMode
          ? 'w-screen h-screen'
          : 'rounded-xl overflow-hidden shadow-2xl mb-6 border',
        !stageMode && (isDarkMode ? 'bg-black border-gray-800' : 'bg-white border-gray-300'),
        stageMode && 'bg-black',
      )}
    >
      <PatternDisplay
        key={displayShaderFile}
        matrix={sequencerMatrix}
        playheadRow={playbackRowFraction}
        isPlaying={isPlaying}
        bpm={120}
        timeSec={playbackSeconds}
        tickOffset={playbackRowFraction % 1}
        channels={channelStates}
        beatPhase={beatPhase}
        grooveAmount={grooveAmount}
        kickTrigger={kickTrigger}
        activeChannels={activeChannels}
        isModuleLoaded={isModuleLoaded}
        shaderFile={displayShaderFile}
        volume={volume}
        pan={pan}
        isLooping={isLooping}
        totalRows={totalPatternRows}
        onPlay={play}
        onStop={() => stopMusic(false)}
        onFileSelected={handleFileSelected}
        onLoopToggle={() => setIsLooping(!isLooping)}
        onSeek={(row) => seekToStep(row)}
        onVolumeChange={setVolume}
        onPanChange={setPan}
        externalVideoSource={null}
        dimFactor={dimFactor}
        analyserNode={analyserNode}
        debugPanelOpen={showDevSurface ? debugPanelOpen : false}
        {...(showDevSurface ? {
          onCloseDebug: () => setDebugPanelOpen(false),
          onOpenDebug: () => setDebugPanelOpen(true),
        } : {})}
        syncDebug={syncDebug}
        // PERFORMANCE OPTIMIZATION: Pass ref for high-frequency updates
        playbackStateRef={playbackStateRef}
        channelStatesRef={channelStatesRef}
        oscBufferRef={oscBufferRef}
        audioReactiveRef={audioReactiveRef}
        reactiveMode={reactiveMode}
        // Bloom settings from preset
        bloomIntensity={(isNightShader && nightModeEnabled) ? nightConfig.bloomIntensity : bloomPreset.intensity}
        bloomThreshold={bloomPreset.threshold}
        colorPalette={cvdPalette > 0 ? cvdPalette : colorPalette}
        paletteMode={paletteMode}
        highlightInstrument={selectedInstrumentIndex ?? 0}
        instrumentPalette={instrumentPalette}
        stepsLength={stepsLength}
        onStepsLengthToggle={() => setStepsLength(stepsLength === 32 ? 64 : 32)}
        chassisDark={chassisDark}
        // Night Mode 2.0
        nightModeEnabled={isNightShader && nightModeEnabled}
        nightPreset={nightModeEnabled ? nightConfig.presetIndex : 0}
        vignetteStrength={nightConfig.vignetteStrength}
        filmGrain={nightConfig.filmGrain}
        invertMix={nightConfig.invertMix}
        // CRT effect
        crtEnabled={crtEnabled}
        // Accessibility
        reducedMotion={reducedMotion}
        highContrast={highContrast}
        // Lite mode
        liteMode={liteMode}
        editMode={editMode}
        {...(onSequencerCellEdit ? { onSequencerCellEdit } : {})}
      />

      {showDevSurface && (
        <MediaOverlay
          item={mediaItem}
          visible={mediaVisible}
          fadeInMs={mediaFades?.in}
          fadeOutMs={mediaFades?.out}
          onClose={() => setMediaVisible(false)}
          onUpdate={(partial) => {
            if (mediaItem) setMediaItem({ ...mediaItem, ...partial });
          }}
        />
      )}

      {stageMode && (
        <>
          <button
            type="button"
            onClick={() => toggleStageMode()}
            className="absolute top-4 right-4 z-50 px-3 py-1.5 text-xs font-mono rounded-lg border bg-black/60 text-white border-gray-600 hover:bg-black/80 transition-colors"
            title="Exit stage mode (back to full UI)"
          >
            ✕ Exit Stage
          </button>
          <div className="absolute bottom-0 left-0 right-0 z-50 bg-black/60 backdrop-blur-sm px-4 py-2">
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
              minimalSurface
            />
            {isModuleLoaded && (
              <div className="mt-2">
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
          </div>
        </>
      )}
    </div>
  );
}
