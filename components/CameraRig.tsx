import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export type CameraPreset = 'front' | 'overhead' | 'dj';

/** Distance (world units) at which a preset transition is considered complete. */
const TRANSITION_COMPLETE_THRESHOLD = 0.15;

/** World-space camera position (relative to playhead centre) for each preset. */
const PRESET_POSITIONS: Record<CameraPreset, [number, number, number]> = {
  front:    [0,  3, 12],
  overhead: [0, 16,  2],
  dj:       [8,  5,  8],
};

interface CameraRigProps {
  isPlaying: boolean;
  playheadX: number;
  controlsRef: React.MutableRefObject<any>;
  cameraPreset?: CameraPreset;
}

const CameraRig: React.FC<CameraRigProps> = ({
  playheadX,
  controlsRef,
  cameraPreset = 'front',
}) => {
  const { camera } = useThree();
  const prevPreset = useRef<CameraPreset>(cameraPreset);
  const isTransitioning = useRef(false);

  useFrame(() => {
    if (!controlsRef.current) return;
    const controls = controlsRef.current;

    // Smoothly follow the playhead horizontally
    const smoothTargetX = THREE.MathUtils.lerp(controls.target.x, playheadX, 0.08);

    // Detect a preset change and kick off a smooth transition
    if (cameraPreset !== prevPreset.current) {
      prevPreset.current = cameraPreset;
      isTransitioning.current = true;
    }

    if (isTransitioning.current) {
      // Lerp camera position towards the chosen preset
      const [px, py, pz] = PRESET_POSITIONS[cameraPreset];
      const targetPos = new THREE.Vector3(px + smoothTargetX, py, pz);
      const targetLook = new THREE.Vector3(smoothTargetX, 0, 0);

      camera.position.lerp(targetPos, 0.07);
      controls.target.lerp(targetLook, 0.07);

      // Stop transitioning once we're close enough
      if (camera.position.distanceTo(targetPos) < TRANSITION_COMPLETE_THRESHOLD) {
        isTransitioning.current = false;
      }
    } else {
      // Normal mode: maintain orbit offset while following the playhead
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      controls.target.set(smoothTargetX, 0, 0);
      camera.position.copy(controls.target).add(offset);
    }

    controls.update();
  });

  return null;
};

export default CameraRig;
