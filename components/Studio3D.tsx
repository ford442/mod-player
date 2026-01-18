import React, { useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import './Shader021_3D';
import CameraRig from './CameraRig';

interface Studio3DProps {
  headerContent?: React.ReactNode;
  patternDisplayContent?: React.ReactNode;
  controlsContent?: React.ReactNode;
  mediaOverlayContent?: React.ReactNode;
  darkMode?: boolean;
  dimFactor?: number;
  playheadX?: number;
  onDarkModeToggle?: () => void;
  onExitStudio?: () => void;
}

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

const BackgroundShaderPlane: React.FC<{ dimFactor: number, playheadX: number }> = ({ dimFactor, playheadX }) => {
  const materialRef = useRef<any>(null);
  const { camera } = useThree();

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.iTime = state.clock.elapsedTime;
      materialRef.current.dimFactor = dimFactor;
      // We use the camera's world position as the ray origin
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

export const Studio3D: React.FC<Studio3DProps> = ({
  headerContent,
  patternDisplayContent,
  controlsContent,
  mediaOverlayContent,
  darkMode = false,
  dimFactor = 1.0,
  playheadX = 0,
  onDarkModeToggle,
  onExitStudio,
}) => {
  const controlsRef = useRef<any>(null);

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
        <CameraRig isPlaying={true} playheadX={playheadX} controlsRef={controlsRef} />

        <PerspectiveCamera makeDefault position={[0, 2, 12]} fov={60} />

        {/* Background Plane using the new Shader */}
        <BackgroundShaderPlane dimFactor={dimFactor} playheadX={playheadX} />

        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.05}
          minDistance={5}
          maxDistance={30}
          maxPolarAngle={Math.PI / 2}
        />

        {/* Lighting */}
        <ambientLight intensity={darkMode ? 0.2 : 0.6} />
        <directionalLight
          position={[10, 10, 5]}
          intensity={darkMode ? 0.3 : 0.8}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <pointLight position={[-10, 5, -5]} intensity={darkMode ? 0.2 : 0.5} />
        <pointLight position={[10, 5, 5]} intensity={darkMode ? 0.2 : 0.5} />

        {/* UI Panels Group - Moves with Playhead so it stays with camera */}
        <group position={[playheadX, 0, 0]}>
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
        </group>
      </Canvas>
    </div>
  );
};
