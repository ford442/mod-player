import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Controls } from './components/Controls';
import { PatternDisplay } from './components/PatternDisplay';
import { MediaOverlay } from './components/MediaOverlay';
import { Studio3D } from './components/Studio3D';
import { useLibOpenMPT } from './hooks/useLibOpenMPT';
import type { MediaItem } from './types';

// Shader Definitions
const SHADER_GROUPS = {
  SQUARE: [
    { id: 'patternv0.44.wgsl', label: 'v0.44 (Frosted Wall 64)' },
    { id: 'patternv0.43.wgsl', label: 'v0.43 (Frosted Wall 32)' },
    { id: 'patternv0.40.wgsl', label: 'v0.40 (Frosted Grid)' },
    { id: 'patternv0.39.wgsl', label: 'v0.39 (Modern)' },
    { id: 'patternv0.21.wgsl', label: 'v0.21 (Wall)' },
  ],
  CIRCULAR: [
    { id: 'patternv0.49.wgsl', label: 'v0.49 (Trap Frosted Glass)' },
    { id: 'patternv0.48.wgsl', label: 'v0.48 (Trap Frosted Disc)' },
    { id: 'patternv0.47.wgsl', label: 'v0.47 (Trap Frosted)' },
    { id: 'patternv0.46.wgsl', label: 'v0.46 (Frosted Glass)' },
    { id: 'patternv0.45.wgsl', label: 'v0.45 (Frosted Bloom)' },
    { id: 'patternv0.42.wgsl', label: 'v0.42 (Frosted Disc)' },
    { id: 'patternv0.38.wgsl', label: 'v0.38 (Glass)' },
    { id: 'patternv0.35_bloom.wgsl', label: 'v0.35 (Bloom)' },
    { id: 'patternv0.30.wgsl', label: 'v0.30 (Disc)' },
  ],
  VIDEO: [
    { id: 'patternv0.23.wgsl', label: 'v0.23 (Clouds)' },
    { id: 'patternv0.24.wgsl', label: 'v0.24 (Tunnel)' },
  ]
};

