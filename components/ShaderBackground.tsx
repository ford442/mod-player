import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec3 uCamPos;
  uniform float uDim;   // 1.0 = Bright, 0.3 = Dark

  varying vec2 vUv;

  // QUALITY SETTINGS
  #define MAX_STEPS 128
  #define MAX_DIST 120.0
  #define SURF_DIST 0.001

  // SDF PRIMITIVES
  float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  }

  // THE WORLD GEOMETRY
  float GetDist(vec3 p) {
    // 1. Repeat the world every 6 units
    vec3 z = p;
    z.x = mod(p.x, 6.0) - 3.0;
    z.z = mod(p.z, 6.0) - 3.0;
    // We don't repeat Y, so the floor stays strictly below us

    // 2. Create the boxes (The "Tracker Grid" feel)
    // Boxes oscillate slightly in height based on time
    float heightVar = sin(p.x * 0.5 + uTime) * 0.2;
    float box = sdBox(z - vec3(0, -2.0 + heightVar, 0), vec3(0.5));

    // 3. Create a floor plane
    float plane = p.y + 3.0;

    // Union them
    return min(box, plane);
  }

  // RAYMARCHER
  float RayMarch(vec3 ro, vec3 rd) {
    float dO = 0.0;
    for(int i = 0; i < MAX_STEPS; i++) {
        vec3 p = ro + rd * dO;
        float dS = GetDist(p);
        dO += dS;
        if(dO > MAX_DIST || dS < SURF_DIST) break;
    }
    return dO;
  }

  // CALCULATE NORMALS
  vec3 GetNormal(vec3 p) {
    float d = GetDist(p);
    vec2 e = vec2(0.001, 0);
    vec3 n = d - vec3(
        GetDist(p - e.xyy),
        GetDist(p - e.yxy),
        GetDist(p - e.yyx)
    );
    return normalize(n);
  }

  void main() {
    // 1. Setup Screen Coordinates
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= uResolution.x / uResolution.y;

    // 2. Camera Setup
    // We use the ACTUAL camera position passed from React for the Origin
    vec3 ro = uCamPos;

    // Ray Direction (Forward from camera view)
    // We add a slight offset to look down/around
    vec3 rd = normalize(vec3(uv.x, uv.y, 1.5));

    // 3. Render
    float d = RayMarch(ro, rd);
    vec3 col = vec3(0);

    if(d < MAX_DIST) {
        vec3 p = ro + rd * d;
        vec3 n = GetNormal(p);

        // Lighting
        vec3 lightPos = ro + vec3(0, 5, 0); // Light follows camera
        vec3 l = normalize(lightPos - p);
        float dif = clamp(dot(n, l), 0.1, 1.0);

        // Color Palette (Techno Blue/Purple)
        vec3 baseColor = vec3(0.1, 0.1, 0.15); // Dark background
        vec3 gridColor = vec3(0.0, 0.8, 1.0);  // Cyan grid

        // Pattern on the floor
        float check = mod(floor(p.x) + floor(p.z), 2.0);

        col = mix(baseColor, gridColor, dif * 0.5);
        if(check > 0.5) col *= 0.8; // Checkerboard texture
    }

    // 4. Fog (Fade to black in distance)
    col = mix(col, vec3(0.05, 0.05, 0.08), 1.0 - exp(-0.02 * d));

    // 5. Apply Dark Mode Factor
    col *= uDim;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export const ShaderBackground: React.FC<{ dimFactor: number }> = ({ dimFactor }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera, size } = useThree();

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(size.width, size.height) },
      uCamPos: { value: new THREE.Vector3() },
      uDim: { value: 1.0 },
    }),
    []
  );

  useFrame((state) => {
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.ShaderMaterial;
      mat.uniforms.uTime.value = state.clock.elapsedTime;
      // Pass the real camera position to the shader
      mat.uniforms.uCamPos.value.copy(camera.position);
      mat.uniforms.uDim.value = dimFactor;

      // Update resolution if window resizes
      mat.uniforms.uResolution.value.set(state.size.width, state.size.height);
    }
  });

  return (
    // We attach this mesh to the camera so it acts as a "Screen Filter" window
    // position z=-1 puts it right in front of the lens
    <mesh ref={meshRef} position={[0, 0, -1]}>
      <planeGeometry args={[2, 2]} /> {/* Full screen quad */}
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false} // Don't write to depth buffer (acts as background)
        depthTest={false}  // Always draw (behind everything else logic handled by render order if needed)
      />
    </mesh>
  );
};
