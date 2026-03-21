// Effect ID mapping for FT2/Tracker effects
// Used by shaders to visualize different effect types
//
// EFFECT ID REFERENCE FOR SHADER AUTHORS:
// ═══════════════════════════════════════════════════════
// 0 = No effect / None
// 1 = Vibrato (4xy)
// 2 = Portamento (3xy)
// 3 = Tremolo (7xy)
// 4 = Arpeggio (0xy)
// 5 = Retrigger (Rxy)
// 6 = Portamento Up (1xy)
// 7 = Portamento Down (2xy)
// 8 = Volume Slide (Axy)
// 9 = Set Panning (8xx)
// 10 = Sample Offset (9xx)
// 11 = Set Speed/BPM (Fxx)
// 12 = Note Cut (ECx)
// 13 = Note Delay (EDx)
// 14 = Panning Slide (Pxy)
// 15 = Global Volume Slide (Hxy)
// ═══════════════════════════════════════════════════════
//
// The activeEffect field in ChannelShadowState uses these IDs.
// effectValue contains the raw effect parameter (0-255).
//
// Shader visualization suggestions:
// - Effects 1-3 (pitch modulation): Blue/cyan colors
// - Effects 4-5 (rhythm/arpeggio): Purple/magenta colors  
// - Effects 6-8 (volume/portamento): Green/yellow colors
// - Effects 9-11 (positional/global): Orange/red colors
// - Effects 12-15 (special): White/bright colors

/**
 * Decodes FT2 effect command codes to activeEffect IDs
 * @param effCmd - The effect command byte (0-255, typically ASCII letter or number)
 * @param effVal - The effect parameter byte (0-255)
 * @returns The activeEffect ID (0-15, where 0 = no effect)
 */
export const decodeEffectCode = (effCmd: any, effVal: number | undefined): number => {
  if (!effCmd || effCmd === 0) return 0;

  const cmd = typeof effCmd === 'string' ? effCmd.charCodeAt(0) : effCmd;
  const val = effVal ?? 0;

  switch (cmd) {
    // --- 1: VIBRATO (FT2: 4 / 0x4) ---
    // Modulates pitch up and down
    case 0x4:
    case 52: // '4'
      return 1;

    // --- 2: PORTAMENTO TO NOTE (FT2: 3 / 0x3) ---
    // Glides pitch to the target note
    case 0x3:
    case 51: // '3'
    case 0x5: // Tone porta + Vol slide
    case 53: // '5'
      return 2;

    // --- 3: TREMOLO (FT2: 7 / 0x7) ---
    // Modulates volume up and down
    case 0x7:
    case 55: // '7'
      return 3;

    // --- 4: ARPEGGIO (FT2: 0 / 0x0) ---
    // Rapidly cycles between 3 notes
    case 0x0:
    case 48: // '0'
      // Arpeggio with val 0 is usually nothing, but still an arpeggio command
      return 4;

    // --- 5: RETRIGGER NOTE (FT2: R / 0x12) ---
    // Rapidly restarts the note
    case 0x12:
    case 82: // 'R'
    case 114: // 'r'
      return 5;

    // Extended command E9x (Retrigger)
    case 0xE:
    case 69: // 'E'
    case 101: // 'e'
      {
        const effectStr = effCmd.toString(16).toUpperCase();
        if (effectStr === 'E9' || effectStr === 'e9' || (val >= 0x90 && val <= 0x9F)) {
          return 5;
        }

        // --- 12: NOTE CUT (FT2: ECx) ---
        // Silences note after x ticks
        if (effectStr === 'EC' || effectStr === 'ec' || (val >= 0xC0 && val <= 0xCF)) {
          return 12;
        }

        // --- 13: NOTE DELAY (FT2: EDx) ---
        // Waits x ticks before playing note
        if (effectStr === 'ED' || effectStr === 'ed' || (val >= 0xD0 && val <= 0xDF)) {
          return 13;
        }
      }
      break;

    // --- 6: PORTAMENTO UP (FT2: 1 / 0x1) ---
    // Slides pitch up
    case 0x1:
    case 49: // '1'
      return 6;

    // --- 7: PORTAMENTO DOWN (FT2: 2 / 0x2) ---
    // Slides pitch down
    case 0x2:
    case 50: // '2'
      return 7;

    // --- 8: VOLUME SLIDE (FT2: A / 0xA) ---
    // Glides volume up or down
    case 0xA:
    case 65: // 'A'
    case 97: // 'a'
      return 8;

    // --- 9: SET PANNING (FT2: 8 / 0x8) ---
    // Positions sound in stereo field
    case 0x8:
    case 56: // '8'
    case 0X8E: // '8E' - Panning envelope
      return 9;

    // --- 10: SAMPLE OFFSET (FT2: 9 / 0x9) ---
    // Starts playing from middle of sample
    case 0x9:
    case 57: // '9'
      return 10;

    // --- 11: SET SPEED/BPM (FT2: F / 0xF) ---
    // Changes playback speed
    case 0xF:
    case 70: // 'F'
    case 102: // 'f'
      return 11;

    // --- 14: PANNING SLIDE (FT2: P / 0x10) ---
    // Moves sound left/right over time
    case 0x10:
    case 80: // 'P'
    case 112: // 'p'
      return 14;

    // --- 15: GLOBAL VOLUME SLIDE (FT2: H / 0x11) ---
    // Changes overall module volume
    case 0x11:
    case 72: // 'H'
    case 104: // 'h'
      return 15;
  }

  return 0;
};
