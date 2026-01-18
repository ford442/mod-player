import React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface CameraRigProps {
  isPlaying: boolean;
  playheadX: number;
  controlsRef: React.MutableRefObject<any>; // Using any for OrbitControls ref as types can be tricky with drei refs
}

const CameraRig: React.FC<CameraRigProps> = ({ playheadX, controlsRef }) => {
  const { camera } = useThree();

  useFrame(() => {
    // Only follow if playing (or always, depending on preference)
    // We assume playheadX corresponds to the actual world X coordinate of the music

    if (controlsRef.current) {
        // 1. Move the ORBIT TARGET to the playhead
        // We lerp (smoothly interpolate) for a less jittery feel
        const currentTarget = controlsRef.current.target;

        // Desired X is the playhead position
        // We keep Y and Z the same as where the user left them
        const targetX = THREE.MathUtils.lerp(currentTarget.x, playheadX, 0.1);

        controlsRef.current.target.set(targetX, currentTarget.y, currentTarget.z);

        // 2. Move the CAMERA along with the target
        // We calculate the offset (distance from camera to target) and maintain it
        // This effectively "drags" the camera along
        const offset = camera.position.x - currentTarget.x;

        // If the camera is lagging too far behind or pushing too far ahead, correct it
        // Ideally, we just add the delta movement of the target to the camera
        // Note: We use the *new* targetX to calculate the new camera X
        camera.position.x = targetX + offset;

        controlsRef.current.update();
    }
  });

  return null;
};

export default CameraRig;
