// ============================================================================
// IMPROVED PATTERN SHADER - Note Display & LED System
// ============================================================================
// This shader implements the recommended improvements for note duration
// visualization, expression-only detection, and hardware-authentic LED glow.
// ============================================================================

struct Uniforms {
    resolution: vec2<f32>,
    beatPhase: f32,
    rowHighlight: u32,
    time: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var patternTexture: texture_2d<u32>;

// ============================================================================
// CONSTANTS
// ============================================================================

const NOTE_MIN: u32 = 1u;
const NOTE_MAX: u32 = 96u;
const NOTE_OFF: u32 = 97u;
const NOTE_CUT: u32 = 98u;

const VOL_CMD_SET: u32 = 0xC0u;
const EFF_CMD_DELAY: u32 = 0xEDu;

// LED Colors
const COLOR_BLUE: vec3<f32> = vec3<f32>(0.0, 0.4, 1.0);
const COLOR_AMBER: vec3<f32> = vec3<f32>(1.0, 0.6, 0.0);
const COLOR_OFF: vec3<f32> = vec3<f32>(0.05, 0.05, 0.08);

// ============================================================================
// COLOR UTILITIES
// ============================================================================

// Convert HSV to RGB
fn hsv2rgb(hsv: vec3<f32>) -> vec3<f32> {
    let h = hsv.x * 6.0;
    let s = hsv.y;
    let v = hsv.z;
    
    let c = v * s;
    let x = c * (1.0 - abs(h % 2.0 - 1.0));
    let m = v - c;
    
    var rgb: vec3<f32>;
    if (h < 1.0) { rgb = vec3<f32>(c, x, 0.0); }
    else if (h < 2.0) { rgb = vec3<f32>(x, c, 0.0); }
    else if (h < 3.0) { rgb = vec3<f32>(0.0, c, x); }
    else if (h < 4.0) { rgb = vec3<f32>(0.0, x, c); }
    else if (h < 5.0) { rgb = vec3<f32>(x, 0.0, c); }
    else { rgb = vec3<f32>(c, 0.0, x); }
    
    return rgb + m;
}

// Circle of Fifths color scheme - musically meaningful
fn circleOfFifthsColor(semitone: u32, octave: u32) -> vec3<f32> {
    // Map chromatic scale to circle of fifths position
    // This makes harmonically related notes have similar colors
    let cofPosition = (semitone * 7u) % 12u;
    let hue = f32(cofPosition) / 12.0;
    
    // Octave affects brightness (higher = brighter)
    let brightness = 0.4 + (f32(octave) * 0.12);
    let saturation = 0.85;
    
    return hsv2rgb(vec3<f32>(hue, saturation, brightness));
}

// Hardware-authentic LED glow with bloom and flicker
fn ledGlow(intensity: f32, color: vec3<f32>, time: f32) -> vec3<f32> {
    // Non-linear LED response (LEDs appear brighter at low intensities)
    let ledResponse = pow(intensity, 0.7);
    
    // Bloom effect for high intensities
    let bloom = exp(intensity * 2.0 - 2.0) * 0.4;
    
    // Subtle 60Hz flicker (mains hum simulation)
    let flicker = sin(time * 377.0) * 0.015 * intensity;
    
    // Combine effects
    let totalIntensity = ledResponse + bloom + flicker;
    
    return color * clamp(totalIntensity, 0.0, 2.0);
}

// ============================================================================
// NOTE DATA EXTRACTION
// ============================================================================

struct NoteData {
    note: u32,
    instrument: u32,
    volumeCmd: u32,
    volumeVal: u32,
    effectCmd: u32,
    effectVal: u32,
    duration: u32,      // NEW: Note duration in rows
    flags: u32,         // NEW: Note-off, slide, arp flags
}

fn unpackNoteData(packedA: u32, packedB: u32) -> NoteData {
    var data: NoteData;
    
    // packedA layout: [note:8][inst:8][volCmd:4][volVal:4][duration:8]
    data.note = (packedA >> 24) & 0xFFu;
    data.instrument = (packedA >> 16) & 0xFFu;
    data.volumeCmd = ((packedA >> 12) & 0x0Fu) << 4;  // Expand back to 8-bit
    data.volumeVal = ((packedA >> 8) & 0x0Fu) << 4;   // Expand back to 8-bit
    data.duration = packedA & 0xFFu;
    
    // packedB layout: [effCmd:8][effVal:8][flags:8][reserved:8]
    data.effectCmd = (packedB >> 24) & 0xFFu;
    data.effectVal = (packedB >> 16) & 0xFFu;
    data.flags = (packedB >> 8) & 0xFFu;
    
    return data;
}

// ============================================================================
// NOTE STATE DETECTION
// ============================================================================

struct NoteState {
    hasNote: bool,           // Valid note present (not empty, not note-off)
    isNoteOff: bool,         // Explicit note-off
    hasExpression: bool,     // Volume or effect command present
    expressionOnly: bool,    // Expression without note
    noteWithExpression: bool,// Both note and expression
    isSustaining: bool,      // Note is currently sustaining (within duration)
}

fn analyzeNoteState(data: NoteData, rowOffset: u32) -> NoteState {
    var state: NoteState;
    
    // Note presence (valid range 1-96)
    state.hasNote = (data.note >= NOTE_MIN) && (data.note <= NOTE_MAX);
    
    // Note-off detection (multiple ways to end a note)
    state.isNoteOff = (data.note == NOTE_OFF) || 
                      (data.note == NOTE_CUT) ||
                      (data.volumeCmd == VOL_CMD_SET && data.volumeVal == 0u) ||
                      ((data.flags & 0x01u) != 0u);  // Explicit note-off flag
    
    // Expression detection (exclude empty commands)
    let volCmdValid = (data.volumeCmd > 0u) && 
                      !(data.volumeCmd == VOL_CMD_SET && data.volumeVal == 0u);
    let effCmdValid = (data.effectCmd > 0u) && (data.effectCmd != 0u);
    state.hasExpression = volCmdValid || effCmdValid;
    
    // Combined states
    state.expressionOnly = !state.hasNote && state.hasExpression;
    state.noteWithExpression = state.hasNote && state.hasExpression;
    
    // Duration check - is this row within the note's sustain period?
    state.isSustaining = state.hasNote && 
                         (data.duration > 0u) && 
                         (rowOffset < data.duration);
    
    return state;
}

// ============================================================================
// THREE-EMITTER LED SYSTEM
// ============================================================================

struct LedOutput {
    top: vec3<f32>,      // Blue - Trigger / Playhead
    middle: vec3<f32>,   // Note color - Pitch / Sustain
    bottom: vec3<f32>,   // Amber - Expression
}

fn calculateLeds(
    data: NoteData, 
    state: NoteState, 
    isPlayhead: bool,
    timeSinceTrigger: f32,
    rowOffset: u32
) -> LedOutput {
    var leds: LedOutput;
    
    // Calculate pitch color using Circle of Fifths
    var noteColor = COLOR_OFF;
    if (state.hasNote || state.isNoteOff) {
        let semitone = (data.note - 1u) % 12u;
        let octave = (data.note - 1u) / 12u;
        noteColor = circleOfFifthsColor(semitone, octave);
    }
    
    // TOP EMITTER (Blue) - Trigger indicator with sustain
    // Glows for: note trigger, note sustain period, playhead position
    var blueIntensity = 0.0;
    
    if (isPlayhead) {
        // Playhead is always bright
        blueIntensity = 1.0;
    } else if (state.hasNote) {
        if (timeSinceTrigger < 0.1) {
            // Initial trigger flash (100ms)
            blueIntensity = 1.0 - (timeSinceTrigger * 10.0);
        } else if (state.isSustaining) {
            // Sustained note - dim blue glow
            let sustainProgress = f32(rowOffset) / f32(max(data.duration, 1u));
            blueIntensity = 0.4 - (sustainProgress * 0.2);  // Fade from 0.4 to 0.2
        }
    } else if (state.isNoteOff) {
        // Note-off: slow pulse
        blueIntensity = 0.2 + 0.1 * sin(uniforms.time * 3.0);
    }
    
    leds.top = ledGlow(blueIntensity, COLOR_BLUE, uniforms.time);
    
    // MIDDLE EMITTER (Note Color) - Pitch indication
    // Steady glow for notes, dim for note-off, off for empty
    var middleIntensity = 0.0;
    
    if (state.hasNote) {
        if (state.isSustaining) {
            // Full brightness during sustain
            middleIntensity = 0.8;
        } else {
            // Short note - brief glow
            middleIntensity = max(0.0, 0.8 - timeSinceTrigger * 2.0);
        }
    } else if (state.isNoteOff) {
        // Note-off: dimmed color
        middleIntensity = 0.25;
    } else if (state.expressionOnly) {
        // Expression-only: very dim amber tint
        middleIntensity = 0.1;
        noteColor = COLOR_AMBER * 0.3;
    }
    
    leds.middle = ledGlow(middleIntensity, noteColor, uniforms.time);
    
    // BOTTOM EMITTER (Amber) - Expression indicator
    // Glows for: volume commands, effects, expression-only steps
    var amberIntensity = 0.0;
    
    if (state.expressionOnly) {
        // Expression-only: primary indicator (bright amber)
        amberIntensity = 0.9;
    } else if (state.noteWithExpression) {
        // Note with expression: secondary indicator
        amberIntensity = 0.5;
    }
    
    // Subtle pulse for active expression
    if (state.hasExpression) {
        amberIntensity *= 0.8 + 0.2 * sin(uniforms.time * 4.0);
    }
    
    leds.bottom = ledGlow(amberIntensity, COLOR_AMBER, uniforms.time);
    
    return leds;
}

// ============================================================================
// MAIN FRAGMENT SHADER
// ============================================================================

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    // Calculate grid position
    let gridSize = vec2<f32>(32.0, 64.0);  // channels x rows
    let cellUv = uv * gridSize;
    let cellX = u32(cellUv.x);
    let cellY = u32(cellUv.y);
    let cellFrac = fract(cellUv);
    
