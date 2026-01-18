import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';

interface Studio3DProps {
  headerContent?: React.ReactNode;
  patternDisplayContent?: React.ReactNode;
  controlsContent?: React.ReactNode;
  mediaOverlayContent?: React.ReactNode;
  darkMode?: boolean;
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

// Room/Environment component
const Room: React.FC<{ darkMode: boolean }> = ({ darkMode }) => {
  return (
    <>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, 0]} receiveShadow>
        <planeGeometry args={[50, 50]} />
        <meshStandardMaterial
          color={darkMode ? "#0a0a0a" : "#cccccc"}
          roughness={0.8}
          metalness={0.2}
        />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, 2, -10]} receiveShadow>
        <planeGeometry args={[50, 20]} />
        <meshStandardMaterial
          color={darkMode ? "#0f0f0f" : "#dddddd"}
          roughness={0.9}
          metalness={0.1}
        />
      </mesh>

      {/* Side walls */}
      <mesh position={[-10, 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[50, 20]} />
        <meshStandardMaterial
          color={darkMode ? "#0f0f0f" : "#dddddd"}
          roughness={0.9}
          metalness={0.1}
        />
      </mesh>

      <mesh position={[10, 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[50, 20]} />
        <meshStandardMaterial
          color={darkMode ? "#0f0f0f" : "#dddddd"}
          roughness={0.9}
          metalness={0.1}
        />
      </mesh>
    </>
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
}) => {
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
        <PerspectiveCamera makeDefault position={[0, 2, 12]} fov={60} />
        <OrbitControls
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

        {/* Room environment */}
        <Room darkMode={darkMode} />

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
      </Canvas>
    </div>
  );
};
