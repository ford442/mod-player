# Visual Comparison: Current vs Improved LED System

## LED State Comparison Matrix

### Current System

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ROW │ CELL DATA          │ TOP(Blue) │ MIDDLE      │ BOTTOM(Amber)         │
├─────────────────────────────────────────────────────────────────────────────┤
│  0  │ C-4                │    ON     │ Green       │ OFF                   │
│  1  │ C-4 + Vol          │    ON     │ Green       │ ON  ← Ambiguous!      │
│  2  │ Vol only           │   OFF     │ OFF         │ ON  ← Correct         │
│  3  │ Effect only        │   OFF     │ OFF         │ ON  ← Correct         │
│  4  │ Empty              │   OFF     │ OFF         │ OFF                   │
│  5  │ Note-off           │   OFF     │ OFF         │ OFF ← INVISIBLE!      │
│  6  │ C-4 (long note)    │    ON     │ Green       │ OFF ← No duration!    │
│  7  │ (same note)        │   OFF     │ OFF         │ OFF ← Still playing!  │
│  8  │ (same note)        │   OFF     │ OFF         │ OFF ← Still playing!  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Improved System

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ROW │ CELL DATA          │ TOP(Blue) │ MIDDLE      │ BOTTOM(Amber)         │
├─────────────────────────────────────────────────────────────────────────────┤
│  0  │ C-4 (dur=4)        │   FLASH   │ Green       │ OFF                   │
│  1  │ (sustaining)       │    DIM    │ Green       │ OFF                   │
│  2  │ (sustaining)       │    DIM    │ Green       │ OFF                   │
│  3  │ (sustaining)       │    DIM    │ Green       │ OFF                   │
│  4  │ C-4 + Vol          │   FLASH   │ Green       │ DIM  ← Note primary   │
│  5  │ Vol only           │   OFF     │ Dim Amber   │ BRIGHT ← Expression!  │
│  6  │ Effect only        │   OFF     │ Dim Amber   │ BRIGHT ← Expression!  │
│  7  │ Empty              │   OFF     │ OFF         │ OFF                   │
│  8  │ Note-off           │  PULSE    │ Dim Green   │ OFF  ← Visible!       │
└─────────────────────────────────────────────────────────────────────────────┘
```

## LED Intensity Patterns

### Blue LED (Top) - Trigger & Sustain Indicator

```
Current:  ████░░░░░░░░░░░░░░░░  (4-row flash, then off)
Improved: ████▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  (4-row flash, sustained dim)
          │  │└─ sustained glow
          │  └── initial flash
          └───── trigger point

Note-off: ░░░░░░░░░░░░░░░░░░░░  (current - invisible)
          ░░▒░▒░▒░▒░▒░▒░▒░▒░░  (improved - pulsing)
```

### Middle LED - Note Color

```
Current:  All notes same brightness, no octave info
Improved: Brightness = f(octave), Color = Circle of Fifths

Octave 2: ▓▓▓▓ (dim)
Octave 3: ▓▓▓▓▓ (medium)
Octave 4: ▓▓▓▓▓▓ (bright) ← middle C
Octave 5: ▓▓▓▓▓▓▓ (brighter)
Octave 6: ▓▓▓▓▓▓▓▓ (brightest)
```

### Amber LED (Bottom) - Expression Indicator

```
Current:  ON for ANY expression (ambiguous)
Improved: BRIGHT for expression-only, DIM for note+expression

