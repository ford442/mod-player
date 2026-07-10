//#include "lib/sdf.wgsl"
//#include "lib/tonemap.wgsl"
//#include "lib/top_emitter.wgsl"
struct FragmentConstants {
  bgColor: vec3<f32>,
  ledOnColor: vec3<f32>,
  ledOffColor: vec3<f32>,
  borderColor: vec3<f32>,
  housingSize: vec2<f32>,
};

fn getFragmentConstants() -> FragmentConstants {
  var c: FragmentConstants;
  c.bgColor = THEME_BG;
  c.ledOnColor = THEME_LED_ON;
  c.ledOffColor = THEME_LED_OFF;
  c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
  c.housingSize = vec2<f32>(0.92, 0.92);
  return c;
}

fn drawEmitterDiode(uv: vec2<f32>, intensity: f32, color: vec3<f32>, isOn: bool) -> vec4<f32> {
    let diodeSize = vec2<f32>(0.28, 0.14);
    let p = uv;
    let dDiode = sdRoundedBox(p, diodeSize * 0.5, 0.06);
    let dieSize = vec2<f32>(0.10, 0.05);
    let dDie = sdRoundedBox(p, dieSize * 0.5, 0.02);
    let diodeMask = 1.0 - smoothstep(0.0, 0.015, dDiode);
    let dieMask = 1.0 - smoothstep(0.0, 0.008, dDie);
    var diodeColor = THEME_LED_OFF;
    if (isOn) {
        let dieGlow = color * (1.0 + intensity * 4.0);
        let housingGlow = color * 0.12 * intensity;
        diodeColor = mix(housingGlow, dieGlow, dieMask);
        let hotspot = exp(-length(p / vec2<f32>(0.06, 0.03)) * 2.5) * intensity;
        diodeColor += color * hotspot * 0.6;
    }
    return vec4<f32>(diodeColor, diodeMask);
}

