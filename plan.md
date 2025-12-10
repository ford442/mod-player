# FastTracker II Feature Comparison & Improvement Plan

## Overview

This document compares the playback features of FastTracker II (FT2) with the current implementation of this mod-player application, which uses libopenmpt as its playback engine. The goal is to identify which FT2 features are accurately implemented and suggest improvements to enhance the application.

## About FastTracker II

FastTracker II is a legendary DOS-based tracker application released in 1994, designed for creating XM (eXtended Module) music files. It became the gold standard for tracker music and influenced countless musicians and developers.

### XM Format Key Features
- **Up to 32 channels** of simultaneous audio playback
- **Sophisticated instruments** with volume/panning envelopes
- **Auto-vibrato** on instruments
- **Multiple samples per instrument** with key-split mapping
- **256 patterns** maximum
- **128 instruments** maximum
- **Extended effect commands** beyond the original MOD format

## FastTracker II Effect Commands

### Primary Effect Commands (Main Effect Column)

| Effect | Name | Parameters | Description | Typical Use |
|--------|------|------------|-------------|-------------|
| **0xy** | Arpeggio | x, y | Rapidly cycles between base note, base+x semitones, and base+y semitones every tick | Chord emulation, creating rich harmonies |
| **1xy** | Portamento Up | xy | Slides pitch upward by xy units per tick | Rising pitch effects, sirens |
| **2xy** | Portamento Down | xy | Slides pitch downward by xy units per tick | Falling pitch effects |
| **3xy** | Tone Portamento | xy | Slides smoothly from current note to target note at speed xy | Smooth note transitions, legato |
| **4xy** | Vibrato | x=speed, y=depth | Oscillates pitch at speed x with depth y | Expressive vibrato, wobble effects |
| **5xy** | Tone Portamento + Volume Slide | Combines 3xy and Axy | Slides to target note while adjusting volume | Complex expressive transitions |
| **6xy** | Vibrato + Volume Slide | Combines 4xy and Axy | Applies vibrato while sliding volume | Fading vibrato effects |
| **7xy** | Tremolo | x=speed, y=depth | Oscillates volume at speed x with depth y | Volume wobble, amplitude modulation |
| **8xx** | Set Panning | xx | Sets channel stereo position (00=left, 80=center, FF=right) | Stereo positioning |
| **9xx** | Sample Offset | xx | Starts sample playback at offset xx×256 bytes | Skip intro, create stutter effects |
| **Axy** | Volume Slide | x=up, y=down | Slides volume up (x) or down (y) each tick | Fades, crescendo/decrescendo |
| **Bxx** | Position Jump | xx | Jumps to order list position xx | Song structure, loops |
| **Cxx** | Set Volume | xx | Directly sets channel volume (00-40 hex = 0-64 decimal) | Direct volume control |
| **Dxx** | Pattern Break | xx | Breaks to next order, starting at row xx | Song arrangement, early pattern exit |
| **Fxx** | Set Speed/BPM | xx | Sets speed (ticks/row if ≤1F) or BPM (if >1F) | Tempo changes, rhythm variation |
| **Gxx** | Set Global Volume | xx | Sets master volume (00-40 hex) | Overall mix control |
| **Hxy** | Global Volume Slide | x=up, y=down | Slides global volume | Master fades |
| **Kxx** | Key Off | xx | Triggers instrument release after xx ticks | Controlled note release |
| **Lxx** | Set Envelope Position | xx | Sets envelope position directly | Envelope manipulation |
| **Pxy** | Panning Slide | x=right, y=left | Slides panning position | Auto-pan effects |
| **Rxy** | Multi Retrig Note | xy | Retriggers note with volume change | Stutter, gated effects |
| **Txy** | Tremor | x=on, y=off | Rapidly toggles volume on/off in ticks | Rapid gate effect |
| **X1x** | Extra Fine Porta Up | x | Very fine pitch slide up | Micro-tuning |
| **X2x** | Extra Fine Porta Down | x | Very fine pitch slide down | Micro-tuning |

### Extended Effects (Exy Submenu)

| Effect | Name | Description |
|--------|------|-------------|
| **E0x** | Set Filter | Amiga hardware filter control (mostly obsolete) |
| **E1x** | Fine Portamento Up | Fine pitch slide up by x units |
| **E2x** | Fine Portamento Down | Fine pitch slide down by x units |
| **E3x** | Glissando Control | 0=off, 1=on (slide through semitones) |
| **E4x** | Set Vibrato Waveform | 0=sine, 1=ramp down, 2=square, 3=random |
| **E5x** | Set Finetune | Adjusts sample finetune value |
| **E6x** | Pattern Loop | Sets loop point (x=0) or loops x times |
| **E7x** | Set Tremolo Waveform | 0=sine, 1=ramp down, 2=square, 3=random |
| **E8x** | Set Panning (16 pos) | 16-position panning (coarser than 8xx) |
| **E9x** | Retrigger Note | Retriggers note every x ticks |
| **EAx** | Fine Volume Slide Up | Fine volume increase by x |
| **EBx** | Fine Volume Slide Down | Fine volume decrease by x |
| **ECx** | Note Cut | Cuts note (volume=0) after x ticks |
| **EDx** | Note Delay | Delays note trigger by x ticks |
| **EEx** | Pattern Delay | Delays pattern by x rows |
| **EFx** | Set Active Macro | Sets active MIDI macro |

