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
    #define NUM_STARS 200

    // Hash function for pseudo-random star positions
    float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    // Generate star field
    vec3 stars(vec3 rd) {
        vec3 col = vec3(0.0);
        
        // Multiple layers of stars at different depths
        for(float layer = 0.0; layer < 3.0; layer += 1.0) {
            vec3 starDir = rd * (20.0 + layer * 30.0);
            vec3 starCell = floor(starDir);
            
            for(float dx = -1.0; dx <= 1.0; dx += 1.0) {
                for(float dy = -1.0; dy <= 1.0; dy += 1.0) {
                    for(float dz = -1.0; dz <= 1.0; dz += 1.0) {
                        vec3 cell = starCell + vec3(dx, dy, dz);
                        float h = hash(cell + vec3(layer * 10.0));
                        
                        // Only some cells have stars
                        if(h > 0.95) {
                            vec3 starPos = cell + vec3(
                                hash(cell + vec3(1.0, layer, 0.0)),
                                hash(cell + vec3(0.0, layer, 1.0)),
                                hash(cell + vec3(1.0, layer, 1.0))
                            );
                            
                            vec3 toStar = normalize(starPos) - rd;
                            float dist = length(toStar);
                            
                            // Star size and intensity
                            float size = 0.002 + hash(cell + vec3(2.0, layer, 0.0)) * 0.003;
                            float intensity = smoothstep(size, 0.0, dist);
                            
                            // Star color variation (mostly white/blue/cyan)
                            float colorVar = hash(cell + vec3(3.0, layer, 0.0));
                            vec3 starColor = mix(
                                vec3(0.9, 0.95, 1.0),  // White-blue
                                ledColor,               // Cyan from uniform
                                colorVar * 0.5
                            );
                            
                            // Twinkling effect
                            float twinkle = sin(iTime * 3.0 + h * 100.0) * 0.5 + 0.5;
                            intensity *= 0.7 + twinkle * 0.3;
                            
                            col += starColor * intensity * (1.0 - layer * 0.3);
                        }
                    }
                }
            }
        }
        
        return col;
    }

    void main() {
        // Standard UV setup for full-screen quad
        vec2 uv = (vUv - 0.5) * 2.0;

        // Ray Direction
        vec3 rd = normalize(vec3(uv.x, uv.y, 1.5));

        // Start with deep space background
        vec3 col = bgColor * 0.5; // Darker background for night sky

        // Add stars
        col += stars(rd);

        // Subtle nebula-like effect in the background
        float nebula = smoothstep(0.5, 1.0, 
            sin(rd.x * 2.0 + iTime * 0.1) * 
            sin(rd.y * 2.0 + iTime * 0.15) * 
            sin(rd.z * 2.0)
        );
        col += ledColor * nebula * 0.03;

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