fn drawUnifiedLensCap(
    uv: vec2<f32>,
    lensSize: vec2<f32>,
    topEmitter: vec4<f32>,
    midEmitter: vec4<f32>,
    botEmitter: vec4<f32>,
    aa: f32
) -> vec4<f32> {
    let p = uv;
    let dBox = sdRoundedBox(p, lensSize * 0.5, 0.12);
    if (dBox > 0.0) { return vec4<f32>(0.0); }

    let topPos = vec2<f32>(0.0, -0.28);
    let midPos = vec2<f32>(0.0, 0.0);
    let botPos = vec2<f32>(0.0, 0.28);

    let radial = length(p / (lensSize * 0.5));
    let edgeThickness = 0.18 + radial * 0.12;
    let centerThickness = 0.06;
    let thickness = mix(centerThickness, edgeThickness, radial * radial);

    let n = normalize(vec3<f32>(p.x * 2.5 / lensSize.x, p.y * 2.5 / lensSize.y, 0.35));
    let viewDir = vec3<f32>(0.0, 0.0, 1.0);
    let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.5);

    let topDiode = drawEmitterDiode(uv - topPos, topEmitter.a, topEmitter.rgb, topEmitter.a > 0.05);
    let midDiode = drawEmitterDiode(uv - midPos, midEmitter.a, midEmitter.rgb, midEmitter.a > 0.05);
    let botDiode = drawEmitterDiode(uv - botPos, botEmitter.a, botEmitter.rgb, botEmitter.a > 0.05);

    var combinedDiode = THEME_LED_OFF;
    if (botDiode.a > 0.0) { combinedDiode = mix(combinedDiode, botDiode.rgb, botDiode.a); }
    if (midDiode.a > 0.0) { combinedDiode = mix(combinedDiode, midDiode.rgb, midDiode.a); }
    if (topDiode.a > 0.0) { combinedDiode = mix(combinedDiode, topDiode.rgb, topDiode.a); }
    let diodeMask = max(max(topDiode.a, midDiode.a), botDiode.a);

    let refractionStrength = (1.0 - radial * 0.6) * 0.04;
    let refractOffset = p * refractionStrength;

    var subsurfaceGlow = vec3<f32>(0.0);
    let distTop = length(uv - topPos - refractOffset * 0.3);
    let scatterTop = exp(-distTop * 9.0) * topEmitter.a;
    subsurfaceGlow += topEmitter.rgb * scatterTop * 2.2;
    let distMid = length(uv - midPos - refractOffset * 0.5);
    let scatterMid = exp(-distMid * 7.5) * midEmitter.a;
    subsurfaceGlow += midEmitter.rgb * scatterMid * 3.0;
    let distBot = length(uv - botPos - refractOffset * 0.3);
    let scatterBot = exp(-distBot * 9.0) * botEmitter.a;
    subsurfaceGlow += botEmitter.rgb * scatterBot * 2.2;

    subsurfaceGlow += topEmitter.rgb * exp(-distTop * 6.0) * topEmitter.a * 0.15;
    subsurfaceGlow += midEmitter.rgb * exp(-distMid * 6.0) * midEmitter.a * 0.15;
    subsurfaceGlow += botEmitter.rgb * exp(-distBot * 6.0) * botEmitter.a * 0.15;

    var activeColor = midEmitter.rgb * midEmitter.a;
    activeColor = mix(activeColor, topEmitter.rgb, topEmitter.a * 0.5);
    activeColor = mix(activeColor, botEmitter.rgb, botEmitter.a * 0.5);

    let totalGlow = topEmitter.a + midEmitter.a + botEmitter.a;
    let colorPreserveFactor = min(totalGlow * COLOR_PRESERVE_SCALE, COLOR_PRESERVE_MAX);
    let litTint = mix(THEME_LIT_TINT, activeColor, colorPreserveFactor);
    let glassBaseColor = mix(THEME_BG * 0.12, litTint, 0.88);

    let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);
    let diodeVisibility = diodeMask * 0.55;
    let baseAlpha = 0.72 + 0.28 * fresnel;
    let alpha = mix(baseAlpha, 0.32, diodeVisibility) * edgeAlpha;

    let lightDir = vec3<f32>(0.4, -0.7, 0.6);
    let diff = max(0.0, dot(n, normalize(lightDir)));
    let spec = pow(max(0.0, dot(reflect(-normalize(lightDir), n), viewDir)), 40.0);
    let litGlassColor = glassBaseColor * (0.45 + 0.55 * diff) + vec3<f32>(spec * 0.25);

    var finalColor = THEME_BG;
    let diodeBlend = diodeMask * (1.0 - alpha * 0.65);
    finalColor = mix(finalColor, combinedDiode, diodeBlend);
    finalColor = mix(finalColor, litGlassColor, alpha);
    finalColor += subsurfaceGlow * 1.8;

    if (midEmitter.a > 0.05) {
        let midGlowDist = length(uv - midPos - refractOffset * 0.5);
        let midGlow = (1.0 - smoothstep(0.0, 0.18, midGlowDist)) * midEmitter.a * 0.5;
        finalColor += midEmitter.rgb * midGlow;
    }
    if (topEmitter.a > 0.05) {
        let topGlowDist = length(uv - topPos - refractOffset * 0.3);
        let topGlow = (1.0 - smoothstep(0.0, 0.14, topGlowDist)) * topEmitter.a * 0.3;
        finalColor += topEmitter.rgb * topGlow;
    }
    if (botEmitter.a > 0.05) {
        let botGlowDist = length(uv - botPos - refractOffset * 0.3);
        let botGlow = (1.0 - smoothstep(0.0, 0.14, botGlowDist)) * botEmitter.a * 0.3;
        finalColor += botEmitter.rgb * botGlow;
    }

    finalColor += fresnel * THEME_RIM * 0.18 * (1.0 + radial * 0.5);

    let sepShadowTop = (1.0 - smoothstep(0.0, 0.015, abs(p.y - (-0.14)))) * 0.35;
    let sepShadowBot = (1.0 - smoothstep(0.0, 0.015, abs(p.y - 0.14))) * 0.35;
    finalColor -= finalColor * (sepShadowTop + sepShadowBot);

    let vignette = 1.0 - radial * radial * 0.25;
    finalColor *= vignette;

    return vec4<f32>(acesToneMap(finalColor), edgeAlpha);
}