### Volume Column Effects

XM format also supports shorthand effects in the volume column (separate from the main effect column):

| Effect | Name | Parameters | Description |
|--------|------|------------|-------------|
| **10-50** | Set Volume | Direct | Sets volume directly (16-80 decimal = 0-64) |
| **60-6F** | Volume Slide Down | x | Slides volume down |
| **70-7F** | Volume Slide Up | x | Slides volume up |
| **80-8F** | Fine Volume Down | x | Fine volume decrease |
| **90-9F** | Fine Volume Up | x | Fine volume increase |
| **A0-AF** | Set Vibrato Speed | x | Sets vibrato speed |
| **B0-BF** | Vibrato | x=depth | Applies vibrato with depth x |
| **C0-CF** | Set Panning | x | Sets panning (0=left, F=right) |
| **D0-DF** | Panning Slide Left | x | Slides pan left |
| **E0-EF** | Panning Slide Right | x | Slides pan right |
| **F0-FF** | Tone Portamento | x | Tone porta at speed x |

## Current Implementation Analysis

### What's Working (via libopenmpt)

The application uses **libopenmpt**, which is a highly accurate and mature playback engine that faithfully implements FastTracker II playback, including:

✅ **All XM effect commands** (0xy through Txy and all Exy variants)
✅ **Volume column effects** support
✅ **Instrument envelopes** (volume, panning)
✅ **Auto-vibrato** on instruments
✅ **Pattern loop** and pattern delay
✅ **Multi-sample instruments** with key-split
✅ **Linear and Amiga frequency modes**
✅ **Sample interpolation** options
✅ **All waveform types** for vibrato/tremolo
✅ **Global volume** control
✅ **FT2 compatibility mode** - accurately replicates FT2 quirks and bugs

### Current UI/Visualization Features

The mod-player app provides:

✅ **Pattern visualization** - Both HTML and WebGPU shader-based rendering
✅ **Multi-channel sequencer display** - Shows all channels simultaneously
✅ **Channel state visualization** - Volume, panning, frequency per channel
✅ **Effect detection** - Parses and displays effects (Vibrato, Portamento, Tremolo, Arpeggio, Retrigger)
✅ **Playback position tracking** - Order, row, BPM display
✅ **Seek functionality** - Click to jump to specific rows
✅ **Loop mode** - Continuous playback
✅ **Volume control** - Master volume slider
✅ **Panning control** - Stereo panner node (not currently exposed in UI)
✅ **Media overlay** - Synchronized images/videos with music

### Effect Visualization in Code

The `decodeEffectCode` function in `useLibOpenMPT.ts` currently detects:
- **Effect 4** (Vibrato) - activeEffect: 1
- **Effect 3** (Tone Portamento) - activeEffect: 2
- **Effect 7** (Tremolo) - activeEffect: 3
- **Effect 0** (Arpeggio, when not 000) - activeEffect: 4
- **Effect R** (Retrigger) - activeEffect: 5

These effects are visualized in the WebGPU shaders with color coding and animations.

## Accuracy Assessment

### Playback Accuracy: ✅ EXCELLENT

**Conclusion:** libopenmpt provides **highly accurate** FastTracker II playback. It is considered one of the most faithful implementations available, replicating even the quirky behaviors and bugs of the original FT2.

**Evidence:**
1. libopenmpt is actively maintained and tested against real FT2 modules
2. It includes an "FT2 compatibility mode" that replicates specific FT2 behaviors
3. It supports all XM format features including edge cases
4. The library is used by numerous commercial and open-source projects requiring accuracy

### What Could Be Enhanced

While playback is accurate, the **UI and visualization** could be improved:

## Suggested Improvements

### 1. Enhanced Effect Visualization

**Current:** Only 5 effects visualized (Vibrato, Portamento, Tremolo, Arpeggio, Retrigger)

**Improvement Ideas:**
- Expand `decodeEffectCode` to detect and visualize more effects:
  - Volume slides (Axy, Hxy)
  - Panning effects (8xx, Pxy)
  - Sample offset (9xx)
  - Pattern jumps/breaks (Bxx, Dxx)
  - Speed/BPM changes (Fxx)
  - Note cut/delay (ECx, EDx)
  - Fine effects (E1x, E2x, EAx, EBx)
