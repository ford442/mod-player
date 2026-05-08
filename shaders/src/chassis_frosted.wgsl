// ============================================================
// chassis_frosted.wgsl — Source file
// White "Polar" Hardware Chassis
//
// Assembled via build-shaders.mjs from:
//   #include "chassis_base.wgsl"
//
// Fixes from original:
//   • isLooping / clickedButton now correctly typed as u32
//     (matching the JS uint32 buffer writes)
//   • currentRow correctly typed as f32
//     (matching the JS float buffer writes)
// ============================================================

#include "chassis_base.wgsl"

// --- Frosted Materials ---

fn getChassisMaterial(uv: vec2<f32>) -> vec3<f32> {
  let baseCol = vec3<f32>(0.94, 0.95, 0.96);
  let grain = noise(uv * 1500.0) * 0.03;
  let sheen = noise(uv * 4.0) * 0.02;
  return baseCol - vec3<f32>(grain + sheen);
}

fn drawFrostedButton(
    p: vec2<f32>, size: vec2<f32>, ledColor: vec3<f32>, isOn: bool, aa: f32
) -> vec4<f32> {
  let halfSize = size * 0.5;
  let cornerRadius = 0.015;
  let d = sdRoundedBox(p, halfSize, cornerRadius);
  let alpha = 1.0 - smoothstep(0.0, aa, d);
  if (alpha <= 0.0) { return vec4<f32>(0.0); }

  var col = vec3<f32>(0.88, 0.90, 0.95);
  let frostGrain = hash2(p * 600.0) * 0.05;
  col -= vec3<f32>(frostGrain);

  let bevelW = 0.012;
  let height = smoothstep(0.0, bevelW, -d);
  let rim = smoothstep(bevelW * 0.5, 0.0, -d) * 0.7;
  col += vec3<f32>(rim);

  if (isOn) {
    let coreGlow = exp(-length(p) * 6.0) * 1.5;
    let volume = smoothstep(0.0, 1.0, height);
    col = mix(col, ledColor, 0.5 * volume);
    col += ledColor * coreGlow * 0.8;
  } else {
    col *= 0.8;
    col -= vec3<f32>(0.1) * (1.0 - height);
  }
  return vec4<f32>(col, alpha);
}

