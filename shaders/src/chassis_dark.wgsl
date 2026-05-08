// ============================================================
// chassis_dark.wgsl — Source file
// Dark Plastic Hardware Chassis
//
// Replaces: chassisv0.37.wgsl, chassisv0.40.wgsl
//
// Assembled via build-shaders.mjs from:
//   #include "chassis_base.wgsl"
//
// Supports two layout presets via layoutPreset uniform (offset 92):
//   0 — v0.37 style (buttons at edges, rounded corners, volume at 0.28)
//   1 — v0.40 style (buttons inward, square corners, volume at 0.08)
//
// Fixes from original:
//   • currentRow correctly typed as f32 (matching JS float writes)
// ============================================================

#include "chassis_base.wgsl"

// --- Dark Materials ---

fn drawWhiteButton(
    uv: vec2<f32>, size: vec2<f32>, glowColor: vec3<f32>,
    isOn: bool, aa: f32, cornerRadius: f32
) -> vec4<f32> {
  let halfSize = size * 0.5;
  let d = sdRoundedBox(uv, halfSize, cornerRadius);
  var col = vec3<f32>(0.90, 0.90, 0.92);
  col *= (0.95 + 0.05 * cos(uv.y * 8.0));
  var alpha = 0.0;
  let bodyMask = 1.0 - smoothstep(0.0, aa, d);
  if (isOn) {
    col = vec3<f32>(1.0, 1.0, 1.0);
    col = mix(col, glowColor, 0.2);
  } else {
    col = vec3<f32>(0.65, 0.65, 0.68);
  }
  if (bodyMask > 0.0) { alpha = 1.0; }
  if (isOn) {
    let glowDist = max(0.0, d);
    let glow = exp(-glowDist * 12.0) * glowColor * 1.5;
    if (d > 0.0) {
      col = glow;
      alpha = smoothstep(0.0, 0.4, length(glow));
    } else {
      col += glow * 0.5;
    }
  }
  if (!isOn) { alpha = bodyMask; }
  return vec4<f32>(col, alpha);
}

