import React, { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import './Shader021_3D';
import CameraRig, { CameraPreset } from './CameraRig';
import { ChannelShadowState } from '../types';

interface Studio3DProps {
  headerContent?: React.ReactNode;
  patternDisplayContent?: React.ReactNode;
  controlsContent?: React.ReactNode;
  mediaOverlayContent?: React.ReactNode;
  darkMode?: boolean;
  dimFactor?: number;
  playheadX?: number;
  viewMode?: 'device' | 'wall';
  channels?: ChannelShadowState[];
  onDarkModeToggle?: () => void;
  onExitStudio?: () => void;
  onViewModeToggle?: () => void;
}

// ─── Panel3D ──────────────────────────────────────────────────────────────────
const Panel3D: React.FC<{
  position: [number, number, number];
  rotation?: [number, number, number];
  width?: number;
  height?: number;
  children: React.ReactNode;
  darkMode?: boolean;
}> = ({ position, rotation = [0, 0, 0], width = 4, height = 3, children, darkMode = false }) => {
  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color={darkMode ? '#111111' : '#f0f0f0'}
          transparent
          opacity={darkMode ? 0.35 : 0.92}
          side={THREE.DoubleSide}
          roughness={0.4}
          metalness={0.2}
        />
      </mesh>
      <Html
        transform
        occlude
        position={[0, 0, 0.01]}
        style={{ width: `${width * 100}px`, height: `${height * 100}px`, pointerEvents: 'auto' }}
        distanceFactor={1}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            background: darkMode ? 'rgba(0, 0, 0, 0.55)' : 'transparent',
            padding: '10px',
            borderRadius: '8px',
            border: darkMode ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(0, 0, 0, 0.1)',
          }}
        >
          {children}
        </div>
      </Html>
    </group>
  );
};

// ─── BackgroundShaderPlane ────────────────────────────────────────────────────
const BackgroundShaderPlane: React.FC<{ dimFactor: number; playheadX: number }> = ({
  dimFactor,
  playheadX,
}) => {
  const materialRef = useRef<any>(null);
  const { camera } = useThree();

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.iTime = state.clock.elapsedTime;
      materialRef.current.dimFactor = dimFactor;
      materialRef.current.cameraPos = camera.position;
    }
  });

  return (
    <mesh position={[playheadX, 0, -20]} scale={[200, 200, 1]}>
      <planeGeometry args={[1, 1]} />
      <shader021_3DMaterial ref={materialRef} transparent side={THREE.DoubleSide} />
    </mesh>
  );
};

// ─── StudioDesk ───────────────────────────────────────────────────────────────
const StudioDesk: React.FC<{ darkMode: boolean }> = ({ darkMode }) => (
  <group>
    {/* Desk surface */}
    <mesh position={[0, -3.6, 1]} receiveShadow castShadow>
      <boxGeometry args={[22, 0.25, 10]} />
      <meshStandardMaterial
        color={darkMode ? '#1a1008' : '#2a1a08'}
        roughness={0.85}
        metalness={0.06}
      />
    </mesh>
    {/* Front-edge accent strip */}
    <mesh position={[0, -3.47, 6.1]} receiveShadow>
      <boxGeometry args={[22, 0.06, 0.25]} />
      <meshStandardMaterial
        color={darkMode ? '#332211' : '#665533'}
        roughness={0.35}
        metalness={0.65}
        emissive={new THREE.Color('#110800')}
        emissiveIntensity={0.15}
      />
    </mesh>
    {/* Floor */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.74, 0]} receiveShadow>
      <planeGeometry args={[80, 60]} />
      <meshStandardMaterial color={darkMode ? '#0a0a0a' : '#181818'} roughness={0.97} />
    </mesh>
  </group>
);

// ─── ChannelLEDStrip ──────────────────────────────────────────────────────────
const CHANNEL_LED_COLORS = [
  '#00ff88', '#00aaff', '#ff8844', '#ff44aa',
  '#aaff00', '#aa44ff', '#00ffdd', '#ffdd00',
  '#ff4444', '#44ffff', '#ff88ff', '#88ff44',
  '#4488ff', '#ffaa44', '#44ffaa', '#ff4488',
];

/** Emissive intensity when a note is actively triggered on the channel. */
const LED_TRIGGER_INTENSITY = 2.8;
/** Multiplier applied to channel volume for passive LED glow. */
const LED_VOLUME_MULTIPLIER = 0.7;

