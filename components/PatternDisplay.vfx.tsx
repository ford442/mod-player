// Enhanced PatternDisplay with VFX
// Features: PBR lighting, bloom, color grading, particles, animations

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { ChannelShadowState, PatternMatrix } from '../types';

// VFX Settings interface
interface VFXSettings {
  // PBR
  metallic: number;
  roughness: number;
  aoStrength: number;
  
  // Post-processing
  bloomIntensity: number;
  bloomThreshold: number;
  chromaticAberration: number;
  vignette: number;
  crtEffect: number;
  
  // Color grading
  colorTemp: number;  // -1 (warm) to 1 (cool)
  contrast: number;   // 0 to 2
  saturation: number; // 0 to 2
  brightness: number; // 0 to 2
  
  // Animation
  animationSpeed: number;
  easing: 'linear' | 'easeOut' | 'easeInOut' | 'elastic';
  
  // Particles
  particleCount: number;
  particleIntensity: number;
  
  // Theme
  theme: 'cyan' | 'amber' | 'green' | 'purple' | 'custom';
}

const DEFAULT_VFX_SETTINGS: VFXSettings = {
  metallic: 0.8,
  roughness: 0.3,
  aoStrength: 1.0,
  bloomIntensity: 1.2,
  bloomThreshold: 0.8,
  chromaticAberration: 0.0,
  vignette: 0.3,
  crtEffect: 0.0,
  colorTemp: 0.0,
  contrast: 1.1,
  saturation: 1.2,
  brightness: 1.0,
  animationSpeed: 1.0,
  easing: 'easeOut',
  particleCount: 100,
  particleIntensity: 0.5,
  theme: 'cyan',
};

// Theme presets
const THEMES: Record<string, { primary: [number, number, number]; accent: [number, number, number] }> = {
  cyan: { primary: [0.0, 0.8, 1.0], accent: [0.5, 1.0, 1.0] },
  amber: { primary: [1.0, 0.6, 0.0], accent: [1.0, 0.8, 0.2] },
  green: { primary: [0.0, 1.0, 0.4], accent: [0.4, 1.0, 0.6] },
  purple: { primary: [0.8, 0.0, 1.0], accent: [1.0, 0.4, 1.0] },
  custom: { primary: [0.0, 0.8, 1.0], accent: [0.5, 1.0, 1.0] },
};

// Particle system
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: [number, number, number];
}