// --- Fragment Shader (Dark + Layout Preset) ---

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let p = uv - 0.5;
  let aa = 1.0 / bez.canvasH;
  let preset = bez.layoutPreset;

  // Layout configuration
  let isV40 = (preset == 1u);
  let cornerRadius = select(0.015, 0.0, isV40);
  let volPos = select(vec2<f32>(0.28, 0.415), vec2<f32>(0.08, 0.415), isV40);
  let volLabelX = select(0.16, 0.06, isV40);
  let posLoop = select(vec2<f32>(-0.44, 0.42), vec2<f32>(-0.24, 0.42), isV40);
  let posOpen = select(vec2<f32>(0.44, 0.42), vec2<f32>(0.24, 0.42), isV40);
  let posPlay = select(vec2<f32>(-0.44, -0.40), vec2<f32>(-0.44, -0.45), isV40);
  let posStop = select(vec2<f32>(-0.35, -0.40), vec2<f32>(-0.35, -0.45), isV40);

  // --- PASS 1: PHYSICAL CASE ---
  let colPlastic = vec3<f32>(0.08, 0.08, 0.10);
  let colRecess = vec3<f32>(0.05, 0.05, 0.06);
  var color = colPlastic;

  let texSample = textureSampleLevel(bezelTexture, bezelSampler, uv, 0.0);
  if (texSample.a > 0.1) {
    color = mix(color, texSample.rgb, texSample.a);
  } else {
    let dist = length(p);
    if (dist < 0.47 && dist > 0.13) {
      color = colRecess;
      color -= vec3<f32>(0.01) * sin(dist * 200.0);
    }
  }

  let displayY = 0.45;
  let sliderRightX = 0.42;
  let sliderY = -0.2;
  let sliderH = 0.2;
  let sliderW = 0.015;

  // --- LABELS ---
  let labelCol = vec3<f32>(0.6, 0.6, 0.7);
  let dTempoLabel = drawText(p - vec2<f32>(-0.07, displayY), vec2<f32>(0.03, 0.008));
  if (dTempoLabel < 0.0) { color = mix(color, labelCol, smoothstep(aa, 0.0, dTempoLabel)); }

  let dBPMLabel = drawText(p - vec2<f32>(0.07, displayY), vec2<f32>(0.015, 0.008));
  if (dBPMLabel < 0.0) { color = mix(color, labelCol, smoothstep(aa, 0.0, dBPMLabel)); }

  let dPanLabel = drawText(p - vec2<f32>(sliderRightX, sliderY - sliderH * 0.6), vec2<f32>(0.03, 0.008));
  if (dPanLabel < 0.0) { color = mix(color, labelCol, smoothstep(aa, 0.0, dPanLabel)); }

  let dVolLabel = drawText(p - vec2<f32>(volLabelX, 0.415), vec2<f32>(0.02, 0.008));
  if (dVolLabel < 0.0) { color = mix(color, labelCol, smoothstep(aa, 0.0, dVolLabel)); }

  // --- SLIDERS ---
  let dVolTrack = sdRoundedBox(p - volPos, vec2<f32>(0.09, 0.006), 0.003);
  if (dVolTrack < 0.0) { color = mix(color, vec3<f32>(0.15, 0.15, 0.18), 0.8); }

  let volNorm = clamp(bez.volume, 0.0, 1.0);
  let volHandleX = volPos.x + (volNorm - 0.5) * 0.18 * 0.9;
  let dVolHandle = sdCircle(p - vec2<f32>(volHandleX, volPos.y), 0.02);
  if (dVolHandle < 0.0) { color = mix(color, vec3<f32>(0.3, 0.8, 0.4), smoothstep(aa, -aa, dVolHandle)); }

  let dPanTrack = sdRoundedBox(p - vec2<f32>(sliderRightX, sliderY), vec2<f32>(sliderW * 0.5, sliderH * 0.5), 0.003);
  if (dPanTrack < 0.0) { color = mix(color, vec3<f32>(0.15, 0.15, 0.18), 0.8); }

  let panNorm = clamp(bez.pan, -1.0, 1.0);
  let panHandleY = sliderY + panNorm * sliderH * 0.45;
  let dPanHandle = sdCircle(p - vec2<f32>(sliderRightX, panHandleY), 0.02);
  if (dPanHandle < 0.0) {
    let panColor = mix(vec3<f32>(0.8, 0.3, 0.3), vec3<f32>(0.3, 0.3, 0.8), (panNorm + 1.0) * 0.5);
    color = mix(color, panColor, smoothstep(aa, -aa, dPanHandle));
  }

  // Song position rail
  let barY = -0.45;
  let barWidth = 0.6;
  let barCenterX = 0.1;
  let dBarRail = sdRoundedBox(p - vec2<f32>(barCenterX, barY), vec2<f32>(barWidth * 0.5, 0.015), 0.005);
  if (dBarRail < 0.0) { color = mix(color, vec3<f32>(0.2, 0.2, 0.25), 0.9); }

  // --- NIGHT MODE DIMMING ---
  let dim = max(0.2, bez.dimFactor);
  color *= dim;
  let uvFactor = (1.0 - dim) * 1.5;

  // --- PASS 2: EMISSIVE UI ---

  // LCD Displays
  let lcdColorBase = vec3<f32>(0.3, 0.8, 1.0);
  let lcdColor = lcdColorBase + (lcdColorBase * uvFactor);

  let bpmValue = u32(bez.bpm);
  let dBPM = drawNumber(p - vec2<f32>(0.0, displayY), bpmValue, 3u, 0.012, 0.015);
  if (dBPM < 0.0) {
    let mask = smoothstep(aa, 0.0, dBPM);
    color = mix(color, lcdColor, mask);
    color += lcdColor * 0.5 * mask;
  }

  let posY = displayY - 0.04;
  let lcdColorPos = vec3<f32>(1.0, 0.7, 0.2);
  let lcdColorPosBright = lcdColorPos + (lcdColorPos * uvFactor);

  let dOrder = drawNumber(p - vec2<f32>(-0.10, posY), u32(bez.currentOrder), 2u, 0.01, 0.012);
  if (dOrder < 0.0) {
    let mask = smoothstep(aa, 0.0, dOrder);
    color = mix(color, lcdColorPosBright, mask);
    color += lcdColorPosBright * 0.4 * mask;
  }
  let dRow = drawNumber(p - vec2<f32>(0.10, posY), u32(bez.currentRow), 2u, 0.01, 0.012);
  if (dRow < 0.0) {
    let mask = smoothstep(aa, 0.0, dRow);
    color = mix(color, lcdColorPosBright, mask);
    color += lcdColorPosBright * 0.4 * mask;
  }

  // BUTTONS (WHITE SQUARE + PURPLE GLOW)
  let purpleGlow = vec3<f32>(0.7, 0.2, 1.0);
  let btnSize = vec2<f32>(0.09, 0.09);
  let iconRadius = 0.045;

  // LOOP
  let isLooping = bez.isLooping == 1u;
  let isLoopClicked = bez.clickedButton == 1u;
  let loopBtn = drawWhiteButton(p - posLoop, btnSize, purpleGlow, isLooping || isLoopClicked, aa, cornerRadius);
  color = mix(color, loopBtn.rgb, loopBtn.a);
  let dIconOuter = sdCircle(p - posLoop, iconRadius * 0.4);
  let dIconInner = sdCircle(p - posLoop, iconRadius * 0.25);
  let ring = max(dIconOuter, -dIconInner);
  color = mix(color, vec3<f32>(0.1), smoothstep(aa, 0.0, -ring) * 0.6);

  // OPEN
  let isOpenClicked = bez.clickedButton == 2u;
  let openBtn = drawWhiteButton(p - posOpen, btnSize, purpleGlow, isOpenClicked, aa, cornerRadius);
  color = mix(color, openBtn.rgb, openBtn.a);
  let iconOff = p - posOpen;
  let tri = sdTriangle((iconOff - vec2<f32>(0.0, -0.01)) * 1.8, iconRadius * 0.3);
  let stem = sdBox(iconOff - vec2<f32>(0.0, 0.015), vec2<f32>(0.006, 0.015));
  color = mix(color, vec3<f32>(0.1), smoothstep(aa, 0.0, -min(tri, stem)) * 0.6);

  // PLAY
  let isPlaying = bez.isPlaying > 0.5;
  let isPlayClicked = bez.clickedButton == 3u;
  let playBtn = drawWhiteButton(p - posPlay, btnSize, purpleGlow, isPlaying || isPlayClicked, aa, cornerRadius);
  color = mix(color, playBtn.rgb, playBtn.a);
  let dPlayIcon = sdTriangle((p - posPlay) * vec2<f32>(1.0, -1.0) * 1.5, iconRadius * 0.4);
  color = mix(color, vec3<f32>(0.1), smoothstep(aa, 0.0, -dPlayIcon) * 0.6);

  // STOP
  let isStopClicked = bez.clickedButton == 4u;
  let stopBtn = drawWhiteButton(p - posStop, btnSize, purpleGlow, !isPlaying || isStopClicked, aa, cornerRadius);
  color = mix(color, stopBtn.rgb, stopBtn.a);
  let dStopIcon = sdBox(p - posStop, vec2<f32>(iconRadius * 0.35));
  color = mix(color, vec3<f32>(0.1), smoothstep(aa, 0.0, -dStopIcon) * 0.6);

  return vec4<f32>(color, 1.0);
}