const ChannelLEDStrip: React.FC<{
  channels: ChannelShadowState[];
  position: [number, number, number];
}> = ({ channels, position }) => {
  const count = Math.min(channels.length, 16);
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(() => {
    for (let i = 0; i < count; i++) {
      const mesh = meshRefs.current[i];
      if (!mesh) continue;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const ch = channels[i];
      const trigger = ch?.trigger ?? 0;
      const vol = ch?.volume ?? 0;
      mat.emissiveIntensity = trigger > 0 ? LED_TRIGGER_INTENSITY : vol * LED_VOLUME_MULTIPLIER;
    }
  });

  const slotWidth = count > 0 ? Math.min(0.9, 9.0 / count) : 0.9;

  return (
    <group position={position}>
      {Array.from({ length: count }, (_, i) => {
        const x = (i - (count - 1) / 2) * (slotWidth + 0.1);
        // Modulo always yields a valid index; assert non-null for TypeScript.
        const color = CHANNEL_LED_COLORS[i % CHANNEL_LED_COLORS.length]!;
        const setRef = (el: THREE.Mesh | null) => { meshRefs.current[i] = el; };
        return (
          <mesh key={i} ref={setRef} position={[x, 0, 0]}>
            <boxGeometry args={[slotWidth, 0.18, 0.12]} />
            <meshStandardMaterial
              color={color}
              emissive={new THREE.Color(color)}
              emissiveIntensity={0.08}
              roughness={0.2}
              metalness={0.6}
            />
          </mesh>
        );
      })}
    </group>
  );
};