function App() {
  const [shaderFile, setShaderFile] = useState<string>('patternv0.40.wgsl');
  const [volume, setVolume] = useState<number>(0.5);
  const [pan, setPan] = useState<number>(0.0);

  // 3D View State
  const [is3DMode, setIs3DMode] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'device' | 'wall'>('device');

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
    play,
    stopMusic,
    loadFile,
    setIsLooping,
    seekToStep,
    setPanValue: setLibPan,
    activeEngine,
    isWorkletSupported,
    toggleAudioEngine,
    status,
    syncDebug,
    analyserNode,
  } = useLibOpenMPT(volume);

  // Media Overlay State
  const [mediaVisible, setMediaVisible] = useState<boolean>(false);
  const [mediaItem, setMediaItem] = useState<MediaItem | null>(null);

  // Sync pan with library
  useEffect(() => { setLibPan(pan); }, [pan, setLibPan]);

  // Handle File Selection

  const handleFileSelected = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    loadFile(data, file.name);
  };

  const handleMediaAdd = (file: File) => {
    const kind = file.type.startsWith("video") ? "video" : "image";
    const url = URL.createObjectURL(file);
    setMediaItem({
      id: crypto.randomUUID(),
      kind,
      url,
      fileName: file.name,
      mimeType: file.type,
      loop: kind === 'video'
    });
    setMediaVisible(true);
  };

  const handleRemoteMediaSelect = (item: MediaItem) => {
    setMediaItem(item);
    setMediaVisible(true);
  };

  // Calculate Dim Factor
  const dimFactor = isDarkMode ? 0.3 : 1.0;

  // Determine shader based on view mode when in 3D
  const get3DShader = () => {
    if (viewMode === 'wall') return 'patternv0.21.wgsl';
    return 'patternv0.38.wgsl';
  };

  // Render in 3D mode
  if (is3DMode) {
    const shader3D = get3DShader();
    return (
      <Studio3D
        darkMode={isDarkMode}
        viewMode={viewMode}
        onDarkModeToggle={() => setIsDarkMode(!isDarkMode)}
        onViewModeToggle={() => setViewMode(viewMode === 'device' ? 'wall' : 'device')}
        onExitStudio={() => setIs3DMode(false)}
        dimFactor={dimFactor}
        headerContent={
          <div className="scale-75 origin-top-left">
         <Header status={status} />
         <div className={`mb-2 inline-flex flex-col rounded border px-2 py-1 text-[10px] font-mono ${isDarkMode ? 'border-gray-700 bg-black/50 text-gray-300' : 'border-gray-300 bg-white/80 text-gray-700'}`}>
           <span>sync mode: {syncDebug.mode}</span>
           <span>buffer: {syncDebug.bufferMs.toFixed(1)}ms</span>
           <span>drift: {syncDebug.driftMs.toFixed(1)}ms</span>
           <span>row: {syncDebug.row.toFixed(2)}</span>
           <span>starvations: {syncDebug.starvationCount}</span>
         </div>
          </div>
        }
        patternDisplayContent={
          <div className="scale-75 origin-center">
            <PatternDisplay
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
              shaderFile={shader3D}
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
            />
          </div>
        }
        controlsContent={
          <div className="scale-75 origin-top-left">
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
              onMediaAdd={handleMediaAdd}
              onRemoteMediaSelect={handleRemoteMediaSelect}
              remoteMediaList={[
                { id: '1', kind: 'video', url: 'clouds.mp4', fileName: 'Clouds Demo (MP4)' }
              ]}
            />
          </div>
        }
        mediaOverlayContent={
          mediaVisible && mediaItem ? (
            <div className="scale-75 origin-center">
              <MediaOverlay
                item={mediaItem}
                visible={mediaVisible}
                onClose={() => setMediaVisible(false)}
                onUpdate={(partial) => {
                  if (mediaItem) setMediaItem({ ...mediaItem, ...partial });
                }}
              />
            </div>
          ) : undefined
        }
        playheadX={playbackSeconds * 10.0}
      />
    );
  }

  // 2D Mode Render
  return (
    <div className={`min-h-screen ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-black'} p-4 flex flex-col items-center transition-colors duration-300`}>
      <div className="w-full max-w-[1280px]">
        <Header status={status} />

        {/* Global Controls */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-2">
                <button
                  onClick={() => setIs3DMode(true)}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-mono rounded-lg shadow-lg hover:bg-blue-700 transition-colors border border-blue-500"
                >
                  🎬 3D Mode
                </button>
                <button
                  onClick={() => setIsDarkMode(!isDarkMode)}
                  className={`px-4 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border ${isDarkMode ? 'bg-gray-800 text-white border-gray-700 hover:bg-gray-700' : 'bg-white text-black border-gray-300 hover:bg-gray-50'}`}
                >
                  {isDarkMode ? '☀️ Light' : '🌙 Dark'}
                </button>
                <button
                  onClick={toggleAudioEngine}
                  disabled={!isWorkletSupported}
                  title={!isWorkletSupported ? "AudioWorklet not supported" : "Toggle Audio Engine (Worklet vs ScriptProcessor)"}
                  className={`px-4 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border ${
                    !isWorkletSupported
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed border-gray-400 opacity-50'
                      : activeEngine === 'worklet'
                        ? 'bg-green-600 text-white border-green-500 hover:bg-green-700'
                        : 'bg-yellow-500 text-black border-yellow-400 hover:bg-yellow-600'
                  }`}
                >
                  {activeEngine === 'worklet' ? '⚡ Worklet' : '🐌 Script'}
                </button>
            </div>

            {/* Categorized Shader Selectors */}
            <div className={`flex flex-wrap gap-2 p-2 rounded-xl border ${isDarkMode ? 'bg-black border-gray-800' : 'bg-gray-200 border-gray-300'}`}>
                {/* Square Group */}
                <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase px-1">Square</span>
                    <select
                        className={`text-xs font-mono p-1 rounded border outline-none ${isDarkMode ? 'bg-gray-800 border-gray-600 text-white' : 'bg-white border-gray-300 text-black'}`}
                        value={SHADER_GROUPS.SQUARE.some(s => s.id === shaderFile) ? shaderFile : ''}
                        onChange={(e) => e.target.value && setShaderFile(e.target.value)}
                    >
                        <option value="" disabled>Select...</option>
                        {SHADER_GROUPS.SQUARE.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                </div>

                <div className={`w-px h-6 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-300'}`}></div>

                {/* Circular Group */}
                <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase px-1">Circular</span>
                    <select
                        className={`text-xs font-mono p-1 rounded border outline-none ${isDarkMode ? 'bg-gray-800 border-gray-600 text-white' : 'bg-white border-gray-300 text-black'}`}
                        value={SHADER_GROUPS.CIRCULAR.some(s => s.id === shaderFile) ? shaderFile : ''}
                        onChange={(e) => e.target.value && setShaderFile(e.target.value)}
                    >
                        <option value="" disabled>Select...</option>
                        {SHADER_GROUPS.CIRCULAR.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                </div>

                <div className={`w-px h-6 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-300'}`}></div>

                {/* Video Group */}
                <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase px-1">Video</span>
                    <select
                        className={`text-xs font-mono p-1 rounded border outline-none ${isDarkMode ? 'bg-gray-800 border-gray-600 text-white' : 'bg-white border-gray-300 text-black'}`}
                        value={SHADER_GROUPS.VIDEO.some(s => s.id === shaderFile) ? shaderFile : ''}
                        onChange={(e) => e.target.value && setShaderFile(e.target.value)}
                    >
                        <option value="" disabled>Select...</option>
                        {SHADER_GROUPS.VIDEO.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                </div>
            </div>
        </div>

        {/* Main Display Area */}
        <div className={`relative rounded-xl overflow-hidden shadow-2xl mb-6 border ${isDarkMode ? 'bg-black border-gray-800' : 'bg-white border-gray-300'}`}>
           <PatternDisplay
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
             shaderFile={shaderFile}
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
           />

           <MediaOverlay
             item={mediaItem}
             visible={mediaVisible}
             onClose={() => setMediaVisible(false)}
             onUpdate={(partial) => {
                 if (mediaItem) setMediaItem({ ...mediaItem, ...partial });
             }}
           />
        </div>

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
          onMediaAdd={handleMediaAdd}
          onRemoteMediaSelect={handleRemoteMediaSelect}
          remoteMediaList={[
             { id: '1', kind: 'video', url: 'clouds.mp4', fileName: 'Clouds Demo (MP4)' }
          ]}
        />

        <div className="mt-8 text-center text-xs opacity-50">
             <p>Supports .mod, .xm, .s3m, .it files.</p>
             <p>WebGPU required for visualization.</p>
        </div>
      </div>
    </div>
  );
}

export default App;
