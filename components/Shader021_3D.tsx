import * as THREE from 'three';
import { extend, ReactThreeFiber } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';

// This shader creates a high-fidelity raymarching environment
// optimized for 3D mode with 128 stepping iterations.
const Shader021_3DMaterial = shaderMaterial(
  {
    iTime: 0,
    iResolution: new THREE.Vector2(),
    dimFactor: 1.0, // 1.0 = Bright (Light Mode), 0.3 = Dark (Dark Mode)
    cameraPos: new THREE.Vector3(),
    iColor: new THREE.Color(0.1, 0.8, 0.9), // Base cyan color
  },
  // Vertex Shader
  `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  // Fragment Shader
  `
    uniform float iTime;
    uniform vec2 iResolution;
    uniform float dimFactor;
    uniform vec3 cameraPos;
    uniform vec3 iColor;

    varying vec2 vUv;

    // --- Configuration ---
    #define MAX_STEPS 128       // High quality steps
    #define MAX_DIST 100.0
    #define SURFACE_DIST 0.001

    // --- SDF Functions (The "0.21" Aesthetic) ---
    // Simple noise function for texture
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    // Signed Distance Function
    float GetDist(vec3 p) {
        // Create a repeating grid of spheres or visual elements
        vec3 s = vec3(4.0); // Spacing
        vec3 q = mod(p, s) - s * 0.5;

        // Base sphere
        float d = length(q) - 0.5;

        // Add some geometric variation based on time
        float wave = sin(p.z * 0.5 + iTime) * 0.2;
        d += wave;

        return d;
    }

    // --- Raymarching Engine ---
    float RayMarch(vec3 ro, vec3 rd) {
        float dO = 0.0;
        for(int i = 0; i < MAX_STEPS; i++) {
            vec3 p = ro + rd * dO;
            float dS = GetDist(p);
            dO += dS;
            if(dO > MAX_DIST || dS < SURFACE_DIST) break;
        }
        return dO;
    }

    // Calculate Normal
    vec3 GetNormal(vec3 p) {
        float d = GetDist(p);
        vec2 e = vec2(0.01, 0);
        vec3 n = d - vec3(
            GetDist(p - e.xyy),
            GetDist(p - e.yxy),
            GetDist(p - e.yyx)
        );
        return normalize(n);
    }

    void main() {
        // Pixel coordinates centered
        vec2 uv = (vUv - 0.5) * 2.0;

        // Ray Origin (use actual camera or fixed relative)
        vec3 ro = cameraPos;

        // Ray Direction
        // Simple perspective approximation for shader plane
        // Adjust for aspect ratio if needed, but here we assume square UVs on plane or handle in geometry
        vec3 rd = normalize(vec3(uv.x, uv.y, 1.0));

        // Perform Raymarching
        float d = RayMarch(ro, rd);

        vec3 col = vec3(0.0);

        if(d < MAX_DIST) {
            vec3 p = ro + rd * d;
            vec3 n = GetNormal(p);

            // Simple lighting
            vec3 lightPos = vec3(2.0, 5.0, -3.0);
            vec3 l = normalize(lightPos - p);
            float dif = clamp(dot(n, l), 0.0, 1.0);

            // "0.21" Color Palette (Cyan/Purple/Dark)
            // Use iColor uniform for base
            col = iColor * dif;

            // Ambient glow
            col += vec3(0.2, 0.1, 0.4) * 0.2;
        } else {
            // Background color
            col = vec3(0.05, 0.05, 0.1);
        }

        // --- Apply Dark Mode ---
        col *= dimFactor;

        gl_FragColor = vec4(col, 1.0);
    }
  `
);

extend({ Shader021_3DMaterial });

// Add type definition for the new material
declare global {
  namespace JSX {
    interface IntrinsicElements {
      shader021_3DMaterial: ReactThreeFiber.Object3DNode<THREE.ShaderMaterial, typeof Shader021_3DMaterial> & {
        iTime?: number;
        iResolution?: THREE.Vector2;
        dimFactor?: number;
        cameraPos?: THREE.Vector3;
        iColor?: THREE.Color;
      };
    }
  }
}

export { Shader021_3DMaterial };