// ─── Studio3D (main export) ───────────────────────────────────────────────────
export const Studio3D: React.FC<Studio3DProps> = ({
  headerContent,
  patternDisplayContent,
  controlsContent,
  mediaOverlayContent,
  darkMode = false,
  dimFactor = 1.0,
  playheadX = 0,
  viewMode = 'device',
  channels = [],
  onDarkModeToggle,
  onExitStudio,
  onViewModeToggle,
}) => {
  const controlsRef = useRef<any>(null);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('front');

  // Keyboard shortcuts: Escape = exit studio, V = cycle camera presets
  useEffect(() => {
    const PRESETS: CameraPreset[] = ['front', 'overhead', 'dj'];

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape') {
        onExitStudio?.();
      } else if (e.key === 'v' || e.key === 'V') {
        setCameraPreset((prev) => {
          const idx = PRESETS.indexOf(prev);
          return PRESETS[(idx + 1) % PRESETS.length] ?? 'front';
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExitStudio]);

  const btnBase =
    'px-3 py-1.5 text-white text-xs font-mono rounded-lg shadow-lg transition-colors border';
  const btnActive = 'bg-indigo-600 border-indigo-500 hover:bg-indigo-700';
  const btnInactive = 'bg-gray-700 border-gray-600 hover:bg-gray-600';

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>

      {/* ── Top-left: exit button ── */}
      <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 1000 }}>
        <button
          onClick={onExitStudio}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg shadow-lg hover:bg-blue-700 transition-colors border border-blue-500 font-mono text-sm"
          title="Exit 3D Studio (Esc)"
        >
          📐 Exit 3D Studio
        </button>
      </div>

      {/* ── Top-right: view / dark mode toggles ── */}
      <div style={{
        position: 'absolute', top: 16, right: 16, zIndex: 1000,
        display: 'flex', gap: 8,
      }}>
        <button
          onClick={onViewModeToggle}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg shadow-lg hover:bg-purple-700 transition-colors border border-purple-500 font-mono text-sm"
        >
          {viewMode === 'device' ? '📱 Device View' : '🖼️ Wall View'}
        </button>
        <button
          onClick={onDarkModeToggle}
          className="px-4 py-2 bg-gray-800 text-white rounded-lg shadow-lg hover:bg-gray-700 transition-colors border border-gray-600 font-mono text-sm"
        >
          {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
        </button>
      </div>

      {/* ── Camera preset buttons ── */}
      <div style={{
        position: 'absolute', top: 60, right: 16, zIndex: 1000,
        display: 'flex', gap: 6,
      }}>
        {(['front', 'overhead', 'dj'] as CameraPreset[]).map((preset) => (
          <button
            key={preset}
            onClick={() => setCameraPreset(preset)}
            className={`${btnBase} ${cameraPreset === preset ? btnActive : btnInactive}`}
            title={`Camera: ${preset} (V to cycle)`}
          >
            {preset === 'front' ? '👁 Front' : preset === 'overhead' ? '⬆ Top' : '🎧 DJ'}
          </button>
        ))}
      </div>

      <Canvas shadows>
        <CameraRig
          isPlaying={true}
          playheadX={playheadX}
          controlsRef={controlsRef}
          cameraPreset={cameraPreset}
        />

        <PerspectiveCamera makeDefault position={[0, 3, 12]} fov={58} />

        {/* Atmospheric fog */}
        <fog attach="fog" args={[darkMode ? '#050508' : '#1a1a2a', 25, 90]} />

        {/* Background animated shader plane */}
        <BackgroundShaderPlane dimFactor={dimFactor} playheadX={playheadX} />

        {/* ── OrbitControls – constrained to desk-view hemisphere ── */}
        <OrbitControls
          ref={controlsRef}
          enableDamping
          keyEvents={false}
          dampingFactor={0.06}
          minDistance={4}
          maxDistance={28}
          minPolarAngle={Math.PI / 18}       // ≈ 10° – never below desk
          maxPolarAngle={Math.PI * 0.42}     // ≈ 76° – never underground
          minAzimuthAngle={-Math.PI * 0.55}  // ± ~100° horizontal pan limit
          maxAzimuthAngle={Math.PI * 0.55}
        />

        {/* ── Three-point studio lighting ── */}
        {/* Warm key light – front-left, casts shadows */}
        <directionalLight
          position={[7, 9, 7]}
          intensity={darkMode ? 0.55 : 1.3}
          color="#ffe8c8"
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-near={1}
          shadow-camera-far={40}
          shadow-camera-left={-12}
          shadow-camera-right={12}
          shadow-camera-top={12}
          shadow-camera-bottom={-12}
          shadow-bias={-0.001}
        />
        {/* Cool fill light – front-right, no shadows */}
        <directionalLight
          position={[-9, 5, 5]}
          intensity={darkMode ? 0.18 : 0.45}
          color="#c8d8ff"
        />
        {/* Purple rim light – behind and above, separates hardware from bg */}
        <directionalLight
          position={[0, 7, -9]}
          intensity={darkMode ? 0.28 : 0.55}
          color="#cc88ff"
        />
        {/* Very dim ambient fill */}
        <ambientLight intensity={darkMode ? 0.07 : 0.22} />

        {/* ── Studio environment (static) ── */}
        <StudioDesk darkMode={darkMode} />

        {/* ── Dynamic content – follows playhead ── */}
        <group position={[playheadX, 0, 0]}>

          {/* Channel LED activity strip – aligned over the pattern display */}
          {channels.length > 0 && (
            <ChannelLEDStrip channels={channels} position={[0, 2.35, 2.2]} />
          )}

          {/* Header panel */}
          {headerContent && (
            <Panel3D position={[0, 4.2, -2]} width={8} height={1.5} darkMode={darkMode}>
              {headerContent}
            </Panel3D>
          )}

          {/* Main pattern display */}
          {patternDisplayContent && (
            <Panel3D
              position={viewMode === 'wall' ? [0, 2, -15] : [0, -0.8, 2]}
              rotation={viewMode === 'wall' ? [0, 0, 0] : [Math.PI / 8, 0, 0]}
              width={viewMode === 'wall' ? 16 : 10}
              height={viewMode === 'wall' ? 12 : 6}
              darkMode={darkMode}
            >
              {patternDisplayContent}
            </Panel3D>
          )}

          {/* Controls panel */}
          {controlsContent && (
            <Panel3D
              position={[0, -2.7, 1]}
              rotation={[Math.PI / 12, 0, 0]}
              width={9}
              height={1.8}
              darkMode={darkMode}
            >
              {controlsContent}
            </Panel3D>
          )}

          {/* Media overlay panel – right side */}
          {mediaOverlayContent && (
            <Panel3D
              position={[6, 0.5, -1]}
              rotation={[0, -Math.PI / 6, 0]}
              width={4}
              height={3}
              darkMode={darkMode}
            >
              {mediaOverlayContent}
            </Panel3D>
          )}

        </group>
      </Canvas>
    </div>
  );
};

