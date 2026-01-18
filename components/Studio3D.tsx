import React from 'react';
import { Canvas, useThree, createPortal } from '@react-three/fiber';
import { Html, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { CameraRig } from './CameraRig';
import { ShaderBackground } from './ShaderBackground';

interface Studio3DProps {
  headerContent?: React.ReactNode;
  patternDisplayContent?: React.ReactNode;
  controlsContent?: React.ReactNode;
  mediaOverlayContent?: React.ReactNode;
  darkMode?: boolean;
  onDarkModeToggle?: () => void;
  onExitStudio?: () => void;
  playheadTime?: number;
}

// Helper to attach the background to the camera frame
const MovingBackground: React.FC<{ dimFactor: number }> = ({ dimFactor }) => {
  const { camera } = useThree();
  // We use createPortal to mount the shader mesh as a child of the camera object.
  // This ensures it stays fixed relative to the camera view (like a HUD/screen filter),
  // while the shader logic uses the world camera position to simulate movement.
  return createPortal(
    <ShaderBackground dimFactor={dimFactor} />,
    camera as unknown as THREE.Object3D
  );
};

// Panel component to display HTML content in 3D space
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
      {/* Panel background with optional darkness effect */}
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color={darkMode ? "#1a1a1a" : "#ffffff"}
          transparent
          opacity={darkMode ? 0.3 : 0.95}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* HTML content overlay */}
      <Html
        transform
        occlude
        position={[0, 0, 0.01]}
        style={{
          width: `${width * 100}px`,
          height: `${height * 100}px`,
          pointerEvents: 'auto',
        }}
        distanceFactor={1}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            background: darkMode ? 'rgba(0, 0, 0, 0.5)' : 'transparent',
            padding: '10px',
            borderRadius: '8px',
            border: darkMode ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)',
          }}
        >
          {children}
        </div>
      </Html>
    </group>
  );
};

export const Studio3D: React.FC<Studio3DProps> = ({
  headerContent,
  patternDisplayContent,
  controlsContent,
  mediaOverlayContent,
  darkMode = false,
  onDarkModeToggle,
  onExitStudio,
  playheadTime = 0,
}) => {
  // 1.0 = Bright, 0.3 = Dark
  const dimFactor = darkMode ? 0.3 : 1.0;

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      {/* Exit 3D Studio button */}
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        zIndex: 1000,
      }}>
        <button
          onClick={onExitStudio}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg shadow-lg hover:bg-blue-700 transition-colors border border-blue-500 font-mono text-sm"
        >
          📐 Exit 3D Studio
        </button>
      </div>

      {/* Dark mode toggle button */}
      <div style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        zIndex: 1000,
      }}>
        <button
          onClick={onDarkModeToggle}
          className="px-4 py-2 bg-gray-800 text-white rounded-lg shadow-lg hover:bg-gray-700 transition-colors border border-gray-600"
        >
          {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
        </button>
      </div>

      <Canvas shadows>
        {/* Camera Setup - managed by CameraRig but we define the default here */}
        <PerspectiveCamera makeDefault position={[0, 2, 12]} fov={60} />

        {/* Lighting */}
        <ambientLight intensity={dimFactor * 0.5} />
        <directionalLight
          position={[10, 10, 5]}
          intensity={dimFactor * 0.8}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <pointLight position={[-10, 5, -5]} intensity={dimFactor * 0.5} />
        <pointLight position={[10, 5, 5]} intensity={dimFactor * 0.5} />

        {/*
            Background Shader:
            Attached to the camera so it stays "in front" as a lens/portal,
            but simulates world movement via uCamPos.
        */}
        <MovingBackground dimFactor={dimFactor} />

        {/*
            Camera Rig (HUD):
            Moves the camera along X based on playheadTime.
            Contains the UI panels so they travel with the camera.
        */}
        <CameraRig playheadTime={playheadTime}>
            {/* Header Panel - Top center */}
            {headerContent && (
              <Panel3D
                position={[0, 4, -2]}
                width={8}
                height={1.5}
                darkMode={darkMode}
              >
                {headerContent}
              </Panel3D>
            )}

            {/* Main Pattern Display Panel - Center */}
            {patternDisplayContent && (
              <Panel3D
                position={[0, 0.5, 0]}
                width={10}
                height={6}
                darkMode={darkMode}
              >
                {patternDisplayContent}
              </Panel3D>
            )}

            {/* Controls Panel - Bottom */}
            {controlsContent && (
              <Panel3D
                position={[0, -2.5, 1]}
                rotation={[Math.PI / 12, 0, 0]}
                width={9}
                height={1.8}
                darkMode={darkMode}
              >
                {controlsContent}
              </Panel3D>
            )}

            {/* Media Overlay Panel - Right side (if visible) */}
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
        </CameraRig>

      </Canvas>
    </div>
  );
};