// --- Fragment Shader (Frosted Layout) ---

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let p = uv - 0.5;
  let aa = 1.5 / bez.canvasH;
  var color = getChassisMaterial(uv);

  // Display recess
  let recessBox = sdRoundedBox(p - vec2<f32>(0.0, 0.40), vec2<f32>(0.36, 0.12), 0.02);
  let recessMask = smoothstep(aa, -aa, recessBox);
  let shadow = smoothstep(0.06, 0.0, recessBox);
  color = mix(color, vec3<f32>(0.12, 0.13, 0.15), recessMask);
  color *= 1.0 - (shadow * 0.35 * (1.0 - recessMask));

  // Volume slider
  let volPos = vec2<f32>(0.08, 0.415);
  let volDim = vec2<f32>(0.09, 0.006);
  if (sdRoundedBox(p - volPos, volDim, 0.003) < 0.0) { color = vec3<f32>(0.2, 0.2, 0.2); }
  let volNorm = clamp(bez.volume, 0.0, 1.0);
  let volHandleX = volPos.x + (volNorm - 0.5) * (volDim.x * 2.0 * 0.9);
  let dVolHandle = sdCircle(p - vec2<f32>(volHandleX, volPos.y), 0.02);
  if (dVolHandle < 0.0) { color = mix(color, vec3<f32>(0.3, 0.9, 0.5), smoothstep(aa, -aa, dVolHandle)); }

  // Pan slider
  let sliderRightX = 0.42;
  let sliderY = -0.2;
  if (sdRoundedBox(p - vec2<f32>(sliderRightX, sliderY), vec2<f32>(0.008, 0.1), 0.003) < 0.0) { color = vec3<f32>(0.2, 0.2, 0.2); }
  let panNorm = clamp(bez.pan, -1.0, 1.0);
  let panHandleY = sliderY + panNorm * 0.09;
  let dPanHandle = sdCircle(p - vec2<f32>(sliderRightX, panHandleY), 0.02);
  if (dPanHandle < 0.0) { color = mix(color, vec3<f32>(0.4, 0.6, 1.0), smoothstep(aa, -aa, dPanHandle)); }

  // LCD Displays
  let displayY = 0.45;
  let lcdColor = vec3<f32>(0.4, 0.9, 1.0);
  let dBPM = drawNumber(p - vec2<f32>(0.0, displayY), u32(bez.bpm), 3u, 0.012, 0.015);
  if (dBPM < 0.0) { color = mix(color, lcdColor, smoothstep(aa, 0.0, dBPM)); }

  let posY = displayY - 0.04;
  let lcdAmber = vec3<f32>(1.0, 0.7, 0.2);
  let dRow = drawNumber(p - vec2<f32>(0.10, posY), u32(bez.currentRow), 2u, 0.01, 0.012);
  if (dRow < 0.0) { color = mix(color, lcdAmber, smoothstep(aa, 0.0, dRow)); }
  let dOrd = drawNumber(p - vec2<f32>(-0.10, posY), u32(bez.currentOrder), 2u, 0.01, 0.012);
  if (dOrd < 0.0) { color = mix(color, lcdAmber, smoothstep(aa, 0.0, dOrd)); }

  // Buttons
  let btnSize = vec2<f32>(0.09, 0.09);
  let smBtnSize = vec2<f32>(0.07, 0.06);
  let iconCol = vec3<f32>(0.15, 0.15, 0.15);
  let ledPurple = vec3<f32>(0.8, 0.4, 1.0);
  let ledAmber = vec3<f32>(1.0, 0.6, 0.1);
  let ledGreen = vec3<f32>(0.2, 1.0, 0.4);
  let ledRed = vec3<f32>(1.0, 0.2, 0.3);
  let ledBlue = vec3<f32>(0.3, 0.6, 1.0);

  // LOOP
  let pLoop = p - vec2<f32>(-0.26, 0.42);
  let loopOn = (bez.isLooping == 1u) || (bez.clickedButton == 1u);
  let btnLoop = drawFrostedButton(pLoop, btnSize, ledPurple, loopOn, aa);
  color = mix(color, btnLoop.rgb, btnLoop.a);
  let dIconLoop = abs(length(pLoop) - 0.018) - 0.004;
  color = mix(color, iconCol, smoothstep(aa, 0.0, -dIconLoop) * btnLoop.a);

  // OPEN
  let pOpen = p - vec2<f32>(0.26, 0.42);
  let openOn = (bez.clickedButton == 2u);
  let btnOpen = drawFrostedButton(pOpen, btnSize, ledAmber, openOn, aa);
  color = mix(color, btnOpen.rgb, btnOpen.a);
  let folderBody = sdBox(pOpen - vec2<f32>(0.0, -0.005), vec2<f32>(0.02, 0.014));
  let folderTab = sdBox(pOpen - vec2<f32>(-0.01, 0.015), vec2<f32>(0.008, 0.004));
  color = mix(color, iconCol, smoothstep(aa, 0.0, -min(folderBody, folderTab)) * btnOpen.a);

  // PREV
  let pPrev = p - vec2<f32>(-0.12, 0.32);
  let prevOn = (bez.clickedButton == 5u);
  let btnPrev = drawFrostedButton(pPrev, smBtnSize, ledBlue, prevOn, aa);
  color = mix(color, btnPrev.rgb, btnPrev.a);
  color = mix(color, iconCol, smoothstep(aa, 0.0, -sdTriangle((pPrev) * vec2<f32>(-1.0, 1.0) * 3.5, 0.01)) * btnPrev.a);

  // NEXT
  let pNext = p - vec2<f32>(0.12, 0.32);
  let nextOn = (bez.clickedButton == 6u);
  let btnNext = drawFrostedButton(pNext, smBtnSize, ledBlue, nextOn, aa);
  color = mix(color, btnNext.rgb, btnNext.a);
  color = mix(color, iconCol, smoothstep(aa, 0.0, -sdTriangle((pNext) * vec2<f32>(1.0, 1.0) * 3.5, 0.01)) * btnNext.a);

  // PLAY
  let pPlay = p - vec2<f32>(-0.44, -0.45);
  let playOn = (bez.isPlaying > 0.5) || (bez.clickedButton == 3u);
  let btnPlay = drawFrostedButton(pPlay, btnSize, ledGreen, playOn, aa);
  color = mix(color, btnPlay.rgb, btnPlay.a);
  color = mix(color, iconCol, smoothstep(aa, 0.0, -sdTriangle((pPlay) * vec2<f32>(1.0, -1.0) * 1.5, 0.02)) * btnPlay.a);

  // STOP
  let pStop = p - vec2<f32>(-0.34, -0.45);
  let stopOn = (bez.isPlaying < 0.5) || (bez.clickedButton == 4u);
  let btnStop = drawFrostedButton(pStop, btnSize, ledRed, stopOn, aa);
  color = mix(color, btnStop.rgb, btnStop.a);
  color = mix(color, iconCol, smoothstep(aa, 0.0, -sdBox(pStop, vec2<f32>(0.015, 0.015))) * btnStop.a);

  return vec4<f32>(color, 1.0);
}