- Add color-coding or icons for different effect types in the pattern display
- Animate effect parameters (e.g., show portamento direction, volume slide direction)

### 2. Instrument Information Display

**Current:** Basic module info (title, position, BPM)

**Improvement Ideas:**
- Display active instruments per channel
- Show instrument envelopes (volume/panning) graphically
- Display sample names and numbers
- Visualize envelope positions in real-time
- Show auto-vibrato settings when active

### 3. Channel VU Meters & Analysis

**Current:** Basic channel state tracking (volume, pan, freq)

**Improvement Ideas:**
- Add visual VU meters for each channel (already have VU data via libopenmpt)
- Display channel mute status visually
- Show frequency spectrum analyzer (using Web Audio API)
- Add waveform display for active channels
- Visualize stereo field (pan positions of all channels)

### 4. Advanced Playback Controls

**Current:** Play, Stop, Loop, Seek, Volume

**Improvement Ideas:**
- **Pattern navigation:** Prev/Next pattern buttons
- **Speed control:** Playback speed multiplier (0.5x, 1x, 2x)
- **Channel muting:** Solo/mute individual channels
- **Subsong selection:** If module has multiple arrangements
- **Row counter:** Display current row count and total rows
- **Time display:** Show elapsed time / total time
- **Export:** Render to WAV/MP3 (via libopenmpt's rendering capabilities)

### 5. Extended Pattern Visualization

**Current:** Single pattern view with color-coded notes

**Improvement Ideas:**
- **Piano roll view:** Show notes as a piano roll instead of text
- **Scope view:** Oscilloscope display for visual audio feedback
- **Effect legend:** Display what each effect code means on hover
- **Volume column display:** Show volume column effects separately
- **Pattern editor hints:** Display valid ranges for effects
- **Heat map:** Color-code based on note density or effect intensity

### 6. Module Information Panel

**Current:** Basic title, order, row, BPM

**Improvement Ideas:**
- **Full metadata display:**
  - Module format (XM, IT, S3M, MOD)
  - Number of channels
  - Number of patterns
  - Number of instruments/samples
  - Module size
  - Author/tracker info from metadata
  - Module comments/message
- **Pattern order list:** Show full order list with highlighting
- **Sample browser:** List all samples with preview capability
- **Instrument browser:** List all instruments with details

### 7. Performance Optimizations

**Current:** Works well for most modules

**Improvement Ideas:**
- **Virtual scrolling** for large patterns (64+ channels, 256+ rows)
- **Lazy loading** of pattern data
- **Web Worker** for audio processing to prevent UI blocking
- **OffscreenCanvas** for WebGPU rendering
- **Pattern data compression** for memory efficiency

### 8. User Experience Enhancements

**Current:** Basic file upload, no presets/history

**Improvement Ideas:**
- **Drag & drop support:** Already works, but add visual feedback
- **Module library:** Built-in collection of demo modules
- **Recent files:** Remember recently loaded modules
- **Favorites/bookmarks:** Save favorite modules
- **Keyboard shortcuts:**
  - Space: Play/Pause
  - Left/Right: Seek backward/forward
  - Up/Down: Volume up/down
  - M: Toggle mute/unmute all
  - L: Toggle loop
  - Numbers 1-9: Solo channels
- **URL parameters:** Load module from URL query parameter
- **Share functionality:** Generate shareable links to modules

### 9. Developer/Educational Features

**Current:** No developer-focused features

**Improvement Ideas:**
- **Effect command reference:** Built-in documentation for all FT2 effects
- **Debug mode:** Show raw pattern data, effect parameters, internal state
- **Performance metrics:** Display CPU/GPU usage, render times
- **Export pattern data:** Export current pattern as JSON/CSV
- **Module validator:** Check for common tracking mistakes
- **Compatibility warnings:** Warn about non-FT2 features in other formats

### 10. Accessibility

**Current:** Basic web accessibility

**Improvement Ideas:**
- **Keyboard navigation:** Full keyboard control
- **Screen reader support:** ARIA labels for all controls
- **High contrast mode:** Option for better visibility
- **Reduced motion:** Disable animations for motion-sensitive users
- **Text scaling:** Respect browser text size preferences
- **Focus indicators:** Clear focus states for keyboard users

### 11. Mobile/Touch Support

**Current:** Works on mobile but not optimized

**Improvement Ideas:**
- **Touch gestures:** Swipe to seek, pinch to zoom pattern view
- **Mobile-optimized layout:** Responsive design for small screens
- **Full-screen mode:** Hide browser chrome for immersive experience
- **Lock orientation:** Prevent rotation during playback
- **Background playback:** Continue playing when app is backgrounded (if possible with PWA)

### 12. Advanced Audio Features

**Current:** Basic stereo output with volume and panning

**Improvement Ideas:**
- **Equalizer:** Multi-band EQ for overall output
- **Reverb/Effects:** Optional DSP effects (reverb, chorus, delay)
- **Bass boost:** Enhance low frequencies
- **Stereo separation:** Control stereo width
- **Audio routing:** Route individual channels to different outputs
- **Spectrum visualization:** Real-time frequency analyzer
- **Phase meter:** Check mono compatibility

## Technical Considerations

### libopenmpt Capabilities

libopenmpt provides extensive API access to:
- **Pattern data:** All notes, effects, instruments
- **Playback state:** Current position, timing, channel states
- **Channel information:** VU levels, panning, muting
- **Module metadata:** Title, author, comments, instrument names
- **Rendering:** Can render to audio buffer or file
- **Seeking:** Jump to any position accurately
- **Channel control:** Mute/unmute individual channels
- **Subsong handling:** Multiple arrangements in one file

All of these capabilities are available but not fully exposed in the current UI.

### Web Technologies Used

- **React + TypeScript:** Modern, maintainable UI framework
- **Vite:** Fast build tool and dev server
- **WebGPU:** Hardware-accelerated pattern rendering
- **Web Audio API:** Low-latency audio output
- **TailwindCSS:** Utility-first styling
- **WASM (libopenmpt):** Native-performance audio engine

### Browser Compatibility

- **WebGPU:** Limited to Chrome/Edge 113+, requires flag in some versions
- **Web Audio API:** Widely supported (IE11+, all modern browsers)
- **WebAssembly:** Universally supported in modern browsers
- **FileReader API:** Universally supported

**Recommendation:** Maintain HTML fallback for pattern display (already implemented) for broader compatibility.

## Implementation Priority

### High Priority (Best ROI)
1. ✅ **Accurate playback** - Already achieved via libopenmpt
2. **Extended effect visualization** - High visual impact, moderate effort
3. **Instrument information display** - Useful, moderate effort
4. **Advanced playback controls** - Essential features, low effort
5. **Module information panel** - Very useful, low-moderate effort

### Medium Priority
6. **Channel VU meters** - Nice visual feedback, moderate effort
7. **Keyboard shortcuts** - Great UX improvement, low effort
8. **Mobile optimization** - Broader audience, moderate effort
9. **Pattern navigation** - Useful navigation, low effort

### Low Priority (Nice to Have)
10. **Developer/debug features** - Niche audience, moderate effort
11. **Audio effects** - Complex, high effort, potential quality issues
12. **Export functionality** - Useful but complex, high effort
13. **Module library** - Content curation challenge, moderate effort

## Conclusion

**FastTracker II Playback Accuracy: EXCELLENT ✅**

The mod-player application achieves **excellent playback accuracy** for FastTracker II XM modules through libopenmpt, which is one of the most faithful implementations available. All 40+ effect commands, volume column effects, instrument envelopes, and FT2-specific quirks are accurately reproduced.

**Where the app excels:**
- Accurate audio playback of all XM features
- Modern web-based interface
- Advanced WebGPU pattern visualization
- Multi-channel real-time display
- Cross-platform compatibility

**Where the app could improve:**
- Expose more of libopenmpt's capabilities through the UI
- Enhanced effect visualization beyond the current 5 effects
- More comprehensive module information display
- Additional playback controls and navigation
- Mobile/touch optimization
- Keyboard shortcuts for power users
- Accessibility improvements

The playback engine is excellent; the focus should be on improving the **user interface and visualization** to make the app more informative, usable, and feature-rich while maintaining its current strengths.

## Resources

### FastTracker II Documentation
- [OpenMPT Effect Reference](https://wiki.openmpt.org/Manual:_Effect_Reference) - Complete XM effect command reference
- [Unofficial XM File Format Specification](https://www.celersms.com/doc/XM_file_format.pdf) - Technical format details
- [MilkyTracker Manual](https://milkytracker.org/docs/manual/MilkyTracker.html) - FT2-compatible tracker documentation
- [Fast Tracker 2 Clone](https://16-bits.org/ft2.php) - Modern FT2 recreation

### libopenmpt Documentation
- [libopenmpt GitHub](https://github.com/OpenMPT/openmpt) - Source code and documentation
- [libopenmpt API Reference](https://lib.openmpt.org/doc/) - API documentation
- [libopenmpt.js](https://github.com/OpenMPT/libopenmpt.js) - JavaScript/WASM bindings

### Web Audio/WebGPU Resources
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) - MDN documentation
- [WebGPU Specification](https://www.w3.org/TR/webgpu/) - Official W3C spec
- [WGSL Specification](https://www.w3.org/TR/WGSL/) - WebGPU Shading Language

---

**Document Version:** 1.0  
**Last Updated:** December 10, 2025  
**Prepared for:** ford442/mod-player repository
