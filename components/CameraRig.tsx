import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface CameraRigProps {
  isPlaying: boolean;
  playheadX: number;
  controlsRef: React.MutableRefObject<any>;
}

const CameraRig: React.FC<CameraRigProps> = ({ playheadX, controlsRef }) => {
  const { camera } = useThree();

  // Keep track of previous playhead to calculate delta if needed
  const prevPlayhead = useRef(playheadX);

  useFrame(() => {
    if (!controlsRef.current) return;

    const controls = controlsRef.current;

    // We want the camera to focus on the current playhead X
    const targetX = playheadX;

    // 1. Calculate the offset of the camera relative to the *old* target
    //    This preserves the user's zoom level and rotation angle.
    const currentTarget = controls.target;
    const offset = new THREE.Vector3().subVectors(camera.position, currentTarget);

    // 2. Move the target to the new playhead position
    //    Using a small lerp makes it smooth, 1.0 makes it locked.
    //    If playhead moves fast, we want to keep up.

    // Smoothly interpolate the Target X
    const smoothTargetX = THREE.MathUtils.lerp(currentTarget.x, targetX, 0.1);

    controls.target.set(smoothTargetX, 0, 0); // Assuming center is Y=0, Z=0

    // 3. Move the Camera to maintain the offset
    //    This effectively "drags" the camera along with the target
    camera.position.copy(controls.target).add(offset);

    controls.update();

    prevPlayhead.current = playheadX;
  });

  return null;
};

export default CameraRig;
