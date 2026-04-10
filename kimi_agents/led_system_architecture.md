# LED System Architecture Documentation

## Three-Emitter LED Design

```
┌─────────────────────────────────────┐
│         UNIFIED LENS CAP            │
│    ┌─────────────────────────┐      │
│    │    ╭─────────────╮      │      │
│    │   ╱   EMITTER 1   ╲     │      │  ← Blue Note-On Indicator
│    │  │    ●───────●    │    │      │    (Top position)
│    │  │   ╱  BLUE   ╲   │    │      │
│    │  ╰──┤  TRIGGER  ├──╯    │      │
│    │     │  PLAYHEAD │       │      │
│    ├─────┴───────────┴───────┤      │
│    │    ╭─────────────╮      │      │
│    │   ╱   EMITTER 2   ╲     │      │  ← Steady Note Color
│    │  │    ●───────●    │    │      │    (Middle position)
│    │  │   ╱   NOTE    ╲  │    │      │
│    │  ╰──┤    COLOR    ├──╯    │      │
│    │     │   (steady)  │       │      │
│    ├─────┴───────────┴───────┤      │
│    │    ╭─────────────╮      │      │
│    │   ╱   EMITTER 3   ╲     │      │  ← Amber Control Indicator
│    │  │    ●───────●    │    │      │    (Bottom position)
│    │  │   ╱   AMBER   ╲  │    │      │
│    │  ╰──┤   EFFECT    ├──╯    │      │
│    │     │   VOLUME    │       │      │
│    ╰─────┴───────────┴───────╯      │
│                                     │
│  [Plastic Housing - Dark Gray]      │
└─────────────────────────────────────┘
```

---

## Emitter Specifications

### Emitter 1: Blue Note-On Indicator

| Property | Value | Notes |
|----------|-------|-------|
| Color | #0066FF | Saturated blue |
| Position | Top 30% | Within lens cap |
| Trigger | Note trigger | Immediate response |
| Playhead | 60% intensity | When playhead active |
| Muted | Off | No light when muted |
| Base Glow | 2% | LED leakage simulation |

**Behavior:**
- Lights up immediately when note is triggered
- Fades quickly (attack: 10ms, decay: 100ms)
- Blue indicates "activity/event"

### Emitter 2: Steady Note Color

| Property | Value | Notes |
|----------|-------|-------|
| Color | Pitch-mapped | See color table below |
| Position | Center | Middle of lens cap |
| Steady State | Always on when note present | No blinking |
| Intensity | 55% base | + bloom when active |
| Muted | 8% dim | Still visible |
| Base Glow | 8% | Always visible |

**Color Mapping:**
| Note | Color | Hex | Octave Effect |
|------|-------|-----|---------------|
| C | Red | #FF0D0D | +3% per octave |
| C# | Orange-Red | #FF5900 | Enhanced saturation |
| D | Yellow | #FFD900 | +3% per octave |
| D# | Lime | #99F200 | Enhanced saturation |
| E | Green | #0DE60D | +3% per octave |
| F | Teal | #00D980 | +3% per octave |
| F# | Cyan | #00CCF2 | Enhanced saturation |
| G | Sky Blue | #0D80FF | +3% per octave |
| G# | Blue | #2633FF | Enhanced saturation |
| A | Purple | #8C00F2 | +3% per octave |
| A# | Magenta | #F200BF | Enhanced saturation |
| B | Pink | #FF0D66 | +3% per octave |

### Emitter 3: Amber Control Indicator

| Property | Value | Notes |
|----------|-------|-------|
| Color | #FF9900 | Orange-amber |
| Position | Bottom 30% | Within lens cap |
| Trigger | Effect command | Volume, pan, etc. |
| Volume Change | 80% intensity | Any volume != 64 |
| Muted | Off | No light when muted |
| Base Glow | 2% | LED leakage simulation |

**Behavior:**
- Lights up when effect command present
- Volume changes (not 64) trigger indicator
- Subtle flash on effect change

---

## Lens Cap Physics Simulation

### Light Path Diagram

```
        Light Source (Environment)
                 ↓
    ╔══════════════════════════════════╗
    ║  ╭────────────────────────────╮  ║
    ║  │    ╭────────────────╮      │  ║ ← Fresnel reflection
    ║  │   ╱    SPECULAR      ╲     │  ║   (surface reflection)
    ║  │  │      HIGHLIGHT      │    │  ║
    ║  │ ╱                        ╲ │  ║
    ║  ││      ╭──────────╮        ││  ║
    ║  ││     ╱  EMITTER   ╲       ││  ║ ← Internal diffusion
    ║  ││    │      ●       │      ││  ║   (Gaussian falloff)
    ║  ││     ╲   GLOW    ╱       ││  ║
    ║  ││      ╰──────────╯        ││  ║
    ║  │ ╲                        ╱ │  ║
    ║  │  │    ╭──────────╮      │  │  ║
    ║  │   ╲   │ EMITTER  │     ╱   │  ║
    ║  │    ╲  │    ●     │    ╱    │  ║
    ║  │     ╲ │   GLOW   │   ╱     │  ║
    ║  │      ╰──────────╯  ╱      │  ║
    ║  ╰────────────────────────────╯  ║
    ╚══════════════════════════════════╝
                    ↓
         Observer (Camera)
```

### Simulated Effects

1. **Internal Diffusion** (Gaussian)
   - Light spreads within encapsulant
   - Falloff: `exp(-dist² × 12.0)`
   - Creates soft glow around emitters

