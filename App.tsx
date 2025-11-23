import React, { useCallback, useState } from 'react';
import { useLibOpenMPT } from './hooks/useLibOpenMPT';
import { Header } from './components/Header';
import { Controls } from './components/Controls';
import { InfoDisplay } from './components/InfoDisplay';
import { PatternSequencer } from './components/PatternSequencer';
import { GithubIcon } from './components/icons';
import { MediaPanel } from './components/MediaPanel';
import { MediaOverlay } from './components/MediaOverlay';
import { PatternDisplay } from './components/PatternDisplay';
import type { MediaItem } from './types';

// Dynamically load all WGSL shader files
const shaderModules = import.meta.glob('./shaders/*.wgsl', { as: 'url' });
const availableShaders = Object.keys(shaderModules).map(path => path.replace('./shaders/', ''));

export default function App() {
  const {
    status,
    isReady,
    isPlaying,
    isModuleLoaded,
    moduleInfo,
    loadModule,
    play,
    stopMusic,
    sequencerMatrix,
    sequencerCurrentRow,
    sequencerGlobalRow,
    totalPatternRows,
    seekToStep,
    playbackSeconds,
    playbackRowFraction,
    channelStates,
    beatPhase,
    grooveAmount,
    kickTrigger,
    activeChannels,
    isLooping,
    setIsLooping,
  } = useLibOpenMPT(volume);

  const [media, setMedia] = useState<MediaItem[]>([]);
  const [activeMediaId, setActiveMediaId] = useState<string | undefined>(undefined);
  const [overlayVisible, setOverlayVisible] = useState<boolean>(false);
  const [volume, setVolume] = useState(1.0);
  const addMediaFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const kind: MediaItem['kind'] = file.type === 'video/mp4' || file.type.startsWith('video/') ? 'video' : (file.type === 'image/gif' ? 'gif' : 'image');
    const item: MediaItem = {
      id: String(Date.now()),
      url,
      fileName: file.name,
      mimeType: file.type,
      kind,
      loop: kind === 'gif',
      muted: true,
      fit: 'contain',
      createdAt: Date.now(),
      isObjectUrl: true,
    };
    setMedia(prev => [item, ...prev]);
    setActiveMediaId(item.id);
    setOverlayVisible(true);
  }, []);

  const removeMedia = useCallback((id: string) => {
    setMedia(prev => {
      const found = prev.find(m => m.id === id);
      if (found && found.isObjectUrl) {
        try { URL.revokeObjectURL(found.url); } catch (e) { /* ignore */ }
      }
      return prev.filter(m => m.id !== id);
    });
    if (activeMediaId === id) {
      setActiveMediaId(undefined);
      setOverlayVisible(false);
    }
  }, [activeMediaId]);

  const activeMedia = media.find(m => m.id === activeMediaId);
  const webgpuSupported = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const [patternMode, setPatternMode] = useState<'html' | 'webgpu'>(webgpuSupported ? 'webgpu' : 'html');
  const [shaderVersion, setShaderVersion] = useState<string>('patternv0.12.wgsl');
  const effectivePatternMode = webgpuSupported ? patternMode : 'html';

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col">
      <main className="max-w-7xl mx-auto w-full flex-grow">
        <Header status={status} />

        <Controls
          isReady={isReady}
          isPlaying={isPlaying}
          isModuleLoaded={isModuleLoaded}
          onFileSelected={loadModule}
          onPlay={play}
          onStop={stopMusic}
          onMediaAdd={addMediaFile}
          isLooping={isLooping}
          onLoopToggle={() => setIsLooping(!isLooping)}
        />
          volume={volume}
          setVolume={setVolume}
          <>
            <InfoDisplay moduleInfo={moduleInfo} />

            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-sm uppercase tracking-widest text-gray-400">Pattern View</h2>
                <div className="flex items-center gap-3">
                  <div className="inline-flex rounded-lg border border-white/10 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setPatternMode('html')}
                      className={`px-4 py-2 text-sm font-semibold transition ${effectivePatternMode === 'html' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                      HTML
                    </button>
                    <button
                      type="button"
                      onClick={() => setPatternMode('webgpu')}
                      className={`px-4 py-2 text-sm font-semibold transition ${effectivePatternMode === 'webgpu' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                      disabled={!webgpuSupported}
                    >
                      WGSL
                    </button>
                  </div>
                  {effectivePatternMode === 'webgpu' && (
                    <select
                      value={shaderVersion}
                      onChange={(e) => setShaderVersion(e.target.value)}
                      className="bg-gray-800 text-white text-sm px-3 py-2 rounded border border-white/10"
                    >
                      {availableShaders.map(shader => (
                        <option key={shader} value={shader}>{shader.replace('.wgsl', '')}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {effectivePatternMode === 'webgpu' ? (
                <PatternDisplay
                  matrix={sequencerMatrix ?? null}
                  playheadRow={sequencerCurrentRow}
                  cellWidth={10}
                  cellHeight={22}
                  shaderFile={shaderVersion}
                  isPlaying={isPlaying}
                  bpm={moduleInfo.bpm}
                  timeSec={playbackSeconds}
                  tickOffset={Math.max(0, (playbackRowFraction % 1))}
                  channels={channelStates}
                  beatPhase={beatPhase}
                  grooveAmount={grooveAmount}
                  kickTrigger={kickTrigger}
                  activeChannels={activeChannels}
                />
              ) : (
                <PatternSequencer
                  matrix={sequencerMatrix ?? null}
                  currentRow={sequencerCurrentRow}
                  globalRow={sequencerGlobalRow}
                  totalRows={totalPatternRows}
                  onSeek={seekToStep}
                  bpm={moduleInfo.bpm}
                />
              )}
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <MediaPanel media={media} activeMediaId={activeMediaId} onSelect={(id) => { setActiveMediaId(id); setOverlayVisible(!!id); }} onRemove={removeMedia} />
            </div>

            <MediaOverlay item={activeMedia} visible={overlayVisible} onClose={() => setOverlayVisible(false)} onUpdate={(partial) => { if (!activeMedia) return; setMedia(prev => prev.map(m => m.id === activeMedia.id ? { ...m, ...partial } : m)); }} />
          </>
        )}

        {!isModuleLoaded && (
           <div className="mt-6 bg-gray-800 p-6 rounded-lg shadow-lg text-center text-gray-400">
             <h2 className="text-xl font-semibold text-white mb-2">Welcome!</h2>
             <p>Load a tracker module file (e.g., .mod, .it, .s3m, .xm) to begin.</p>
           </div>
        )}
      </main>
      <footer className="text-center text-gray-500 mt-8 text-sm">
        <p>Powered by React and libopenmpt.</p>
        <a href="https://github.com/ford442/react-dom" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:text-white transition-colors">
          <GithubIcon className="w-4 h-4" />
          View on GitHub
        </a>
      </footer>
    </div>
  );
}
