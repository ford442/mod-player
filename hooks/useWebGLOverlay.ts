// WebGL2 overlay subsystem for PatternDisplay.
// Renders three-LED frosted lens caps on top of the WebGPU canvas for hybrid shaders.
// Uses instanced rendering — one quad per (channel × step) pair.
// Three-emitter system: Top=Blue note-on, Mid=Pitch-colored note, Bot=Amber expression.

import { useRef, useEffect, useCallback } from 'react';
import type React from 'react';
import { ChannelShadowState, PatternMatrix, PlaybackState } from '../types';
import { packPatternMatrixHighPrecision } from '../utils/gpuPacking';
import {
  WEBGL_HYBRID_SHADERS,
  getLayoutType,
} from '../utils/shaderVersion';
import {
  GRID_RECT,
  POLAR_RINGS,
  CAP_CONFIG,
  calculateHorizontalCellSize,
  calculateCapScale,
  getLayoutModeFromShader,
  LAYOUT_MODES,
} from '../utils/geometryConstants';

const DEFAULT_ROWS = 64;
const DEFAULT_CHANNELS = 4;

// Runtime base URL detection for subdirectory deployment (e.g., /xm-player/)
const detectRuntimeBase = (): string => {
  const viteBase = import.meta.env.BASE_URL;
  if (viteBase && viteBase !== '/') {
    return viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
  }
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  if (pathSegments.length > 0) {
    return `/${pathSegments[0]}/`;
  }
  return '/';
};

export interface WebGLOverlayParams {
  shaderFile: string;
  matrix: PatternMatrix | null;
  padTopChannel: boolean;
  isOverlayActive: boolean;
  invertChannels: boolean;
  playheadRow: number;
  cellWidth: number;
  cellHeight: number;
  channels?: ChannelShadowState[];
  bloomIntensity?: number;
  playbackStateRef?: React.MutableRefObject<PlaybackState>;
}

type DebugInfo = {
  layoutMode: string;
  errors: string[];
  uniforms: Record<string, number | string>;
};

