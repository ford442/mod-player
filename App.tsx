import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Controls } from './components/Controls';
import { PatternDisplay } from './components/PatternDisplay';
import { MediaOverlay } from './components/MediaOverlay';
import { Studio3D } from './components/Studio3D';
import { useLibOpenMPT } from './hooks/useLibOpenMPT';
import type { MediaItem } from './types';

const SHADERS = [
    'patternv0.40.wgsl',
    'patternv0.39.wgsl',
    'patternv0.38.wgsl',
    'patternv0.37.wgsl',
    'patternv0.36.wgsl',
    'patternv0.35_bloom.wgsl',
    'patternv0.30.wgsl',
    'patternv0.23.wgsl',
    'patternv0.21.wgsl',
    'patternv0.12.wgsl'
];

function App() {
  const [shaderFile, setShaderFile] = useState<string>('patternv0.40.wgsl');
  const [volume, setVolume] = useState<number>(0.5);
  const [pan, setPan] = useState<number>(0.0);

  // 3D View State
  const [is3DMode, setIs3DMode] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true); // Default to Dark Mode
  const [viewMode, setViewMode] = useState<'device' | 'wall'>('device'); // New: device or wall view

  // Calculate Dim Factor (1.0 = Bright, 0.3 = Dark)
  const dimFactor = isDarkMode ? 0.3 : 1.0;

  // Determine shader based on view mode when in 3D
  const get3DShader = () => {
    if (viewMode === 'wall') {
      return 'patternv0.21.wgsl'; // Square shader for wall mode
    } else {
      return 'patternv0.38.wgsl'; // Circular shader for device mode
    }
  };

  // Media Overlay State
  const [mediaItem, setMediaItem] = useState<MediaItem | null>(null);
  const [mediaVisible, setMediaVisible] = useState(false);

  // Hook into the Audio Engine
  const {
    status,
    isReady,
    isPlaying,
    isModuleLoaded,
    loadModule,
    play,
    stopMusic,
    sequencerMatrix,
    playbackSeconds,
    playbackRowFraction,
    channelStates,
    beatPhase,
    grooveAmount,
    kickTrigger,
    activeChannels,
    isLooping,
    setIsLooping,
    seekToStep,
    totalPatternRows,
    setPanValue: setHookPan
  } = useLibOpenMPT(volume);

  // Sync local pan state with hook
  useEffect(() => {
    setHookPan(pan);
  }, [pan, setHookPan]);

  const handleFileSelected = (file: File) => {
    loadModule(file);
  };

  const handleMediaAdd = (file: File) => {
    const url = URL.createObjectURL(file);
    const kind = file.type.startsWith('video') ? 'video' : 'image';
    setMediaItem({
      id: crypto.randomUUID(),
      url,
      kind,
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
        dimFactor={dimFactor} // Pass to 3D Scene
        headerContent={
          <div className="scale-75 origin-top-left">
            <Header status={status} />
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
              tickOffset={0}
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
              dimFactor={dimFactor} // Pass to 2D Component inside 3D
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
        playheadX={playbackSeconds * 10.0} // Pass estimated world position for Camera
      />
    );
  }

  // Standard 2D mode render
  return (
    <div className={`min-h-screen ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-black'} p-4 flex flex-col items-center transition-colors duration-300`}>
      <div className="w-full max-w-[1280px]">
        <Header status={status} />

        {/* Shader Selector & 3D Toggle */}
        <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex gap-2">
                <button
                onClick={() => setIs3DMode(true)}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-mono rounded-lg shadow-lg hover:bg-blue-700 transition-colors border border-blue-500"
                >
                🎬 Enter 3D Studio
                </button>
                <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className={`px-4 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border ${isDarkMode ? 'bg-gray-800 text-white border-gray-700 hover:bg-gray-700' : 'bg-white text-black border-gray-300 hover:bg-gray-50'}`}
                >
                {isDarkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
                </button>
            </div>

            {/* Quick Layout Switcher */}
            <div className={`flex items-center p-1 rounded-lg border ${isDarkMode ? 'bg-black border-gray-700' : 'bg-gray-200 border-gray-300'}`}>
                <button
                    onClick={() => setShaderFile('patternv0.40.wgsl')}
                    className={`px-3 py-1 text-xs font-mono rounded-md transition-all ${shaderFile === 'patternv0.40.wgsl' ? (isDarkMode ? 'bg-gray-700 text-white shadow-sm' : 'bg-white text-black shadow-sm') : 'opacity-50 hover:opacity-100'}`}
                >
                    HORIZ
                </button>
                <button
                    onClick={() => setShaderFile('patternv0.38.wgsl')}
                    className={`px-3 py-1 text-xs font-mono rounded-md transition-all ${shaderFile === 'patternv0.38.wgsl' ? (isDarkMode ? 'bg-gray-700 text-white shadow-sm' : 'bg-white text-black shadow-sm') : 'opacity-50 hover:opacity-100'}`}
                >
                    CIRC
                </button>
                <button
                    onClick={() => setShaderFile('patternv0.23.wgsl')}
                    className={`px-3 py-1 text-xs font-mono rounded-md transition-all ${shaderFile === 'patternv0.23.wgsl' ? (isDarkMode ? 'bg-gray-700 text-white shadow-sm' : 'bg-white text-black shadow-sm') : 'opacity-50 hover:opacity-100'}`}
                >
                    VIDEO
                </button>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-mono opacity-70">VISUALIZER CORE:</label>
              <select
                  value={shaderFile}
                  onChange={(e) => setShaderFile(e.target.value)}
                  className={`text-xs font-mono p-1 rounded border focus:border-blue-500 outline-none ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-black border-gray-300'}`}
              >
                  {SHADERS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
        </div>

        {/* Main Display Area */}
        <div className={`relative rounded-xl overflow-hidden shadow-2xl mb-6 border ${isDarkMode ? 'bg-black border-gray-800' : 'bg-white border-gray-300'}`}>
           {/* WebGPU Pattern Display */}
           <PatternDisplay
             matrix={sequencerMatrix}
             playheadRow={playbackRowFraction} // Interpolated playhead
             isPlaying={isPlaying}
             bpm={120} // Could extract BPM from moduleInfo if available
             timeSec={playbackSeconds}
             tickOffset={0}
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
             // Callbacks for UI interactions (e.g. from Chassis UI)
             onPlay={play}
             onStop={() => stopMusic(false)}
             onFileSelected={handleFileSelected}
             onLoopToggle={() => setIsLooping(!isLooping)}
             onSeek={(row) => seekToStep(row)}
             onVolumeChange={setVolume}
             onPanChange={setPan}
             // Pass media item URL to pattern display if it supports video textures?
             // (PatternDisplay handles externalVideoSource prop)
             externalVideoSource={null}
             dimFactor={dimFactor} // Pass to 2D Component
           />

           {/* Overlay for Images/Videos on top of the visualizer */}
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
             // Example remote media, or fetch dynamically
             { id: '1', kind: 'video', url: 'clouds.mp4', fileName: 'Clouds Demo (MP4)' }
          ]}
        />

        {/* Footer / Instructions */}
        <div className="mt-8 text-center text-xs opacity-50">
             <p>Supports .mod, .xm, .s3m, .it files.</p>
             <p>WebGPU required for visualization.</p>
        </div>
      </div>
    </div>
  );
}

export default App;
