import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
// import Controls from './components/Controls'; 
import Chassis0_40 from './components/Chassis0_40'; // Import the new file
import { Renderer } from './renderer/Renderer';
import { RenderMode, ShaderEntry, ShaderCategory, InputSource, SlotParams } from './renderer/types';
import { Alucinate, AIStatus, ImageRecord } from './AutoDJ';
import { pipeline, env } from '@xenova/transformers';
import './style.css';

// ... (Configuration constants - same as before)
env.allowLocalModels = false;
env.backends.onnx.logLevel = 'warning';
const DEPTH_MODEL_ID = 'Xenova/dpt-hybrid-midas';
const API_BASE_URL = 'https://ford442-storage-manager.hf.space';
const IMAGE_MANIFEST_URL = `${API_BASE_URL}/api/songs?type=image`;
const LOCAL_MANIFEST_URL = `/image_manifest.json`;
const BUCKET_BASE_URL = `https://storage.googleapis.com/ford442-storage-manager`;
const IMAGE_SUGGESTIONS_URL = `/image_suggestions.md`;

const FALLBACK_IMAGES = [
    "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=2568&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=2670&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=2694&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?q=80&w=2670&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1614850523060-8da1d56ae167?q=80&w=2670&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1605218427306-633ba8546381?q=80&w=2669&auto=format&fit=crop"
];

const defaultSlotParams: SlotParams = {
    zoomParam1: 0.99,
    zoomParam2: 1.01,
    zoomParam3: 0.5,
    zoomParam4: 0.5,
    lightStrength: 1.0,
    ambient: 0.2,
    normalStrength: 0.1,
    fogFalloff: 4.0,
    depthThreshold: 0.5,
};