2. **Fresnel Reflection**
   - Surface reflection increases at grazing angles
   - Formula: `(1 - viewAngle)^2.5 × 0.25`
   - Adds realism to lens surface

3. **Specular Highlight**
   - Simulated light source reflection
   - Position: upper-right of lens
   - Intensity: 40% at peak

4. **Cross-Emitter Bleeding**
   - Subsurface scattering between emitters
   - Amount: 15% of total intensity
   - Creates unified appearance

5. **Edge Darkening**
   - Vignette effect at lens perimeter
   - Simulates light trapping in thick plastic
   - Range: 70-100% of center brightness

---

## Shader Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         INPUT STAGE                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Uniforms  │  │   Channel   │  │    Row      │             │
│  │   (grid,    │  │   States    │  │    Flags    │             │
│  │   timing)   │  │  (packed)   │  │ (playhead)  │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         └─────────────────┴─────────────────┘                   │
│                           │                                     │
│                           ▼                                     │
├─────────────────────────────────────────────────────────────────┤
│                      UNPACK STAGE                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Bit unpacking: trigger | note | octave | vol | effect  │   │
│  │  State derivation: hasNote, isMuted, hasExpression      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
├─────────────────────────────────────────────────────────────────┤
│                    EMITTER CALCULATION                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  EMITTER 1   │  │  EMITTER 2   │  │  EMITTER 3   │          │
│  │   (Blue)     │  │  (Note Color)│  │   (Amber)    │          │
│  │              │  │              │  │              │          │
│  │ Calculate    │  │ Pitch→Color  │  │ Effect check │          │
│  │ intensity    │  │ mapping      │  │ volume check │          │
│  │ based on     │  │ Octave       │  │ Calculate    │          │
│  │ trigger/     │  │ brightness   │  │ intensity    │          │
│  │ playhead     │  │              │  │              │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         └─────────────────┴─────────────────┘                   │
│                           │                                     │
│                           ▼                                     │
├─────────────────────────────────────────────────────────────────┤
│                    LENS SIMULATION                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  1. SDF lens shape evaluation                           │   │
│  │  2. Internal diffusion (per-emitter Gaussian)          │   │
│  │  3. Cross-emitter color bleeding                        │   │
│  │  4. Fresnel surface reflection                          │   │
│  │  5. Specular highlight calculation                      │   │
│  │  6. Edge darkening application                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
├─────────────────────────────────────────────────────────────────┤
│                    POST-PROCESSING                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Contrast  │  │    Tone     │  │   Dither    │             │
│  │    Boost    │  │   Mapping   │  │   (8x8)     │             │
│  │  (gamma)    │  │  (ACES)     │  │  (Bayer)    │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         └─────────────────┴─────────────────┘                   │
│                           │                                     │
│                           ▼                                     │
├─────────────────────────────────────────────────────────────────┤
│                       OUTPUT                                    │
├─────────────────────────────────────────────────────────────────┤
│              vec4<f32>(RGB, 1.0) → Framebuffer                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Performance Considerations

### Per-Fragment Operation Count

| Stage | Operations | Notes |
|-------|------------|-------|
| Unpack | 6 bit ops | Very fast |
| Emitter 1 | ~15 ALU | Branch on muted |
| Emitter 2 | ~25 ALU | Pitch lookup |
| Emitter 3 | ~10 ALU | Simple check |
| Lens SDF | ~20 ALU | 3 emitters × ~7 |
| Post-process | ~20 ALU | Tone map + dither |
| **Total** | **~100 ALU** | Per fragment |

### Optimization Opportunities

1. **Early Exit**
   ```wgsl
   if (isMuted && !isPlayhead) {
       return vec4(housingColor, 1.0);
   }
   ```

2. **LOD System**
   - Far cells: Skip lens simulation, use simple circles
   - Near cells: Full simulation

3. **Temporal Reuse**
   - Cache emitter intensities between frames
   - Only recalculate when state changes

---

## Configuration Parameters

### Runtime Tunables

| Parameter | Range | Default | Effect |
|-----------|-------|---------|--------|
| `bloomIntensity` | 0.0 - 2.0 | 0.5 | Glow amount |
| `ledAge` | 0.0 - 1.0 | 0.0 | Aging simulation |
| `contrastBoost` | 0.5 - 2.0 | 1.1 | Contrast adjustment |
| `diffusionScale` | 0.5 - 2.0 | 1.0 | Internal glow spread |
| `fresnelStrength` | 0.0 - 1.0 | 0.25 | Surface reflection |

### Preset Configurations

#### "Vintage 1980s"
```
ledAge: 0.7
contrastBoost: 1.3
bloomIntensity: 0.3
```

#### "Modern Clear"
```
ledAge: 0.0
contrastBoost: 1.0
bloomIntensity: 0.8
```

#### "Subtle Professional"
```
ledAge: 0.2
contrastBoost: 0.9
bloomIntensity: 0.4
```

---

## Hardware Reference

### Real-World LED Specifications

| Property | Typical Value | Simulated |
|----------|---------------|-----------|
| Lens diameter | 3-5mm | Normalized 1.0 |
| Viewing angle | 30-60° | 45° |
| Forward voltage | 2.0-3.3V | N/A |
| Luminous intensity | 100-1000mcd | Normalized |
| Response time | ~100ns | Instant |
| Lifetime | 50,000-100,000 hrs | `ledAge` param |

### Similar Products

- **LEDtronics SML-010**: 3mm, diffused lens
- **Kingbright L-934**: 3mm, tinted diffused
- **VCC (Visual Communications Company)**: 3mm, high brightness