type GLResources = {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  cellTexture: WebGLTexture;
  stateTexture: WebGLTexture;
  capTexture?: WebGLTexture;
  buffer: WebGLBuffer;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

export function useWebGLOverlay(
  glCanvasRef: React.RefObject<HTMLCanvasElement>,
  params: WebGLOverlayParams,
  setDebugInfo: React.Dispatch<React.SetStateAction<DebugInfo>>
) {
  const glContextRef = useRef<WebGL2RenderingContext | null>(null);
  const glResourcesRef = useRef<GLResources | null>(null);
  const stateDataRef = useRef<Float32Array | null>(null);

  // Mutable ref so draw/upload functions always read fresh values without recreating
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const initWebGL = useCallback(() => {
    const shaderFile = paramsRef.current.shaderFile;
    console.group('🔧 initWebGL');

    // Clean up existing WebGL resources first
    if (glContextRef.current && glResourcesRef.current) {
      const oldGl = glContextRef.current;
      const oldRes = glResourcesRef.current;
      try {
        oldGl.deleteProgram(oldRes.program);
        oldGl.deleteVertexArray(oldRes.vao);
        oldGl.deleteBuffer(oldRes.buffer);
        oldGl.deleteTexture(oldRes.cellTexture);
        oldGl.deleteTexture(oldRes.stateTexture);
        if (oldRes.capTexture) oldGl.deleteTexture(oldRes.capTexture);
        oldGl.clearColor(0, 0, 0, 0);
        oldGl.clear(oldGl.COLOR_BUFFER_BIT | oldGl.DEPTH_BUFFER_BIT);
        console.log('✅ Cleaned up previous WebGL resources and cleared canvas');
      } catch (e) {
        console.warn('⚠️ Error cleaning up WebGL:', e);
      }
      glResourcesRef.current = null;
    }

    if (!glCanvasRef.current) {
      console.warn('⚠️ No glCanvasRef');
      console.groupEnd();
      return;
    }

    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = glCanvasRef.current.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
      if (!gl) {
        console.error('❌ Failed to get WebGL2 context');
        console.groupEnd();
        return;
      }
      console.log('✅ Got WebGL2 context');
    } catch (e) {
      console.error('❌ WebGL2 context error:', e);
      console.groupEnd();
      return;
    }

    glContextRef.current = gl;

    // --- VERTEX SHADER ---
    // Fetches cell data (packedA, packedB) and channel state in the VS,
    // passes as flat varyings to avoid per-pixel texelFetch.
    const vsSource = `#version 300 es
    precision highp float;
    precision highp int;
    precision highp usampler2D;

    in vec2 a_pos;

    // Flat varyings for fragment shader
    flat out uvec2 v_cell;       // (packedA, packedB)
    flat out vec4 v_chState0;    // (volume, pan, freq, trigger)
    flat out vec4 v_chState1;    // (noteAge, activeEffect, effectValue, isMuted)
    out vec2 v_uv;
    flat out float v_active;     // playhead activation
    flat out float v_hasNote;    // 1.0 if note data exists

    uniform vec2 u_resolution;
    uniform vec2 u_cellSize;
    uniform vec2 u_offset;
    uniform float u_cols;
    uniform float u_rows;
    uniform float u_playhead;
    uniform int u_invertChannels;
    uniform int u_layoutMode; // 1=Circ, 2=Horiz32, 3=Horiz64
    uniform highp usampler2D u_cellData;    // RG32UI: (packedA, packedB)
    uniform highp sampler2D u_channelState; // RGBA32F: row0=(vol,pan,freq,trig), row1=(age,eff,effVal,muted)

    const float PI = 3.14159265359;
    const float INNER_RADIUS = 0.3;
    const float OUTER_RADIUS = 0.9;
    const float CAP_SCALE_FACTOR = 0.88;
    const uint NOTE_MIN = 1u;    // Minimum valid MIDI note
    const uint NOTE_MAX = 96u;   // Maximum valid MIDI note
    const uint NOTE_OFF = 97u;   // Note-off command
    const uint NOTE_CUT = 98u;   // Note-cut command
    const uint NOTE_FADE = 99u;  // Note-fade command

    void main() {
        int id = gl_InstanceID;
        int trackIndex = id % int(u_cols);
        int stepIndex  = id / int(u_cols);

        // Page-aware cell data fetch.
        // Horizontal layouts page through the pattern (32 or 64 steps per page);
        // circular layouts show all rows directly but must clamp to valid range.
        int actualRow;
        if (u_layoutMode == 2 || u_layoutMode == 3) {
            float stepsPerPageH = (u_layoutMode == 3) ? 64.0 : 32.0;
            int pageStart = int(floor(u_playhead / stepsPerPageH) * stepsPerPageH);
            actualRow = clamp(pageStart + stepIndex, 0, int(u_rows) - 1);
        } else {
            actualRow = clamp(stepIndex, 0, int(u_rows) - 1);
        }
        uvec2 cellData = texelFetch(u_cellData, ivec2(trackIndex, actualRow), 0).rg;
        v_cell = cellData;

        // Fetch channel state (2 rows)
        v_chState0 = texelFetch(u_channelState, ivec2(trackIndex, 0), 0);
        v_chState1 = texelFetch(u_channelState, ivec2(trackIndex, 1), 0);

        // Check for note data (quick presence detection — full unpacking in FS)
        uint note = (cellData.r >> 24u) & 255u;
        uint effCmd = (cellData.g >> 24u) & 255u;
        uint volCmdFull = cellData.g & 255u; // Low byte of packedB = volCmdFull
        // Duration data for sustain detection in VS
        // packedA layout: [note:8][inst:8][duration:8][volPacked:8]
        uint durationRaw = (cellData.r >> 8u) & 255u;
        // packedB layout: [effCmd:8][effVal:8][durationFlags:7][reserved:1][volCmd:8]
        // durationFlags: [rowOffset:6][isNoteOff:1]
        uint durationFlags = (cellData.g >> 8u) & 127u;
        uint rowOffset = (durationFlags >> 1u) & 63u;
        bool isNoteOffFlag = (durationFlags & 1u) != 0u;
        // A cell is visible if it has a note, expression data, OR is part of an active sustain
        bool hasNoteOrExpr = (note > 0u) || (effCmd > 0u) || (volCmdFull > 0u);
        bool isSustainCell = (note >= NOTE_MIN && note <= NOTE_MAX) && (durationRaw > 1u) && (rowOffset > 0u) && !isNoteOffFlag;
        v_hasNote = (hasNoteOrExpr || isSustainCell) ? 1.0 : 0.0;

        // Playhead Logic
        float stepsPerPage = (u_layoutMode == 3) ? 64.0 : 32.0;
        float relativePlayhead = mod(u_playhead, stepsPerPage);
        float distToPlayhead = abs(float(stepIndex) - relativePlayhead);
        distToPlayhead = min(distToPlayhead, stepsPerPage - distToPlayhead);
        float activation = 1.0 - smoothstep(0.0, 1.5, distToPlayhead);
        v_active = activation;

        // Positioning Logic
        if (u_layoutMode == 2 || u_layoutMode == 3) {
            // --- HORIZONTAL LAYOUT (32-step or 64-step) ---
            float capScale = min(u_cellSize.x, u_cellSize.y) * CAP_SCALE_FACTOR;
            if (v_hasNote < 0.5) capScale = 0.0;
            capScale *= 1.0 + (0.2 * activation);

            float cellX = u_offset.x + float(stepIndex)  * u_cellSize.x;
            float cellY = u_offset.y + float(trackIndex) * u_cellSize.y;

            vec2 centered = a_pos * capScale + vec2(cellX + u_cellSize.x * 0.5, cellY + u_cellSize.y * 0.5);
            vec2 ndc = (centered / u_resolution) * 2.0 - 1.0;
            ndc.y = -ndc.y;
            gl_Position = vec4(ndc, 0.0, 1.0);

        } else {
            // --- CIRCULAR LAYOUT ---
            float numTracks = u_cols;
            float trackIndexF = float(trackIndex);
            if (u_invertChannels == 0) { trackIndexF = numTracks - 1.0 - trackIndexF; }

            // Match WGSL: no floor() — keeps sub-pixel parity with the GPU grid
            float minDim = min(u_resolution.x, u_resolution.y);
            float maxRadius = minDim * 0.45;
            float minRadius = minDim * 0.15;
            float ringDepth = (maxRadius - minRadius) / numTracks;

            // Match WGSL: cell center is at ring-start, not ring-center
            float pixelRadius = minRadius + trackIndexF * ringDepth;

            float totalSteps = 64.0;
            float anglePerStep = (2.0 * PI) / totalSteps;
            float theta = -1.570796 + float(stepIndex) * anglePerStep;

            float circumference = 2.0 * PI * pixelRadius;
            float arcLength = circumference / totalSteps;
            float btnW = arcLength * CAP_SCALE_FACTOR;
            float btnH = ringDepth * 0.92;

            float circPlayhead = mod(u_playhead, totalSteps);
            float circDist = abs(float(stepIndex) - circPlayhead);
            circDist = min(circDist, totalSteps - circDist);
            float circActivation = 1.0 - smoothstep(0.0, 1.5, circDist);
            float popScale = (v_hasNote > 0.5) ? (1.0 + 0.2 * circActivation) : 0.0;
            btnW *= popScale;
            btnH *= popScale;
            v_active = circActivation;

            vec2 localPos = a_pos * vec2(btnW, btnH);
            float rotAng = theta + 1.570796;
            float cA = cos(rotAng); float sA = sin(rotAng);
            float rotX = localPos.x * cA - localPos.y * sA;
            float rotY = localPos.x * sA + localPos.y * cA;

            vec2 center = u_resolution * 0.5;
            float worldX = center.x + cos(theta) * pixelRadius + rotX;
            float worldY = center.y + sin(theta) * pixelRadius + rotY;

            vec2 ndc = vec2(
                (worldX / u_resolution.x) * 2.0 - 1.0,
                1.0 - (worldY / u_resolution.y) * 2.0
            );
            gl_Position = vec4(ndc, 0.0, 1.0);
        }

        v_uv = a_pos + 0.5;
    }
    `;

    // Only compile if using a hybrid shader that needs WebGL caps
    if (!WEBGL_HYBRID_SHADERS.has(shaderFile)) {
      if (glContextRef.current && glCanvasRef.current) {
        const clearGl = glContextRef.current;
        clearGl.clearColor(0, 0, 0, 0);
        clearGl.clear(clearGl.COLOR_BUFFER_BIT | clearGl.DEPTH_BUFFER_BIT);
      }
      console.log('🔧 Shader does not use WebGL2 overlay, canvas cleared');
      console.groupEnd();
      return;
    }

    // --- FRAGMENT SHADER ---
    // Three-LED unified lens cap ported from v0.50 WGSL
    const fsSource = `#version 300 es
    precision highp float;
    precision highp int;

    flat in uvec2 v_cell;
    flat in vec4 v_chState0;
    flat in vec4 v_chState1;
    in vec2 v_uv;
    flat in float v_active;
    flat in float v_hasNote;

    // Note range constants (must match VS)
    const uint NOTE_MIN = 1u;
    const uint NOTE_MAX = 96u;
    const uint NOTE_OFF = 97u;
    const uint NOTE_CUT = 98u;
    const uint NOTE_FADE = 99u;

    uniform sampler2D u_capTexture;
    uniform float u_bloomIntensity;
    uniform float u_timeSec;

    out vec4 fragColor;

    // --- Pitch-to-color (neonPalette from v0.50) ---
    vec3 neonPalette(float hue) {
        float h6 = hue * 6.0;
        float r = clamp(abs(h6 - 3.0) - 1.0, 0.0, 1.0);
        float g = clamp(2.0 - abs(h6 - 2.0), 0.0, 1.0);
        float b = clamp(2.0 - abs(h6 - 4.0), 0.0, 1.0);
        return vec3(r, g, b) * 1.2 + 0.1;
    }

    float pitchClassFromIndex(uint note) {
        if (note < 1u || note > 96u) return 0.0;
        uint semi = (note - 1u) % 12u;
        return float(semi) / 12.0;
    }

    // --- SDF: Rounded Box ---
    float sdRoundedBox(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + vec2(r);
        return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
    }

    // --- Single LED emitter diode ---
    vec4 drawEmitterDiode(vec2 uv, float intensity, vec3 color, bool isOn) {
        vec2 diodeSize = vec2(0.28, 0.14);
        float dDiode = sdRoundedBox(uv, diodeSize * 0.5, 0.06);
        vec2 dieSize = vec2(0.10, 0.05);
        float dDie = sdRoundedBox(uv, dieSize * 0.5, 0.02);
        float diodeMask = 1.0 - smoothstep(0.0, 0.015, dDiode);
        float dieMask = 1.0 - smoothstep(0.0, 0.008, dDie);
        vec3 diodeColor = vec3(0.06, 0.06, 0.08);
        if (isOn) {
            // Central hotspot: tight Gaussian emitting directly under the cap
            // vec2(0.06, 0.03) = die half-size in UV space; 2.5 = falloff sharpness
            float dist = length(uv / vec2(0.06, 0.03));
            float hotspot = exp(-dist * 2.5) * intensity;

            // Subsurface scatter: wider bleed through frosted plastic
            // 0.4 = scatter radius multiplier; 0.3 = max scatter brightness
            float scatter = smoothstep(1.0, 0.0, dist * 0.4) * 0.3 * intensity;

            vec3 dieGlow = color * (1.0 + intensity * 4.0);
            vec3 housingGlow = color * 0.12 * intensity;
            diodeColor = mix(housingGlow, dieGlow, dieMask);
            diodeColor += color * (hotspot * 0.6 + scatter * 0.4);
        }
        return vec4(diodeColor, diodeMask);
    }

    // --- Unified three-emitter lens cap ---
    vec4 drawUnifiedLensCap(
        vec2 uv, vec2 lensSize,
        vec4 topEmitter, vec4 midEmitter, vec4 botEmitter,
        float aa
    ) {
        vec2 p = uv;
        float dBox = sdRoundedBox(p, lensSize * 0.5, 0.12);
        if (dBox > 0.0) return vec4(0.0);

        vec2 topPos = vec2(0.0, -0.28);
        vec2 midPos = vec2(0.0, 0.0);
        vec2 botPos = vec2(0.0, 0.28);

        float radial = length(p / (lensSize * 0.5));
        float edgeThickness = 0.18 + radial * 0.12;
        float centerThickness = 0.06;

        vec3 n = normalize(vec3(p.x * 2.5 / lensSize.x, p.y * 2.5 / lensSize.y, 0.35));
        vec3 viewDir = vec3(0.0, 0.0, 1.0);
        float fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.5);

        vec4 topDiode = drawEmitterDiode(uv - topPos, topEmitter.a, topEmitter.rgb, topEmitter.a > 0.05);
        vec4 midDiode = drawEmitterDiode(uv - midPos, midEmitter.a, midEmitter.rgb, midEmitter.a > 0.05);
        vec4 botDiode = drawEmitterDiode(uv - botPos, botEmitter.a, botEmitter.rgb, botEmitter.a > 0.05);

        vec3 combinedDiode = vec3(0.06, 0.06, 0.08);
        if (botDiode.a > 0.0) combinedDiode = mix(combinedDiode, botDiode.rgb, botDiode.a);
        if (midDiode.a > 0.0) combinedDiode = mix(combinedDiode, midDiode.rgb, midDiode.a);
        if (topDiode.a > 0.0) combinedDiode = mix(combinedDiode, topDiode.rgb, topDiode.a);
        float diodeMask = max(max(topDiode.a, midDiode.a), botDiode.a);

        float refractionStrength = (1.0 - radial * 0.6) * 0.04;
        vec2 refractOffset = p * refractionStrength;

        // Tightened subsurface scattering (matching v0.50 §1)
        vec3 subsurfaceGlow = vec3(0.0);
        float distTop = length(uv - topPos - refractOffset * 0.3);
        float scatterTop = exp(-distTop * 9.0) * topEmitter.a;
        subsurfaceGlow += topEmitter.rgb * scatterTop * 2.2;
        float distMid = length(uv - midPos - refractOffset * 0.5);
        float scatterMid = exp(-distMid * 7.5) * midEmitter.a;
        subsurfaceGlow += midEmitter.rgb * scatterMid * 3.0;
        float distBot = length(uv - botPos - refractOffset * 0.3);
        float scatterBot = exp(-distBot * 9.0) * botEmitter.a;
        subsurfaceGlow += botEmitter.rgb * scatterBot * 2.2;
        // Per-emitter fringe (replaces shared diffusion)
        subsurfaceGlow += topEmitter.rgb * exp(-distTop * 6.0) * topEmitter.a * 0.15;
        subsurfaceGlow += midEmitter.rgb * exp(-distMid * 6.0) * midEmitter.a * 0.15;
        subsurfaceGlow += botEmitter.rgb * exp(-distBot * 6.0) * botEmitter.a * 0.15;

        // Glass base color
        vec3 bgColor = vec3(0.04, 0.04, 0.05);
        vec3 activeColor = midEmitter.rgb * midEmitter.a;
        activeColor = mix(activeColor, topEmitter.rgb, topEmitter.a * 0.5);
        activeColor = mix(activeColor, botEmitter.rgb, botEmitter.a * 0.5);
        float totalGlow = topEmitter.a + midEmitter.a + botEmitter.a;
        vec3 litTint = mix(vec3(0.92, 0.93, 0.98), activeColor, min(totalGlow * 0.4, 0.4));
        vec3 glassBaseColor = mix(bgColor * 0.12, litTint, 0.88);

        float edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);
        float diodeVisibility = diodeMask * 0.55;
        float baseAlpha = 0.72 + 0.28 * fresnel;
        float emitterLift = clamp(topEmitter.a * 0.4 + botEmitter.a * 0.4, 0.0, 0.7);
        float alpha = mix(baseAlpha, 0.32, min(diodeVisibility + emitterLift, 0.9)) * edgeAlpha;

        vec3 lightDir = vec3(0.4, -0.7, 0.6);
        float diff = max(0.0, dot(n, normalize(lightDir)));
        float spec = pow(max(0.0, dot(reflect(-normalize(lightDir), n), viewDir)), 40.0);
        vec3 litGlassColor = glassBaseColor * (0.45 + 0.55 * diff) + vec3(spec * 0.25);

        vec3 finalColor = bgColor;
        float diodeBlend = diodeMask * (1.0 - alpha * 0.65);
        finalColor = mix(finalColor, combinedDiode, diodeBlend);
        finalColor = mix(finalColor, litGlassColor, alpha);
        finalColor += subsurfaceGlow * 1.8;

        // Concentrated glow (tightened radii matching v0.50 §1)
        if (midEmitter.a > 0.05) {
            float midGlowDist = length(uv - midPos - refractOffset * 0.5);
            float midGlow = (1.0 - smoothstep(0.0, 0.18, midGlowDist)) * midEmitter.a * 0.5;
            finalColor += midEmitter.rgb * midGlow;
        }
        if (topEmitter.a > 0.05) {
            float topGlowDist = length(uv - topPos - refractOffset * 0.3);
            float topGlow = (1.0 - smoothstep(0.0, 0.14, topGlowDist)) * topEmitter.a * 0.3;
            finalColor += topEmitter.rgb * topGlow;
        }
        if (botEmitter.a > 0.05) {
            float botGlowDist = length(uv - botPos - refractOffset * 0.3);
            float botGlow = (1.0 - smoothstep(0.0, 0.14, botGlowDist)) * botEmitter.a * 0.3;
            finalColor += botEmitter.rgb * botGlow;
        }

        finalColor += fresnel * vec3(0.9, 0.95, 1.0) * 0.18 * (1.0 + radial * 0.5);

        // Horizontal separator shadows
        float sepShadowTop = (1.0 - smoothstep(0.0, 0.015, abs(p.y - (-0.14)))) * 0.35;
        float sepShadowBot = (1.0 - smoothstep(0.0, 0.015, abs(p.y - 0.14))) * 0.35;
        finalColor -= finalColor * (sepShadowTop + sepShadowBot);

        float vignette = 1.0 - radial * radial * 0.25;
        finalColor *= vignette;

        return vec4(finalColor, edgeAlpha);
    }

    void main() {
        // Unpack cell data
        uint packedA = v_cell.x;
        uint packedB = v_cell.y;

        uint note = (packedA >> 24u) & 255u;
        uint instRaw = (packedA >> 16u) & 255u;
        uint durationRaw = (packedA >> 8u) & 255u;
        uint volPacked = packedA & 255u;
        uint effCmd = (packedB >> 24u) & 255u;
        uint effVal = (packedB >> 16u) & 255u;
        uint durationFlags = (packedB >> 8u) & 127u;
        uint volCmdFull = packedB & 255u;

        bool isExpressionOnly = (instRaw & 128u) != 0u;
        uint volCmd = (volPacked >> 4u) << 4u;

        // Note state detection
        bool hasNote = (note >= NOTE_MIN && note <= NOTE_MAX);
        bool isNoteOff = (note == NOTE_OFF || note == NOTE_CUT || note == NOTE_FADE);
        bool hasExpression = (volCmd > 0u) || (effCmd > 0u) || (volCmdFull > 0u);

        // Duration / sustain state (DURA data packed by calculateNoteDurations)
        // durationFlags layout: [rowOffset:6][isNoteOff:1]
        uint rowOffset = (durationFlags >> 1u) & 63u;
        bool isNoteOffFlag = (durationFlags & 1u) != 0u;
        bool isSustaining = hasNote && (durationRaw > 1u) && (rowOffset > 0u) && !isNoteOffFlag;
        bool isNoteOnRow = hasNote && (rowOffset == 0u);
        // 0.0 at note start → 1.0 at note end; used to fade trail glow
        float sustainProgress = (durationRaw > 1u) ? float(rowOffset) / float(durationRaw) : 0.0;

        // Channel state
        float chVolume = v_chState0.x;
        float chTrigger = v_chState0.w;
        float chNoteAge = v_chState1.x;
        float chIsMuted = v_chState1.w;
        bool isMuted = chIsMuted > 0.5;

        float bloom = u_bloomIntensity;
        float aa = fwidth(v_uv.y) * 0.33;

        // Map UV to lens-cap space (-0.5..0.5)
        vec2 lensUV = v_uv - vec2(0.5);

        // --- THREE EMITTER SETUP ---

        // EMITTER 1 (TOP): Blue/Cyan — Note trigger + sustain trail
        vec3 blueColor = vec3(0.15, 0.5, 1.0);
        float topIntensity = 0.0;
        if (!isMuted) {
            if (chTrigger > 0.5 && isNoteOnRow) {
                // Bright flash on note-on trigger row
                topIntensity = 3.0;
            } else if (isNoteOnRow) {
                // Note-on row near playhead
                topIntensity = v_active * 0.8;
            } else if (isSustaining) {
                // Sustain trail: fades from 0.4 (note start) to 0.2 (note end)
                // Clamped to 0.15 minimum to keep a dim glow visible
                float sustainFade = 0.4 - sustainProgress * 0.2;
                topIntensity = max(sustainFade, 0.15);
            } else if (isNoteOff || isNoteOffFlag) {
                // Note-off: completely dark (channel was cut)
                topIntensity = 0.0;
            }
        }
        vec3 topColor = blueColor * (1.5 + bloom * 2.0);

        // EMITTER 2 (MIDDLE): Pitch-colored note indicator
        vec3 noteColor = vec3(0.15);
        float midIntensity = 0.12;
        if (hasNote && !isExpressionOnly) {
            float pitchHue = pitchClassFromIndex(note);
            noteColor = neonPalette(pitchHue);
            if (isNoteOnRow) {
                // Strong glow for note-on
                midIntensity = 0.6 + bloom * 2.0;
            } else if (isSustaining) {
                // Sustain: fades from 0.5 (note start) to 0.25 (note end)
                // Clamped to 0.15 minimum for a dim ringing glow
                float sustainBright = 0.5 - sustainProgress * 0.25;
                midIntensity = max(sustainBright, 0.15);
            }
            if (isMuted) midIntensity *= 0.3;
        }
        vec3 midColor = noteColor;

        // EMITTER 3 (BOTTOM): Amber/Orange — Expression indicator
        vec3 amberColor = vec3(1.0, 0.55, 0.1);
        float botIntensity = 0.0;
        if (!isMuted) {
            if (isExpressionOnly && hasExpression) {
                // Expression-only step (no note trigger): distinct amber glow
                botIntensity = 2.0;
            } else if (hasExpression && hasNote) {
                // Note + expression: moderate amber
                botIntensity = 1.2;
            } else if (hasNote && v_active > 0.5) {
                botIntensity = 0.6;
            }
        }
        vec3 botColor = amberColor * (1.5 + bloom * 2.0);

        // Draw unified lens cap
        vec2 lensSize = vec2(0.6, 0.82);
        vec4 lens = drawUnifiedLensCap(
            lensUV, lensSize,
            vec4(topColor, topIntensity),
            vec4(midColor, midIntensity),
            vec4(botColor, botIntensity),
            aa
        );

        fragColor = vec4(lens.rgb, lens.a * 0.95);
        if (fragColor.a < 0.01) discard;
    }
    `;

    const createShader = (type: number, src: string, name: string) => {
      try {
        const s = gl!.createShader(type)!;
        gl!.shaderSource(s, src);
        gl!.compileShader(s);
        if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
          const log = gl!.getShaderInfoLog(s);
          console.error(`❌ ${name} Shader Error:`, log);
          gl!.deleteShader(s);
          return null;
        }
        console.log(`✅ ${name} shader compiled`);
        return s;
      } catch (e) {
        console.error(`❌ ${name} shader exception:`, e);
        return null;
      }
    };

    const vs = createShader(gl.VERTEX_SHADER, vsSource, 'Vertex');
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource, 'Fragment');
    if (!vs || !fs) {
      console.error('❌ Shader compilation failed');
      console.groupEnd();
      return;
    }

    let prog: WebGLProgram | null = null;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('❌ GL Link Error:', gl.getProgramInfoLog(prog));
        console.groupEnd();
        return;
      }
      console.log('✅ Shader program linked');
    } catch (e) {
      console.error('❌ Program linking exception:', e);
      console.groupEnd();
      return;
    }

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
      -0.5, 0.5, 0.5, -0.5, 0.5, 0.5
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Cell data texture (RG32UI — packedA, packedB)
    const cellTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, cellTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Channel state texture (RGBA32F — 2 rows per channel)
    const stateTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, stateTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Cap texture (frosted button PNG — legacy, still useful for material)
    const capTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, capTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const capImg = new Image();
    capImg.onload = () => {
      if (!glCanvasRef.current) return;
      const currentGl = glContextRef.current;
      if (currentGl) {
        currentGl.bindTexture(currentGl.TEXTURE_2D, capTex);
        currentGl.texImage2D(currentGl.TEXTURE_2D, 0, currentGl.RGBA, currentGl.RGBA, currentGl.UNSIGNED_BYTE, capImg);
        console.log('✅ Cap texture loaded');
      }
    };
    capImg.onerror = () => { console.warn('⚠️ Failed to load cap texture'); };
    const runtimeBase = detectRuntimeBase();
    capImg.src = `${runtimeBase}unlit-button.png`;
    console.log('[WebGL] Cap texture URL:', `${runtimeBase}unlit-button.png`);

    try {
      const uniformLocs: Record<string, WebGLUniformLocation | null> = {
        u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
        u_cellSize: gl.getUniformLocation(prog, 'u_cellSize'),
        u_offset: gl.getUniformLocation(prog, 'u_offset'),
        u_cols: gl.getUniformLocation(prog, 'u_cols'),
        u_rows: gl.getUniformLocation(prog, 'u_rows'),
        u_playhead: gl.getUniformLocation(prog, 'u_playhead'),
        u_layoutMode: gl.getUniformLocation(prog, 'u_layoutMode'),
        u_invertChannels: gl.getUniformLocation(prog, 'u_invertChannels'),
        u_cellData: gl.getUniformLocation(prog, 'u_cellData'),
        u_channelState: gl.getUniformLocation(prog, 'u_channelState'),
        u_capTexture: gl.getUniformLocation(prog, 'u_capTexture'),
        u_bloomIntensity: gl.getUniformLocation(prog, 'u_bloomIntensity'),
        u_timeSec: gl.getUniformLocation(prog, 'u_timeSec'),
      };

      console.log(`[WebGL] Shader: ${shaderFile}, Layout: ${getLayoutType(shaderFile)}`);

      const coreUniforms = ['u_resolution', 'u_cellData', 'u_cols', 'u_playhead'];
      const variantUniforms = ['u_layoutMode', 'u_invertChannels', 'u_cellSize', 'u_offset', 'u_capTexture', 'u_rows', 'u_channelState', 'u_bloomIntensity', 'u_timeSec'];

      const nullUniforms = Object.entries(uniformLocs)
        .filter(([, loc]) => loc === null)
        .map(([name]) => name);

      const missingCore = nullUniforms.filter(name => coreUniforms.includes(name));
      const missingVariant = nullUniforms.filter(name => variantUniforms.includes(name));

      if (missingCore.length > 0) {
        console.error(`[WebGL] ❌ Missing CORE uniforms in ${shaderFile}:`, missingCore);
      }
      if (missingVariant.length > 0) {
        console.log(`[WebGL] Variant uniforms optimized out in ${shaderFile}:`, missingVariant);
      }

      glResourcesRef.current = { program: prog, vao, cellTexture: cellTex, stateTexture: stateTex, capTexture: capTex, buffer: buf, uniforms: uniformLocs };
      console.log('✅ WebGL resources initialized');
    } catch (e) {
      console.error('❌ Error setting up uniforms:', e);
    }

    console.groupEnd();

    return () => {
      try {
        gl.deleteProgram(prog);
        gl.deleteVertexArray(vao);
        gl.deleteBuffer(buf);
        gl.deleteTexture(cellTex);
        gl.deleteTexture(stateTex);
        if (capTex) gl.deleteTexture(capTex);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      } catch (e) {
        console.warn('Cleanup error:', e);
      }
      glResourcesRef.current = null;
    };
  }, []); // stable — reads from paramsRef

  useEffect(() => {
    return initWebGL();
  }, [paramsRef.current.shaderFile, initWebGL]); // re-init on shader change

  // Upload matrix data to the WebGL cell-data texture (RG32UI)
  useEffect(() => {
    const p = paramsRef.current;
    if (!p.isOverlayActive) return;

    const gl = glContextRef.current;
    const res = glResourcesRef.current;
    if (!gl || !res || !p.matrix) return;

    const rows = p.matrix.numRows;
    const rawCols = p.matrix.numChannels;
    const cols = p.padTopChannel ? rawCols + 1 : rawCols;

    // Always use high-precision packing for consistent three-LED data
    const { packedData } = packPatternMatrixHighPrecision(p.matrix, p.padTopChannel);

    // Upload as RG32UI texture (2 uint32 per texel = packedA, packedB)
    gl.bindTexture(gl.TEXTURE_2D, res.cellTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32UI, cols, rows, 0, gl.RG_INTEGER, gl.UNSIGNED_INT, packedData);
  }, [paramsRef.current.matrix, paramsRef.current.padTopChannel, paramsRef.current.shaderFile]);

  const drawWebGL = useCallback(() => {
    const p = paramsRef.current;
    const gl = glContextRef.current;
    const res = glResourcesRef.current;
    if (!gl || !res || !WEBGL_HYBRID_SHADERS.has(p.shaderFile) || !p.matrix) return;

    const errors: string[] = [];
    const uniformVals: Record<string, number | string> = {};

    try {
      const { program, vao, cellTexture, stateTexture, uniforms } = res;
      const numChannelsForGL = p.padTopChannel ? (p.matrix.numChannels || DEFAULT_CHANNELS) + 1 : (p.matrix.numChannels || DEFAULT_CHANNELS);
      const cols = numChannelsForGL;
      const rows = p.matrix.numRows || DEFAULT_ROWS;

      const preError = gl.getError();
      if (preError !== gl.NO_ERROR) {
        errors.push(`Pre-draw GL Error: 0x${preError.toString(16)}`);
      }

      // Upload channel state texture (RGBA32F, width=cols, height=2)
      const chans = p.channels || [];
      const requiredSize = cols * 2 * 4;
      if (!stateDataRef.current || stateDataRef.current.length !== requiredSize) {
        stateDataRef.current = new Float32Array(requiredSize);
      }
      const stateData = stateDataRef.current;
      const startIdx = p.padTopChannel ? 1 : 0;
      
      // Zero out the padding channel to prevent stale data if re-used
      if (startIdx === 1) {
        for (let j = 0; j < 4; j++) {
          stateData[j] = 0;
          stateData[cols * 4 + j] = 0;
        }
      }

      for (let i = 0; i < (p.matrix.numChannels || DEFAULT_CHANNELS); i++) {
        const ch = chans[i] || { volume: 0, pan: 0.5, freq: 440, trigger: 0, noteAge: 1000, activeEffect: 0, effectValue: 0, isMuted: 0 };
        const colIdx = i + startIdx;
        // Row 0: volume, pan, freq, trigger
        const r0 = colIdx * 4;
        stateData[r0] = ch.volume ?? 0;
        stateData[r0 + 1] = ch.pan ?? 0.5;
        stateData[r0 + 2] = ch.freq ?? 440;
        stateData[r0 + 3] = ch.trigger ?? 0;
        // Row 1: noteAge, activeEffect, effectValue, isMuted
        const r1 = (cols + colIdx) * 4;
        stateData[r1] = ch.noteAge ?? 1000;
        stateData[r1 + 1] = ch.activeEffect ?? 0;
        stateData[r1 + 2] = ch.effectValue ?? 0;
        stateData[r1 + 3] = ch.isMuted ?? 0;
      }

      gl.bindTexture(gl.TEXTURE_2D, stateTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, cols, 2, 0, gl.RGBA, gl.FLOAT, stateData);

      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vao);

      const livePlayheadRow = p.playbackStateRef?.current?.playheadRow ?? p.playheadRow;

      const setUniform = <T extends (loc: WebGLUniformLocation | null, ...args: any[]) => void>(
        _name: string,
        location: WebGLUniformLocation | null | undefined,
        setter: T,
        ...args: Parameters<T> extends [any, ...infer R] ? R : never
      ) => {
        if (location != null) {
          (setter as any)(location, ...args);
          return true;
        }
        return false;
      };

      try {
        const hasResolution = setUniform('u_resolution', uniforms.u_resolution, gl.uniform2f.bind(gl), gl.canvas.width, gl.canvas.height);
        if (hasResolution) uniformVals['u_resolution'] = `${gl.canvas.width}x${gl.canvas.height}`;
        const hasCols = setUniform('u_cols', uniforms.u_cols, gl.uniform1f.bind(gl), cols);
        if (hasCols) uniformVals['u_cols'] = cols;
        const hasRows = setUniform('u_rows', uniforms.u_rows, gl.uniform1f.bind(gl), rows);
        if (hasRows) uniformVals['u_rows'] = rows;
        const hasPlayhead = setUniform('u_playhead', uniforms.u_playhead, gl.uniform1f.bind(gl), livePlayheadRow);
        if (hasPlayhead) uniformVals['u_playhead'] = livePlayheadRow.toFixed(2);
        const hasInvert = setUniform('u_invertChannels', uniforms.u_invertChannels, gl.uniform1i.bind(gl), p.invertChannels ? 1 : 0);
        if (hasInvert) uniformVals['u_invertChannels'] = p.invertChannels ? 1 : 0;

        // New uniforms
        setUniform('u_bloomIntensity', uniforms.u_bloomIntensity, gl.uniform1f.bind(gl), p.bloomIntensity ?? 1.0);
        setUniform('u_timeSec', uniforms.u_timeSec, gl.uniform1f.bind(gl), performance.now() / 1000.0);

        if (!hasResolution || !hasCols || !hasPlayhead) {
          const missing = ['u_resolution', 'u_cols', 'u_playhead'].filter((_, i) =>
            ![hasResolution, hasCols, hasPlayhead][i]
          );
          errors.push(`Missing core uniforms (shader may fail): ${missing.join(', ')}`);
        }
      } catch (e) {
        errors.push(`Uniform upload error: ${e}`);
      }

      // Bind textures
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, cellTexture);
      setUniform('u_cellData', uniforms.u_cellData, gl.uniform1i.bind(gl), 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, stateTexture);
      setUniform('u_channelState', uniforms.u_channelState, gl.uniform1i.bind(gl), 1);

      if (res.capTexture && uniforms.u_capTexture != null) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, res.capTexture);
        gl.uniform1i(uniforms.u_capTexture, 2);
      }

      let effectiveCellW = p.cellWidth;
      let effectiveCellH = p.cellHeight;
      let offsetX = 0;
      let offsetY = 0;
      let layoutModeName = 'CIRCULAR';

      // Override layout for v0.21 (it's horizontal but not in getLayoutModeFromShader)
      let layoutMode = getLayoutModeFromShader(p.shaderFile);
      if (p.shaderFile.includes('v0.21')) {
        layoutMode = LAYOUT_MODES.HORIZONTAL_32;
      }
      const channelCount = cols;

      if (layoutMode === LAYOUT_MODES.HORIZONTAL_32) {
        {
          const metrics = calculateHorizontalCellSize(gl.canvas.width, gl.canvas.height, 32, channelCount);
          effectiveCellW = metrics.cellW;
          effectiveCellH = metrics.cellH;
          offsetX = metrics.offsetX;
          offsetY = metrics.offsetY;
          layoutModeName = '32-STEP';
        }
        if (uniforms.u_offset != null) gl.uniform2f(uniforms.u_offset, offsetX, offsetY);
      } else if (layoutMode === LAYOUT_MODES.HORIZONTAL_64) {
        const metrics = calculateHorizontalCellSize(gl.canvas.width, gl.canvas.height, 64, channelCount);
        effectiveCellW = metrics.cellW;
        effectiveCellH = metrics.cellH;
        offsetX = metrics.offsetX;
        offsetY = metrics.offsetY;
        if (uniforms.u_offset != null) gl.uniform2f(uniforms.u_offset, offsetX, offsetY);
        layoutModeName = '64-STEP';
      } else {
        if (uniforms.u_offset != null) gl.uniform2f(uniforms.u_offset, 0.0, 0.0);
        layoutModeName = 'CIRCULAR';
      }

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const capScale = calculateCapScale(effectiveCellW, effectiveCellH, pixelRatio);

      if (uniforms.u_cellSize != null) gl.uniform2f(uniforms.u_cellSize, effectiveCellW, effectiveCellH);
      if (uniforms.u_layoutMode != null) gl.uniform1i(uniforms.u_layoutMode, layoutMode);

      uniformVals['u_offset'] = `${offsetX.toFixed(1)}, ${offsetY.toFixed(1)}`;
      uniformVals['u_cellSize'] = `${effectiveCellW.toFixed(1)}, ${effectiveCellH.toFixed(1)}`;
      uniformVals['capScale'] = capScale.toFixed(1);
      uniformVals['pixelRatio'] = pixelRatio;
      uniformVals['GRID_RECT'] = `${GRID_RECT.x.toFixed(3)}, ${GRID_RECT.y.toFixed(3)}, ${GRID_RECT.w.toFixed(3)}, ${GRID_RECT.h.toFixed(3)}`;

      // Additive blending: SRC_ALPHA preserves alpha-based edge anti-aliasing,
      // ONE on destination adds light on top of WGSL cells without darkening them.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

      const stepsForMode = layoutMode === LAYOUT_MODES.HORIZONTAL_32 ? 32 :
        layoutMode === LAYOUT_MODES.HORIZONTAL_64 ? 64 : 64;
      const totalInstances = stepsForMode * cols;

      uniformVals['totalInstances'] = totalInstances;
      uniformVals['cols'] = cols;
      uniformVals['rows'] = rows;

      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, totalInstances);

      const postError = gl.getError();
      if (postError !== gl.NO_ERROR) {
        errors.push(`Post-draw GL Error: 0x${postError.toString(16)}`);
      }

      gl.bindVertexArray(null);

      setDebugInfo((prev: DebugInfo) => ({ ...prev, layoutMode: layoutModeName, errors, uniforms: uniformVals }));

      console.group(`🔍 PatternDisplay Debug - Mode ${layoutMode}`);
      console.log('Layout:', layoutModeName);
      console.log('GRID_RECT:', GRID_RECT);
      console.log('POLAR_RINGS:', POLAR_RINGS);
      console.log('CAP_CONFIG:', CAP_CONFIG);
      console.log('effectiveCellW/H:', effectiveCellW, effectiveCellH);
      console.log('capScale:', capScale);
      console.log('totalInstances:', totalInstances);
      console.log('Errors:', errors.length > 0 ? errors : 'None');
      console.groupEnd();

    } catch (e) {
      console.error('❌ drawWebGL error:', e);
      errors.push(`Exception: ${e}`);
      setDebugInfo((prev: DebugInfo) => ({ ...prev, errors }));
    }
  }, [setDebugInfo]); // stable — reads from paramsRef; setDebugInfo is a stable React setter

  return { drawWebGL, glContextRef };
}
