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
export const decodeEffectCode = (effCmd: number | undefined, effVal: number | undefined): number => {
  if (!effCmd || effCmd === 0) return 0;

  const cmd = typeof effCmd === 'string' ? effCmd.charCodeAt(0) : effCmd;
  const val = effVal ?? 0;

  // Map effect command to activeEffect ID
  switch (cmd) {
    // 0xy - Arpeggio
    case 0x30: // '0'
    case 0x00:
      return 4;

    // 1xy - Portamento Up
    case 0x31: // '1'
      return 6;

    // 2xy - Portamento Down
    case 0x32: // '2'
      return 7;

    // 3xy - Portamento to Note (Tone Portamento)
    case 0x33: // '3'
      return 2;

    // 4xy - Vibrato
    case 0x34: // '4'
      return 1;

    // 7xy - Tremolo
    case 0x37: // '7'
      return 3;

    // 8xx - Set Panning
    case 0x38: // '8'
      return 9;

    // 9xx - Sample Offset
    case 0x39: // '9'
      return 10;

    // Axy - Volume Slide
    case 0x41: // 'A'
    case 0x61: // 'a'
      return 8;

    // Fxx - Set Speed/BPM
    case 0x46: // 'F'
    case 0x66: // 'f'
      return 11;

    // Hxy - Global Volume Slide
    case 0x48: // 'H'
    case 0x68: // 'h'
      return 15;

    // Pxy - Panning Slide
    case 0x50: // 'P'
    case 0x70: // 'p'
      return 14;

    // Rxy - Retrigger
    case 0x52: // 'R'
    case 0x72: // 'r'
      return 5;

    // E commands (special)
    case 0x45: // 'E'
    case 0x65: // 'e'
      // E-subcommands (high nibble of value)
      const subcmd = (val >> 4) & 0x0F;
      switch (subcmd) {
        case 0x0C: // ECx - Note Cut
          return 12;
        case 0x0D: // EDx - Note Delay
          return 13;
        default:
          return 0;
      }

    default:
      return 0;
  }
};

/**
 * Gets a human-readable name for an effect ID
 * @param effectId - The activeEffect ID (0-15)
 * @returns Human-readable effect name
 */
export const getEffectName = (effectId: number): string => {
  const names: Record<number, string> = {
    0: 'None',
    1: 'Vibrato',
    2: 'Portamento',
    3: 'Tremolo',
    4: 'Arpeggio',
    5: 'Retrigger',
    6: 'Portamento Up',
    7: 'Portamento Down',
    8: 'Volume Slide',
    9: 'Set Panning',
    10: 'Sample Offset',
    11: 'Set Speed/BPM',
    12: 'Note Cut',
    13: 'Note Delay',
    14: 'Panning Slide',
    15: 'Global Volume Slide',
  };
  return names[effectId] ?? 'Unknown';
};

/**
 * Gets a color suggestion for shader visualization
 * @param effectId - The activeEffect ID (0-15)
 * @returns RGB color array [r, g, b] (0-1 range)
 */
export const getEffectColor = (effectId: number): [number, number, number] => {
  const colors: Record<number, [number, number, number]> = {
    0: [0.5, 0.5, 0.5],      // Gray (no effect)
    1: [0.2, 0.6, 1.0],      // Vibrato - Blue
    2: [0.4, 0.4, 0.9],      // Portamento - Indigo
    3: [0.3, 0.7, 0.9],      // Tremolo - Light Blue
    4: [0.8, 0.2, 0.8],      // Arpeggio - Magenta
    5: [0.7, 0.3, 0.7],      // Retrigger - Purple
    6: [0.2, 0.8, 0.4],      // Portamento Up - Green
    7: [0.3, 0.7, 0.3],      // Portamento Down - Teal
    8: [0.9, 0.8, 0.2],      // Volume Slide - Yellow
    9: [1.0, 0.6, 0.2],      // Set Panning - Orange
    10: [1.0, 0.4, 0.2],     // Sample Offset - Red-Orange
    11: [1.0, 0.3, 0.3],     // Set Speed - Red
    12: [1.0, 1.0, 1.0],     // Note Cut - White
    13: [0.9, 0.9, 0.9],     // Note Delay - Light Gray
    14: [1.0, 0.7, 0.4],     // Panning Slide - Peach
    15: [0.9, 0.9, 0.2],     // Global Volume Slide - Yellow-Green
  };
  return colors[effectId] ?? [0.5, 0.5, 0.5];
};

export default decodeEffectCode;
