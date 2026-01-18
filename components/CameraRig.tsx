import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface CameraRigProps {
  playheadTime: number; // Current time in seconds
  speedMultiplier?: number; // How many 3D units per second of audio
  children?: React.ReactNode;
}

export const CameraRig: React.FC<CameraRigProps> = ({
  playheadTime,
  speedMultiplier = 10.0,
  children
}) => {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!groupRef.current) return;

    // 1. Calculate target X position based on playhead
    const targetX = playheadTime * speedMultiplier;

    // 2. Smoothly interpolate the Rig's X position
    // '0.1' is the smoothing factor (lower = smoother/slower, higher = snappier)
    groupRef.current.position.x = THREE.MathUtils.lerp(
      groupRef.current.position.x,
      targetX,
      0.1
    );

    // 3. Move the R3F Camera to match this rig
    // We update the camera matrix directly to follow this group
    // We keep the camera at a fixed offset relative to the rig (e.g., up 2, back 10)
    const camOffset = new THREE.Vector3(0, 2, 10);

    // Smoothly verify camera follows rig
    state.camera.position.lerp(
      new THREE.Vector3(
        groupRef.current.position.x + camOffset.x,
        groupRef.current.position.y + camOffset.y,
        groupRef.current.position.z + camOffset.z
      ),
      0.1
    );

    // Ensure camera looks slightly ahead of the rig center
    state.camera.lookAt(
        groupRef.current.position.x + 2, // Look 2 units ahead
        0,
        0
    );
  });

  return (
    <group ref={groupRef}>
      {/* If you place 3D UI or lights here, they will travel with the camera */}
      {children}
    </group>
  );
};
