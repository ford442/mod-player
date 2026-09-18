import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

export interface PerformanceStageProps {
  /**
   * DOM node inside the R3F 3D studio's pattern-display panel, when 3D mode
   * is open (null in 2D / stage mode). PatternDisplay is always portaled into
   * a single stable container (`canvasHostRef.current`, created once); this
   * prop only changes which *real* DOM parent that stable container is
   * physically appended into. The portal target itself never changes, so
   * PatternDisplay's fiber — and its WebGPU device — is never torn down when
   * 3D mode toggles. See Problem A in the WebGPU teardown/init unification
   * effort.
   */
  studioDisplayHost?: HTMLDivElement | null;
}

/**
 * The visualizer stage — `PatternDisplay` + `MediaOverlay`.
 * Always mounted at a fixed sibling index in `ChromeLayout`. Stage mode is CSS
 * (`data-stage-mode` on MainLayout); overlays stay in the tree after the canvas.
 */
export function PerformanceStage({ studioDisplayHost = null }: PerformanceStageProps = {}) {
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

  // Stable portal container for PatternDisplay — created once and never
  // swapped, so createPortal never remounts it. `homeSlotRef` is this
  // component's normal (2D / stage-mode) on-page position for it; when
  // `studioDisplayHost` is set (3D mode), the *container itself* is
  // physically re-parented into that node instead, leaving PatternDisplay's
  // React fiber (and its WebGPU device) untouched either way.
  const [canvasHost] = useState<HTMLDivElement>(() => {
    const el = document.createElement('div');
    el.className = 'performance-stage-canvas-host';
    el.style.width = '100%';
    el.style.height = '100%';
    return el;
  });
  const homeSlotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const target = studioDisplayHost ?? homeSlotRef.current;
    if (target && canvasHost.parentElement !== target) {
      target.appendChild(canvasHost);
    }
  }, [studioDisplayHost, canvasHost]);

  return (
    <div
      className={cn(
        'performance-stage relative rounded-xl overflow-hidden shadow-2xl mb-6 border',
        isDarkMode ? 'bg-black border-gray-800' : 'bg-white border-gray-300',
      )}
    >
      <div ref={homeSlotRef} className="performance-stage-canvas-slot" style={{ width: '100%', height: '100%' }} />
      {createPortal(
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
          />,
        canvasHost,
      )}

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

      <div className="stage-overlay">
        <button
          type="button"
          onClick={() => toggleStageMode()}
          className="absolute top-4 right-4 z-50 px-3 py-1.5 text-xs font-mono rounded-lg border bg-black/60 text-white border-gray-600 hover:bg-black/80 transition-colors"
          title="Exit stage mode (Escape)"
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
      </div>
    </div>
  );
}
