import React from 'react';
import { RenderMode, ShaderEntry, ShaderCategory, InputSource, SlotParams } from '../renderer/types';
import { AIStatus } from '../AutoDJ';

interface ChassisProps {
    modes: RenderMode[];
    setMode: (index: number, mode: RenderMode) => void;
    activeSlot: number;
    setActiveSlot: (index: number) => void;
    slotParams: SlotParams[];
    updateSlotParam: (slotIndex: number, updates: Partial<SlotParams>) => void;
    shaderCategory: ShaderCategory;
    setShaderCategory: (category: ShaderCategory) => void;
    zoom: number;
    setZoom: (zoom: number) => void;
    panX: number;
    setPanX: (panX: number) => void;
    panY: number;
    setPanY: (panY: number) => void;
    onNewImage: () => void;
    autoChangeEnabled: boolean;
    setAutoChangeEnabled: (enabled: boolean) => void;
    autoChangeDelay: number;
    setAutoChangeDelay: (delay: number) => void;
    onLoadModel: () => void;
    isModelLoaded: boolean;
    availableModes: ShaderEntry[];
    inputSource: InputSource;
    setInputSource: (source: InputSource) => void;
    videoList: string[];
    selectedVideo: string;
    setSelectedVideo: (video: string) => void;
    // Expanded Audio/Video Controls
    isMuted: boolean;
    setIsMuted: (muted: boolean) => void;
    volume: number;
    setVolume: (vol: number) => void;
    loop: boolean;
    setLoop: (loop: boolean) => void;
    isPlaying: boolean;
    setIsPlaying: (playing: boolean) => void;
    
    onUploadImageTrigger: () => void;
    onUploadVideoTrigger: () => void;
    activeGenerativeShader?: string;
    setActiveGenerativeShader?: (id: string) => void;
    isAiVjMode: boolean;
    onToggleAiVj: () => void;
    aiVjStatus: AIStatus;
}

// --- Square White Button Style ---
const buttonStyle: React.CSSProperties = {
    backgroundColor: 'white',
    color: 'black',
    border: '1px solid #ccc',
    borderRadius: '0px', // STRICTLY SQUARE
    padding: '10px 12px',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: '12px',
    textTransform: 'uppercase',
    width: '100%',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    textAlign: 'center'
};

const activeButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: '#f0f0f0', // Slightly grey when active/pressed
    border: '2px solid black'
};

const stopButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    color: '#d32f2f', 
    borderColor: '#d32f2f'
};