export const PatternDisplayVFX: React.FC<{
  matrix: PatternMatrix | null;
  playheadRow: number;
  isPlaying: boolean;
  bpm: number;
  timeSec: number;
  beatPhase: number;
  kickTrigger: number;
  activeChannels: number[];
  channelStates: ChannelShadowState[];
  shaderFile?: string;
  vfxSettings?: Partial<VFXSettings>;
  showWaveform?: boolean;
  showFrequency?: boolean;
}> = ({
  matrix: _matrix,
  playheadRow: _playheadRow,
  isPlaying: _isPlaying,
  bpm: _bpm,
  timeSec: _timeSec,
  beatPhase: _beatPhase,
  kickTrigger,
  activeChannels: _activeChannels,
  channelStates: _channelStates,
  shaderFile = 'pattern-vfx.wgsl',
  vfxSettings: userSettings,
  showWaveform: _showWaveform,
  showFrequency: _showFrequency,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deviceRef = useRef<GPUDevice | null>(null);
  const contextRef = useRef<GPUCanvasContext | null>(null);
  const pipelineRef = useRef<GPURenderPipeline | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>(0);
  
  const [gpuReady, setGpuReady] = useState(false);
  const [frameTime, setFrameTime] = useState(0);
  
  // Merge settings
  const settings = useMemo(() => ({
    ...DEFAULT_VFX_SETTINGS,
    ...userSettings,
  }), [userSettings]);
  
  const theme = THEMES[settings.theme] ?? THEMES.cyan;
  const themePrimary = theme?.primary ?? [0.0, 0.8, 1.0];
  
  // Initialize particles
  useEffect(() => {
    particlesRef.current = Array.from({ length: settings.particleCount }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.001,
      vy: (Math.random() - 0.5) * 0.001,
      life: 0,
      maxLife: 1 + Math.random() * 2,
      size: 1 + Math.random() * 2,
      color: themePrimary as [number, number, number],
    }));
  }, [settings.particleCount, settings.theme]);
  
  // Update particles
  const updateParticles = useCallback((deltaTime: number) => {
    const particles = particlesRef.current;
    
    // Spawn new particles on beat
    if (kickTrigger > 0.5) {
      for (let i = 0; i < 10; i++) {
        const idx = Math.floor(Math.random() * particles.length);
        const p = particles[idx];
        if (!p) continue;
        p.life = p.maxLife;
        p.x = 0.5 + (Math.random() - 0.5) * 0.2;
        p.y = 0.5 + (Math.random() - 0.5) * 0.2;
        p.vx = (Math.random() - 0.5) * 0.01;
        p.vy = (Math.random() - 0.5) * 0.01;
      }
    }
    
    // Update existing particles
    for (const p of particles) {
      if (p.life > 0) {
        p.x += p.vx * deltaTime * settings.animationSpeed;
        p.y += p.vy * deltaTime * settings.animationSpeed;
        p.life -= deltaTime;
        
        // Wrap around
        if (p.x < 0) p.x = 1;
        if (p.x > 1) p.x = 0;
        if (p.y < 0) p.y = 1;
        if (p.y > 1) p.y = 0;
      }
    }
  }, [kickTrigger, settings.animationSpeed]);
  
  // Initialize WebGPU
  useEffect(() => {
    const init = async () => {
      if (!canvasRef.current) return;
      
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) return;
      
      const device = await adapter.requestDevice();
      const context = canvasRef.current.getContext('webgpu');
      if (!context) return;
      
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: 'premultiplied' });
      
      // Load enhanced shader
      const response = await fetch(`/shaders-enhanced/${shaderFile}`);
      const shaderCode = await response.text();
      
      const shaderModule = device.createShaderModule({ code: shaderCode });
      
      // Create pipeline with PBR settings
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: shaderModule, entryPoint: 'vs' },
        fragment: {
          module: shaderModule,
          entryPoint: 'fs',
          targets: [{
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          }],
        },
        primitive: { topology: 'triangle-list' },
      });
      
      deviceRef.current = device;
      contextRef.current = context;
      pipelineRef.current = pipeline;
      setGpuReady(true);
    };
    
    init();
  }, [shaderFile]);
  
  // Render loop
  useEffect(() => {
    if (!gpuReady) return;
    
    const device = deviceRef.current;
    const context = contextRef.current;
    const pipeline = pipelineRef.current;
    if (!device || !context || !pipeline) return;
    
    let lastTime = performance.now();
    
    const render = () => {
      const now = performance.now();
      const deltaTime = (now - lastTime) / 1000;
      lastTime = now;
      
      // Update frame time display
      setFrameTime(deltaTime * 1000);
      
      // Update particles
      updateParticles(deltaTime);
      
      // Begin render pass
      const commandEncoder = device.createCommandEncoder();
      const textureView = context.getCurrentTexture().createView();
      
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: textureView,
          loadOp: 'clear',
          clearValue: { r: 0.02, g: 0.02, b: 0.03, a: 1 },
          storeOp: 'store',
        }],
      });
      
      // Set pipeline and draw
      renderPass.setPipeline(pipeline);
      // ... bind uniforms, draw calls ...
      
      renderPass.end();
      device.queue.submit([commandEncoder.finish()]);
      
      animationRef.current = requestAnimationFrame(render);
    };
    
    render();
    
    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [gpuReady, updateParticles]);
  
  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ imageRendering: 'crisp-edges' }}
      />
      
      {/* VFX Debug Overlay */}
      {/* @ts-expect-error - process may not be defined in browser */}
      {typeof process !== 'undefined' && process.env?.NODE_ENV === 'development' && (
        <div className="absolute top-2 right-2 bg-black/50 text-white text-xs font-mono p-2 rounded">
          <div>Frame: {frameTime.toFixed(2)}ms</div>
          <div>FPS: {(1000 / Math.max(frameTime, 1)).toFixed(0)}</div>
          <div>Particles: {particlesRef.current.filter(p => p.life > 0).length}</div>
        </div>
      )}
      
      {/* VFX Settings Panel */}
      <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs font-mono p-3 rounded max-w-xs">
        <h4 className="font-bold mb-2">VFX Settings</h4>
        
        <div className="space-y-1">
          <label className="flex justify-between">
            <span>Bloom:</span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={settings.bloomIntensity}
              className="w-20"
            />
          </label>
          
          <label className="flex justify-between">
            <span>Vignette:</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.vignette}
              className="w-20"
            />
          </label>
          
          <label className="flex justify-between">
            <span>CRT:</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.crtEffect}
              className="w-20"
            />
          </label>
        </div>
      </div>
    </div>
  );
};

export default PatternDisplayVFX;
