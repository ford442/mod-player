import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useLibOpenMPT } from './hooks/useLibOpenMPT';
import { Header } from './components/Header';
import Controls from './components/Controls';
import { InfoDisplay } from './components/InfoDisplay';
import { PatternSequencer } from './components/PatternSequencer';
import { GithubIcon } from './components/icons';
import { MediaPanel } from './components/MediaPanel';
import { MediaOverlay } from './components/MediaOverlay';
import { PatternDisplay } from './components/PatternDisplay';
import type { MediaItem } from './types';
import { fetchRemoteMedia } from './utils/remoteMedia';

// Dynamically load all WGSL shader files
const shaderModules = import.meta.glob('./shaders/*.wgsl', { as: 'url' });
const availableShaders = Object.keys(shaderModules)
  .map(path => path.replace('./shaders/', ''))
  // Hide non-pattern helper shaders (bezel/chassis/etc)
  .filter(name => name.startsWith('patternv'))
  .sort();

export default function App() {
  const [volume, setVolume] = useState(1.0);

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
    panValue,
    setPanValue,
  } = useLibOpenMPT(volume);

  const [media, setMedia] = useState<MediaItem[]>([]);
  const [remoteFiles, setRemoteFiles] = useState<MediaItem[]>([]);
  const [activeMediaId, setActiveMediaId] = useState<string | undefined>(undefined);
  const [overlayVisible, setOverlayVisible] = useState<boolean>(false);
  const [mediaElement, setMediaElement] = useState<HTMLVideoElement | HTMLImageElement | null>(null);
  const videoLoopRef = useRef<number>(0);

  useEffect(() => {
    fetchRemoteMedia().then(items => setRemoteFiles(items));
  }, []);

  const handleRemoteSelect = useCallback((item: MediaItem) => {
    const newItem = { ...item, id: `remote-${Date.now()}` }; 
    setMedia(prev => [newItem, ...prev]);
    setActiveMediaId(newItem.id);
    setOverlayVisible(true);
  }, []);

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
    setMedia((prev: MediaItem[]) => [item, ...prev]);
    setActiveMediaId(item.id);
    setOverlayVisible(true);
  }, []);

  const removeMedia = useCallback((id: string) => {
    setMedia((prev: MediaItem[]) => {
      const found = prev.find((m: MediaItem) => m.id === id);
      if (found && found.isObjectUrl) {
        try { URL.revokeObjectURL(found.url); } catch (e) { /* ignore */ }
      }
      return prev.filter((m: MediaItem) => m.id !== id);
    });
    if (activeMediaId === id) {
      setActiveMediaId(undefined);
      setOverlayVisible(false);
    }
  }, [activeMediaId]);

  const activeMedia = media.find((m: MediaItem) => m.id === activeMediaId);

  useEffect(() => {
    cancelAnimationFrame(videoLoopRef.current);
    const currentMedia = media.find(m => m.id === activeMediaId);

    if (!currentMedia) {
      setMediaElement(null);
      return;
    }

    let el: HTMLVideoElement | HTMLImageElement | null = null;

    if (currentMedia.kind === 'video') {
      const vid = document.createElement('video');
      vid.src = currentMedia.url;
      vid.crossOrigin = "anonymous";
      vid.loop = currentMedia.loop ?? false;
      vid.muted = currentMedia.muted ?? true;
      vid.playsInline = true;

      vid.onloadedmetadata = () => {
        vid.play().catch(e => console.warn("Video play error for shader", e));
      };

      if (!vid.loop) {
        let direction = 1;
        const checkLoop = () => {
          if (!vid) return;
          const t = vid.currentTime;
          const d = vid.duration;
          if (d > 0) {
            if (direction === 1 && t >= d - 0.2) {
              direction = -1;
              try { vid.playbackRate = -1.0; } catch (e) { vid.currentTime = 0; }
            } else if (direction === -1 && t <= 0.2) {
              direction = 1;
              try { vid.playbackRate = 1.0; } catch (e) { /* ignore */ }
            }
            if (vid.paused) vid.play().catch(() => {});
          }
          videoLoopRef.current = requestAnimationFrame(checkLoop);
        };
        vid.play().then(checkLoop).catch(() => {});
      }

      el = vid;
    } else if (currentMedia.kind === 'image' || currentMedia.kind === 'gif') {
      const img = new Image();
      img.src = currentMedia.url;
      img.crossOrigin = "anonymous";
      el = img;
    }

    setMediaElement(el);

    return () => {
      cancelAnimationFrame(videoLoopRef.current);
      if (el && el instanceof HTMLVideoElement) {
        el.pause();
        el.src = '';
      }
      setMediaElement(null);
    };
  }, [activeMediaId, media]);

  const webgpuSupported = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const [patternMode, setPatternMode] = useState<'html' | 'webgpu'>(webgpuSupported ? 'webgpu' : 'html');
  const [shaderVersion, setShaderVersion] = useState<string>('patternv0.36.wgsl');
  const effectivePatternMode = webgpuSupported ? patternMode : 'html';

  const isVideoShaderActive = effectivePatternMode === 'webgpu' && (shaderVersion.includes('v0.20') || shaderVersion.includes('v0.23'));
  const showOverlay = overlayVisible && !isVideoShaderActive;

  // Dynamic cell sizing based on shader version
  const getCellMetrics = (shader: string) => {
    if (shader.includes('v0.21')) return { w: 32, h: 48 }; // Extra Large Precision
    return { w: 18, h: 26 }; // Standard Default
  };
  const { w: cellW, h: cellH } = getCellMetrics(shaderVersion);

  return (
    <div className="min-h-screen p-4 flex items-center justify-center bg-gray-950 font-sans">
      <main className="max-w-6xl w-full bg-slate-900 rounded-xl border-4 border-slate-700 shadow-2xl p-4 md:p-6 relative">
        {/* Device aesthetic details */}
        <div className="absolute top-2 left-2 w-2 h-2 rounded-full bg-slate-600 shadow-inner"></div>
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-slate-600 shadow-inner"></div>
        <div className="absolute bottom-2 left-2 w-2 h-2 rounded-full bg-slate-600 shadow-inner"></div>
        <div className="absolute bottom-2 right-2 w-2 h-2 rounded-full bg-slate-600 shadow-inner"></div>

        <Header status={status} />

        {isModuleLoaded || effectivePatternMode === 'webgpu' ? (
          <div className="flex flex-col gap-0">
             {/* Display Area Wrapper */}
             <div className="bg-black rounded-lg border-2 border-slate-600 shadow-[inset_0_0_20px_rgba(0,0,0,1)] p-4 relative overflow-hidden">
                <InfoDisplay moduleInfo={moduleInfo} />

                <div className="flex items-center justify-between flex-wrap gap-2 mb-2 px-1">
                  <h2 className="text-xs uppercase tracking-widest text-gray-500 font-mono">Pattern View</h2>
                  <div className="flex items-center gap-2">
                    <div className="inline-flex rounded border border-gray-700 overflow-hidden bg-gray-900">
                      <button
                        type="button"
                        onClick={() => setPatternMode('html')}
                        className={`px-3 py-1 text-xs font-mono transition ${effectivePatternMode === 'html' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`}
                      >
                        HTML
                      </button>
                      <button
                        type="button"
                        onClick={() => setPatternMode('webgpu')}
                        className={`px-3 py-1 text-xs font-mono transition ${effectivePatternMode === 'webgpu' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`}
                        disabled={!webgpuSupported}
                      >
                        WGSL
                      </button>
                    </div>
                    {effectivePatternMode === 'webgpu' && (
                      <select
                        value={shaderVersion}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setShaderVersion(e.target.value)}
                        className="bg-gray-900 text-gray-400 text-xs px-2 py-1 rounded border border-gray-700 font-mono"
                      >
                        {availableShaders.map((shader: string) => (
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
                    cellWidth={cellW}
                    cellHeight={cellH}
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
                    isModuleLoaded={isModuleLoaded}
                    externalVideoSource={mediaElement}
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

            {/* Controls moved below Display */}
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
              volume={volume}
              setVolume={setVolume}
              pan={panValue}
              setPan={setPanValue}
              remoteMediaList={remoteFiles}
              onRemoteMediaSelect={handleRemoteSelect}
            />

            <div className="mt-4 border-t border-slate-800 pt-4">
               <MediaPanel media={media} activeMediaId={activeMediaId} onSelect={(id?: string) => { setActiveMediaId(id); setOverlayVisible(!!id); }} onRemove={removeMedia} />
            </div>

            <MediaOverlay item={activeMedia} visible={showOverlay} onClose={() => setOverlayVisible(false)} onUpdate={(partial: Partial<MediaItem>) => { if (!activeMedia) return; setMedia((prev: MediaItem[]) => prev.map((m: MediaItem) => m.id === activeMedia.id ? { ...m, ...partial } : m)); }} />
          </div>
        ) : (
           <div className="py-20 flex flex-col items-center justify-center text-gray-500 bg-black rounded-lg border-2 border-slate-600 shadow-[inset_0_0_20px_rgba(0,0,0,1)]">
             <div className="w-16 h-16 mb-4 rounded-full border-2 border-gray-700 flex items-center justify-center animate-pulse">
                <div className="w-12 h-12 bg-gray-800 rounded-full"></div>
             </div>
             <h2 className="text-2xl font-mono text-gray-300 mb-2 tracking-widest">XASM-1</h2>
             <p className="font-mono text-sm">WAITING FOR CARTRIDGE...</p>
             <p className="text-xs mt-4 opacity-50">Load a module to begin</p>

             {/* Show controls even when empty so user can load file */}
             <div className="mt-8 w-full max-w-lg px-8">
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
                  volume={volume}
                  setVolume={setVolume}
                  pan={panValue}
                  setPan={setPanValue}
                  remoteMediaList={remoteFiles}
                  onRemoteMediaSelect={handleRemoteSelect}
                />
             </div>
           </div>
        )}

        <footer className="text-center text-slate-600 mt-4 text-[10px] font-mono uppercase tracking-wider flex justify-between items-center px-4">
          <p>System Ready</p>
          <a href="https://github.com/ford442/react-dom" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:text-slate-400 transition-colors">
            <GithubIcon className="w-3 h-3" />
            Source
          </a>
        </footer>
      </main>
    </div>
  );
}