const Chassis0_40: React.FC<ChassisProps> = ({
    modes, setMode, activeSlot, setActiveSlot,
    slotParams, updateSlotParam, shaderCategory, setShaderCategory,
    zoom, setZoom, panX, setPanX, panY, setPanY,
    onNewImage, autoChangeEnabled, setAutoChangeEnabled,
    autoChangeDelay, setAutoChangeDelay, onLoadModel, isModelLoaded,
    availableModes = [], inputSource, setInputSource,
    videoList, selectedVideo, setSelectedVideo,
    isMuted, setIsMuted, volume, setVolume, loop, setLoop, isPlaying, setIsPlaying,
    onUploadImageTrigger, onUploadVideoTrigger,
    activeGenerativeShader, setActiveGenerativeShader,
    isAiVjMode, onToggleAiVj, aiVjStatus
}) => {
    
    const shaderEntries = availableModes.filter(entry => entry.category === 'shader');
    const imageEntries = availableModes.filter(entry => entry.category === 'image');
    const getCurrentCategoryModes = () => shaderCategory === 'shader' ? shaderEntries : imageEntries;
    const currentModes = getCurrentCategoryModes();
    const currentMode = modes[activeSlot];
    const currentParams = slotParams[activeSlot];
    const currentShaderEntry = availableModes.find(m => m.id === currentMode);

    return (
        <>
            {/* Aggressive Override Style Block to Disable "Darkened Room" */}
            <style>
                {`
                    /* Force sidebar transparency specifically for Chassis 0.40 */
                    .sidebar { 
                        background: transparent !important;
                        background-color: transparent !important;
                        box-shadow: none !important;
                        backdrop-filter: none !important;
                        -webkit-backdrop-filter: none !important;
                        border-right: none !important;
                    }
                    /* Ensure controls are readable against colorful backgrounds */
                    .chassis-040 label {
                        text-shadow: 0px 1px 2px rgba(0,0,0,0.8);
                    }
                `}
            </style>

            <div className="controls chassis-040" style={{ 
                padding: '20px', 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '15px',
                backgroundColor: 'transparent', // Transparent container
                color: '#ffffff',
                fontFamily: 'monospace'
            }}>
                <h3 style={{
                    marginTop: 0, 
                    color: 'white', 
                    textTransform: 'uppercase', 
                    borderBottom: '2px solid white', 
                    paddingBottom: '10px',
                    textShadow: '0 1px 3px rgba(0,0,0,0.5)'
                }}>
                    Chassis 0.40
                </h3>

                {/* --- Input Source Selection --- */}
                <div className="control-group">
                    <label style={{color: 'white', marginBottom: '5px', display:'block', fontWeight:'bold'}}>INPUT SOURCE</label>
                    <div className="radio-group" style={{display: 'flex', flexWrap: 'wrap', gap: '10px'}}>
                        {['image', 'video', 'webcam', 'generative'].map(src => (
                            <label key={src} style={{display:'flex', alignItems: 'center', cursor: 'pointer', background:'rgba(0,0,0,0.3)', padding:'2px 5px'}}>
                                <input
                                    type="radio"
                                    value={src}
                                    checked={inputSource === src}
                                    onChange={() => setInputSource(src as InputSource)}
                                    style={{accentColor: 'white', marginRight: '5px'}}
                                /> {src.toUpperCase()}
                            </label>
                        ))}
                    </div>
                </div>

                {/* --- Slot Stack --- */}
                <div className="stack-controls">
                    {[0, 1, 2].map(i => (
                        <div
                            key={i}
                            className={`stack-slot ${activeSlot === i ? 'active' : ''}`}
                            onClick={() => setActiveSlot(i)}
                            style={{
                                padding: '8px',
                                border: activeSlot === i ? '2px solid white' : '1px solid rgba(255,255,255,0.3)',
                                marginBottom: '5px',
                                background: activeSlot === i ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0,0,0,0.2)',
                                cursor: 'pointer'
                            }}
                        >
                            <div style={{marginBottom: '4px', fontSize: '10px', fontWeight:'bold', color: 'white'}}>LAYER {i + 1}</div>
                            <select
                                value={modes[i]}
                                onChange={(e) => setMode(i, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    width: '100%', 
                                    background: 'white', 
                                    color: 'black', 
                                    border: 'none', 
                                    padding: '4px',
                                    borderRadius: '0px',
                                    fontWeight: 'bold'
                                }}
                            >
                                <option value="none">NONE</option>
                                {currentModes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                        </div>
                    ))}
                </div>

                {/* --- Media Control Section (Moved Inward) --- */}
                <div className="media-controls-container" style={{ 
                    paddingLeft: '100px', // REQUEST: Move in toward center 100px
                    marginTop: '20px',
                    position: 'relative'
                }}>
                    <div style={{
                        position: 'absolute', 
                        left: 0, top: 0, bottom: 0, 
                        width: '2px', 
                        background: 'white', 
                        opacity: 0.5 
                    }} /> {/* Visual guide line */}

                    <div style={{fontSize: '10px', color: '#ddd', marginBottom: '8px', textTransform: 'uppercase', fontWeight:'bold'}}>Media Controls</div>
                    
                    {/* Open File Buttons */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', marginBottom: '15px' }}>
                        <button style={buttonStyle} onClick={onUploadImageTrigger}>LOAD IMAGE</button>
                        <button style={buttonStyle} onClick={onUploadVideoTrigger}>LOAD VIDEO</button>
                    </div>

                    {/* Loop Button */}
                    <div style={{marginBottom: '15px'}}>
                        <label style={{
                            display: 'flex', alignItems: 'center', cursor:'pointer', 
                            color: 'white', background: 'rgba(0,0,0,0.4)', padding: '5px'
                        }}>
                            <input 
                                type="checkbox" 
                                checked={loop} 
                                onChange={(e) => setLoop(e.target.checked)} 
                                style={{width: '16px', height: '16px', marginRight: '8px', accentColor: 'white'}}
                            /> 
                            LOOP PLAYBACK
                        </label>
                    </div>

                    {/* Volume Slider */}
                    <div className="control-group" style={{background: 'rgba(0,0,0,0.4)', padding: '8px'}}>
                        <label style={{display:'flex', justifyContent:'space-between', color: 'white', fontSize: '11px', marginBottom: '4px'}}>
                            <span>VOLUME</span>
                            <span>{(volume * 100).toFixed(0)}%</span>
                        </label>
                        <input 
                            type="range" 
                            min="0" max="1" step="0.01" 
                            value={volume} 
                            onChange={(e) => {
                                const val = Number(e.target.value);
                                setVolume(val);
                                if(val > 0) setIsMuted(false);
                            }}
                            style={{width: '100%', accentColor: 'white'}} 
                        />
                    </div>
                </div>

                {/* --- Playback Control Section (Moved Down) --- */}
                <div className="playback-controls-container" style={{ 
                    marginTop: '25px', // REQUEST: Move start/stop buttons down 25px
                    paddingTop: '15px',
                    borderTop: '1px solid rgba(255,255,255,0.3)'
                }}>
                    <div style={{fontSize: '10px', color: '#ddd', marginBottom: '8px', textTransform: 'uppercase', fontWeight:'bold'}}>Playback / AI</div>
                    
                    {inputSource === 'video' ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <button 
                                style={isPlaying ? activeButtonStyle : buttonStyle} 
                                onClick={() => setIsPlaying(true)}
                            >
                                PLAY
                            </button>
                            <button 
                                style={!isPlaying ? activeButtonStyle : stopButtonStyle} 
                                onClick={() => setIsPlaying(false)}
                            >
                                STOP
                            </button>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                             <button style={buttonStyle} onClick={onToggleAiVj} disabled={aiVjStatus === 'loading-models' || aiVjStatus === 'generating'}>
                                {isAiVjMode ? 'STOP AI VJ' : 'START AI VJ'}
                            </button>
                        </div>
                    )}
                </div>

                <hr style={{borderColor: 'rgba(255, 255, 255, 0.3)', margin: '20px 0'}}/>

                {/* --- Parameters --- */}
                <div style={{ fontWeight: 'bold', marginBottom: '10px', color: 'white', fontSize: '12px', textTransform: 'uppercase', textShadow: '0 1px 2px black' }}>
                    Slot {activeSlot + 1} Parameters
                </div>
                {currentShaderEntry?.params?.map((param, index) => {
                    if (index > 3) return null;
                    let val = currentParams[`zoomParam${index + 1}` as keyof SlotParams] as number;
                    return (
                        <div key={param.id} className="control-group" style={{background: 'rgba(0,0,0,0.3)', padding: '5px', marginBottom:'5px'}}>
                            <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'white'}}>
                                <span>{param.name.toUpperCase()}</span>
                                <span>{val.toFixed(2)}</span>
                            </label>
                            <input
                                type="range"
                                min={param.min} max={param.max} step={param.step || 0.01}
                                value={val}
                                onChange={(e) => {
                                    updateSlotParam(activeSlot, { [`zoomParam${index+1}`]: parseFloat(e.target.value) });
                                }}
                                style={{width: '100%', accentColor: 'white'}}
                            />
                        </div>
                    );
                })}
            </div>
        </>
    );
};

export default Chassis0_40;
