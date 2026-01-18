import * as THREE from 'three';
import { extend, ReactThreeFiber } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';

// V0.21 3D: "Precision Interface" - Infinite Data Grid
const Shader021_3DMaterial = shaderMaterial(
  {
    iTime: 0,
    dimFactor: 1.0,
    cameraPos: new THREE.Vector3(),
    // Colors from patternv0.21.wgsl
    bgColor: new THREE.Color(0.10, 0.11, 0.13),
    ledColor: new THREE.Color(0.0, 0.85, 0.95),
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
    uniform float dimFactor;
    uniform vec3 cameraPos;
    uniform vec3 bgColor;
    uniform vec3 ledColor;

    varying vec2 vUv;

    // --- Configuration ---
    #define MAX_STEPS 128
    #define MAX_DIST 100.0
    #define SURFACE_DIST 0.001

    // --- SDF: Rounded Box (Matches 2D design) ---
    float sdRoundedBox(vec3 p, vec3 b, float r) {
        vec3 q = abs(p) - b;
        return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
    }

    // --- Scene Description ---
    float GetDist(vec3 p) {
        // 1. Grid Repetition (Infinite fields)
        // Spacing: X=4.0 (Time), Y=Vertical layers, Z=Channels
        vec3 spacing = vec3(4.0, 3.0, 4.0);

        // pMod is the local coordinate within each cell
        vec3 pMod = mod(p, spacing) - spacing * 0.5;

        // 2. Geometry: Flat rectangular data plates
        // Similar aspect ratio to the 2D cells
        float dBox = sdRoundedBox(pMod, vec3(1.8, 0.1, 1.5), 0.05);

        // Optional: Add a central "data line" or variation
        // float wave = sin(p.x * 0.5 + iTime) * 0.1;
        // dBox += wave;

        return dBox;
    }

    // --- Raymarching ---
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

    // Normal calculation for edges
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
        // Standard UV setup for full-screen quad
        vec2 uv = (vUv - 0.5) * 2.0;

        // Ray Origin & Direction
        vec3 ro = cameraPos;
        // Adjust RD based on camera orientation if this is a plane in front of camera
        // For a simple background plane, we simulate perspective:
        vec3 rd = normalize(vec3(uv.x, uv.y, 1.5));

        // Rotate RD to match camera rotation (Approximation)
        // Ideally, we'd pass the camera view matrix, but for a background pattern:
        // We will just march relative to the camera position to create parallax.

        float d = RayMarch(ro, rd);

        vec3 col = bgColor; // Default background

        if(d < MAX_DIST) {
            vec3 p = ro + rd * d;
            vec3 n = GetNormal(p);

            // Lighting (Cyber-Punk style)
            // 1. Diffuse from top
            float dif = clamp(dot(n, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);

            // 2. Rim/Edge lighting (Neon Cyan)
            // Fresnel effect: bright at glancing angles
            float fresnel = pow(1.0 - abs(dot(n, rd)), 3.0);

            vec3 bodyColor = bgColor * 1.5; // Slightly lighter than void
            vec3 edgeColor = ledColor;

            col = mix(bodyColor, edgeColor, fresnel);

            // Distance fog to fade out far objects
            float fog = 1.0 - exp(-d * 0.02);
            col = mix(col, bgColor, fog);
        }

        // --- Dark Mode / Dimming ---
        col *= dimFactor;

        gl_FragColor = vec4(col, 1.0);
    }
  `
);

extend({ Shader021_3DMaterial });

declare global {
  namespace JSX {
    interface IntrinsicElements {
      shader021_3DMaterial: ReactThreeFiber.Object3DNode<THREE.ShaderMaterial, typeof Shader021_3DMaterial> & {
        iTime?: number;
        dimFactor?: number;
        cameraPos?: THREE.Vector3;
        bgColor?: THREE.Color;
        ledColor?: THREE.Color;
      };
    }
  }
}

export { Shader021_3DMaterial };