function MainApp() {
    // --- State: General & Stacking ---
    const [shaderCategory, setShaderCategory] = useState<ShaderCategory>('image');
    const [modes, setModes] = useState<RenderMode[]>(['liquid', 'none', 'none']);
    const [activeSlot, setActiveSlot] = useState<number>(0);
    const [slotParams, setSlotParams] = useState<SlotParams[]>([defaultSlotParams, defaultSlotParams, defaultSlotParams]);

    // --- State: Global View ---
    const [zoom, setZoom] = useState(1.0);
    const [panX, setPanX] = useState(0.5);
    const [panY, setPanY] = useState(0.5);
    
    // --- State: Automation & Status ---
    const [autoChangeEnabled, setAutoChangeEnabled] = useState(false);
    const [autoChangeDelay, setAutoChangeDelay] = useState(10);
    const [status, setStatus] = useState('Ready.');
    
    // --- State: AI Models & VJ ---
    const [depthEstimator, setDepthEstimator] = useState<any>(null);
    const [aiVj, setAiVj] = useState<Alucinate | null>(null);
    const [aiVjStatus, setAiVjStatus] = useState<AIStatus>('idle');
    const [aiVjMessage, setAiVjMessage] = useState('AI VJ is offline.');
    const [isAiVjMode, setIsAiVjMode] = useState(false);

    // --- State: Content ---
    const [imageManifest, setImageManifest] = useState<ImageRecord[]>([]);
    const [currentImageUrl, setCurrentImageUrl] = useState<string | undefined>();
    const [availableModes, setAvailableModes] = useState<ShaderEntry[]>([]);
    const [inputSource, setInputSource] = useState<InputSource>('image');
    const [activeGenerativeShader, setActiveGenerativeShader] = useState<string>('gen-orb');
    const [videoSourceUrl, setVideoSourceUrl] = useState<string | undefined>(undefined);
    const [selectedVideo, setSelectedVideo] = useState<string>("");

    // --- State: Media Controls (Chassis 0.40) ---
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(1.0);
    const [loop, setLoop] = useState(true);
    const [isPlaying, setIsPlaying] = useState(true);

    // --- State: Layout ---
    const [showSidebar, setShowSidebar] = useState(true);

    // --- State: Mouse Interaction ---
    const [mousePosition, setMousePosition] = useState<{ x: number; y: number }>({ x: -1, y: -1 });
    const [isMouseDown, setIsMouseDown] = useState(false);

    const rendererRef = useRef<Renderer | null>(null);
    const fileInputImageRef = useRef<HTMLInputElement>(null);
    const fileInputVideoRef = useRef<HTMLInputElement>(null);

    // --- Helpers ---
    const setMode = (index: number, mode: RenderMode) => {
        setModes(prev => {
            const next = [...prev];
            next[index] = mode;
            return next;
        });
    };

    const updateSlotParam = useCallback((slotIndex: number, updates: Partial<SlotParams>) => {
        setSlotParams(prev => {
            const next = [...prev];
            next[slotIndex] = { ...next[slotIndex], ...updates };
            return next;
        });
    }, []);

    // --- Effects & Initializers ---
    useEffect(() => {
        const fetchImageManifest = async () => {
            let manifest: ImageRecord[] = [];
            try {
                const response = await fetch(IMAGE_MANIFEST_URL);
                if (response.ok) {
                    const data = await response.json();
                    manifest = data.map((item: any) => ({
                        url: item.url,
                        tags: item.description ? item.description.toLowerCase().split(/[\s,]+/) : [],
                        description: item.description || ''
                    }));
                }
            } catch (error) {
                console.warn("Backend API failed, trying local...", error);
            }

            if (manifest.length === 0) {
                try {
                    const response = await fetch(LOCAL_MANIFEST_URL);
                    if (response.ok) {
                        const data = await response.json();
                         manifest = (data.images || []).map((item: any) => ({
                            url: item.url.startsWith('http') ? item.url : `${BUCKET_BASE_URL}/${item.url}`,
                            tags: item.tags || [],
                            description: item.tags ? item.tags.join(', ') : ''
                        }));
                    }
                } catch (e) {}
            }

            if (manifest.length === 0) {
                manifest = FALLBACK_IMAGES.map(url => ({ url, tags: ['fallback'], description: 'Demo' }));
            }

            const uniqueManifest = Array.from(new Map(manifest.map(item => [item.url, item])).values());
            setImageManifest(uniqueManifest);

            if (rendererRef.current) {
                rendererRef.current.setImageList(uniqueManifest.map(m => m.url));
            }
        };
        fetchImageManifest();
    }, []);

    const handleLoadImage = useCallback(async (url: string) => {
        if (!rendererRef.current) return;
        const newImageUrl = await rendererRef.current.loadImage(url);
        if (newImageUrl) {
            setCurrentImageUrl(newImageUrl);
        }
    }, []);

    const handleNewRandomImage = useCallback(async () => {
        if (imageManifest.length === 0) return;
        const randomImage = imageManifest[Math.floor(Math.random() * imageManifest.length)];
        if (randomImage) await handleLoadImage(randomImage.url);
    }, [imageManifest, handleLoadImage]);

    const loadDepthModel = useCallback(async () => {
        if (depthEstimator) return;
        try {
            setStatus('Loading depth model...');
            const estimator = await pipeline('depth-estimation', DEPTH_MODEL_ID, {
                progress_callback: (p: any) => setStatus(`Loading depth: ${p.status}...`),
            });
            setDepthEstimator(() => estimator);
            setStatus('Depth model loaded.');
        } catch (e: any) { setStatus(`Depth error: ${e.message}`); }
    }, [depthEstimator]);
    
    const toggleAiVj = useCallback(async () => {
        if (!aiVj) {
             const vj = new Alucinate(handleLoadImage, (ids) => {
                 setModes(prev => { const n=[...prev]; if(ids[0]) n[0]=ids[0]; if(ids[1]) n[1]=ids[1]; return n; });
             }, () => ({ currentImage: null, currentShader: null }));
             vj.onStatusChange = (s, m) => { setAiVjStatus(s); setAiVjMessage(m); };
             setAiVj(vj); setIsAiVjMode(true);
             await vj.initialize(imageManifest, availableModes, IMAGE_SUGGESTIONS_URL);
             vj.start();
        } else {
            if (isAiVjMode) { aiVj.stop(); setIsAiVjMode(false); }
            else { aiVj.start(); setIsAiVjMode(true); }
        }
    }, [aiVj, isAiVjMode, availableModes, imageManifest, handleLoadImage]);
    
    const onInitCanvas = useCallback(() => {
        if(rendererRef.current) {
            setAvailableModes(rendererRef.current.getAvailableModes());
            handleNewRandomImage();
        }
    }, [handleNewRandomImage]);

    return (
        <div className="App">
            <header className="header">
                <div className="logo-section">
                    <div className="logo-text">Pixelocity</div>
                    <div className="subtitle-text">Chassis 0.40</div>
                </div>
                <div className="header-controls">
                    <button className="toggle-sidebar-btn" onClick={() => setShowSidebar(!showSidebar)}>
                        {showSidebar ? 'Hide Controls' : 'Show Controls'}
                    </button>
                </div>
            </header>
            <div className="main-container">
                <aside 
                    className={`sidebar ${!showSidebar ? 'hidden' : ''}`} 
                    // Inline styles are nice, but Chassis0_40's <style> block does the heavy lifting now
                    style={{ background: 'transparent' }}
                > 
                    <Chassis0_40
                        modes={modes} setMode={setMode} activeSlot={activeSlot} setActiveSlot={setActiveSlot}
                        slotParams={slotParams} updateSlotParam={updateSlotParam} shaderCategory={shaderCategory}
                        setShaderCategory={setShaderCategory} zoom={zoom} setZoom={setZoom} panX={panX}
                        setPanX={setPanX} panY={panY} setPanY={setPanY} onNewImage={handleNewRandomImage}
                        autoChangeEnabled={autoChangeEnabled} setAutoChangeEnabled={setAutoChangeEnabled}
                        autoChangeDelay={autoChangeDelay} setAutoChangeDelay={setAutoChangeDelay}
                        onLoadModel={loadDepthModel} isModelLoaded={!!depthEstimator} availableModes={availableModes}
                        inputSource={inputSource} setInputSource={setInputSource} videoList={[]}
                        selectedVideo={selectedVideo} setSelectedVideo={setSelectedVideo} 
                        isMuted={isMuted} setIsMuted={setIsMuted}
                        volume={volume} setVolume={setVolume}
                        loop={loop} setLoop={setLoop}
                        isPlaying={isPlaying} setIsPlaying={setIsPlaying}
                        activeGenerativeShader={activeGenerativeShader} setActiveGenerativeShader={setActiveGenerativeShader}
                        onUploadImageTrigger={() => fileInputImageRef.current?.click()}
                        onUploadVideoTrigger={() => fileInputVideoRef.current?.click()}
                        isAiVjMode={isAiVjMode} onToggleAiVj={toggleAiVj} aiVjStatus={aiVjStatus}
                    />
                </aside>
                <main className="canvas-container">
                    <WebGPUCanvas
                        modes={modes} slotParams={slotParams} zoom={zoom} panX={panX} panY={panY}
                        rendererRef={rendererRef} farthestPoint={{x:0.5, y:0.5}}
                        mousePosition={mousePosition} setMousePosition={setMousePosition}
                        isMouseDown={isMouseDown} setIsMouseDown={setIsMouseDown} onInit={onInitCanvas}
                        inputSource={inputSource} videoSourceUrl={videoSourceUrl}
                        activeGenerativeShader={activeGenerativeShader}
                        selectedVideo={selectedVideo}
                        apiBaseUrl={API_BASE_URL}
                        loop={loop}
                        volume={volume}
                        isPlaying={isPlaying}
                        isMuted={isMuted}
                        setInputSource={setInputSource}
                    />
                    <div className="status-bar">
                        {isAiVjMode ? `[AI VJ]: ${aiVjMessage}` : status}
                    </div>
                </main>
            </div>
            <input type="file" ref={fileInputImageRef} accept="image/*" style={{display:'none'}} onChange={(e) => {
                if(e.target.files?.[0] && rendererRef.current) {
                    const url = URL.createObjectURL(e.target.files[0]);
                    handleLoadImage(url);
                }
            }} />
            <input type="file" ref={fileInputVideoRef} accept="video/*" style={{display:'none'}} onChange={(e) => {
                if(e.target.files?.[0]) {
                    const url = URL.createObjectURL(e.target.files[0]);
                    setVideoSourceUrl(url);
                    setInputSource('video');
                }
            }} />
        </div>
    );
}

export default MainApp;