Expression-only:  ████████████ (bright amber)
Note+Expression:  ▓▓▓▓▓▓▓▓▓▓▓▓ (dim amber)
No expression:    ░░░░░░░░░░░░ (off)
```

## Hardware Sequencer Comparison

### Elektron Digitakt Style

```
┌────────────────────────────────────────────────────────────┐
│  [1] [2] [3] [4] [5] [6] [7] [8] [9] [10][11][12][13][14] │
│   Y   Y   -   Y   Y   -   Y   -   Y   Y   -   Y   Y   Y   │
│                                                           │
│ Y = Yellow (trigger)                                      │
│ - = Off (no trigger)                                      │
│ Brightness = Velocity                                     │
└────────────────────────────────────────────────────────────┘
```

### Novation Circuit Style (Improved System)

```
┌────────────────────────────────────────────────────────────┐
│  [1] [2] [3] [4] [5] [6] [7] [8] [9] [10][11][12][13][14] │
│  [G] [G] [g] [G] [G] [A] [G] [A] [G] [G] [o] [G] [P] [P] │
│                                                           │
│ G/g = Green (note, uppercase = sustaining)                │
│ A   = Amber (expression-only)                             │
│ o   = Off (empty)                                         │
│ P   = Pulsing (note-off)                                  │
└────────────────────────────────────────────────────────────┘
```

### Proposed Three-Emitter Style

```
┌────────────────────────────────────────────────────────────┐
│  [1] [2] [3] [4] [5] [6] [7] [8] [9] [10][11][12][13][14] │
│   B   b   b   b   B   -   B   A   B   B   -   P   G   G   │
│   G   G   G   G   G   A   G   A   G   G   -   g   R   R   │
│   -   -   -   -   A   A   -   A   -   A   -   -   -   -   │
│                                                           │
│ TOP:    B = Blue flash, b = Blue sustain, P = Pulse       │
│ MIDDLE: G = Note color, g = dim note, R = Red (high oct)  │
│ BOTTOM: A = Amber expression, - = off                     │
└────────────────────────────────────────────────────────────┘
```

## Color Scheme Comparison

### Current Neon Palette (Cosine-based)

```
C  → Pink      C# → Purple    D  → Blue
D# → Cyan      E  → Green     F  → Yellow
F# → Orange    G  → Red       G# → Pink
A  → Purple    A# → Blue      B  → Cyan

Problem: Adjacent semitones have unrelated colors!
```

### Improved Circle of Fifths

```
C  → Red       G  → Orange    D  → Yellow
A  → Lime      E  → Green     B  → Teal
F# → Cyan      C# → Blue      G# → Indigo
D# → Violet    A# → Magenta   F  → Rose

Benefit: Perfect fifths are adjacent hues (C→G→D→A→E)
```

## Duration Visualization Options

### Option 1: Extended Blue Glow

```
Row:     0    1    2    3    4    5    6    7
         │    │    │    │    │    │    │    │
Note:    █────┼────┼────┤         │    │    │
         │    │    │    │         │    │    │
Blue:    ████▓▓▓▓▓▓▓▓░░░░         │    │    │
              │         │         │    │    │
              └─sustain─┘         │    │    │
```

### Option 2: Fade-out Glow

```
Row:     0    1    2    3    4    5    6    7
         │    │    │    │    │    │    │    │
Note:    █────┼────┼────┤         │    │    │
         │    │    │    │         │    │    │
Blue:    ████▓▓▓▓▒▒▒▒░░░░         │    │    │
              │              │    │    │    │
              └─fade to 30%──┘    │    │    │
```

### Option 3: Horizontal Gate Bar (Renoise-style)

```
Row:     0    1    2    3    4    5    6    7
         │    │    │    │    │    │    │    │
Note:    ═══════════════╡              │    │
         │    │    │    │              │    │
Blue:    █    █    █    █              │    │
         │    │    │    │              │    │
         └────┴────┴────┘              │    │
              bar extends for duration
```

## Summary of Improvements

| Feature | Current | Improved |
|---------|---------|----------|
| Note Duration | Not shown | Blue glow extends for duration |
| Expression-only | Ambiguous | Clear amber indicator |
| Note-off | Invisible | Pulsing blue + dim color |
| Octave info | None | Brightness = octave |
| Color scheme | Arbitrary | Circle of fifths |
| LED glow | Simple | Hardware-authentic bloom |
| Sustain state | Not tracked | Explicit isSustaining flag |