    // Read packed note data from texture
    let texCoord = vec2<i32>(i32(cellX), i32(cellY));
    let packedA = textureLoad(patternTexture, texCoord, 0).r;
    let packedB = textureLoad(patternTexture, texCoord, 0).g;
    
    // Unpack and analyze
    let data = unpackNoteData(packedA, packedB);
    let state = analyzeNoteState(data, 0u);
    
    // Determine if this is the playhead row
    let isPlayhead = (cellY == uniforms.rowHighlight);
    
    // Calculate time since note trigger (would come from uniform buffer)
    let timeSinceTrigger = select(0.5, 0.0, isPlayhead);
    
    // Calculate LED outputs
    let leds = calculateLeds(data, state, isPlayhead, timeSinceTrigger, 0u);
    
    // Combine emitters vertically
    var finalColor: vec3<f32>;
    if (cellFrac.y < 0.33) {
        // Bottom third: Amber expression LED
        finalColor = leds.bottom;
    } else if (cellFrac.y < 0.67) {
        // Middle third: Note color LED
        finalColor = leds.middle;
    } else {
        // Top third: Blue trigger LED
        finalColor = leds.top;
    }
    
    // Add subtle grid lines
    let gridLine = step(0.95, cellFrac.x) * 0.1 + step(0.95, cellFrac.y) * 0.1;
    finalColor += vec3<f32>(gridLine);
    
    // Highlight current row
    if (isPlayhead) {
        finalColor *= 1.2;
    }
    
    return vec4<f32>(finalColor, 1.0);
}

// ============================================================================
// VERTEX SHADER
// ============================================================================

@vertex
fn vertexMain(@location(0) position: vec2<f32>) -> @builtin(position) vec4<f32> {
    return vec4<f32>(position, 0.0, 1.0);
}
