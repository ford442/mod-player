/**
 * libopenmpt's pattern command values. `openmpt_module_get_pattern_row_channel_command(mod, pattern,
 * row, channel, command)` takes one of the {@link PatternCommand} indices and, for VOLUMEEFFECT and
 * EFFECT, returns the *internal* enum of libopenmpt's soundlib/modcommand.h, not an XM/MOD/S3M letter
 * (ECx is `CMD_MODCMDEX` with parameter 0xCx; arpeggio is `CMD_ARPEGGIO`, not "effect 0 with a
 * parameter"). The values are read from libopenmpt 0.8.9 (scripts/lib/libopenmpt-source.sh, the
 * pinned tarball) and checked against the committed wasm by tests/patternCommandMapping.test.ts,
 * which also checks the WGSL mirror in shaders/lib/openmpt_commands.wgsl.
 */

/** The `command` argument of `openmpt_module_get_pattern_row_channel_command`. */
export const PatternCommand = {
  NOTE: 0,
  INSTRUMENT: 1,
  VOLUMEEFFECT: 2,
  EFFECT: 3,
  VOLUME: 4,
  PARAMETER: 5,
} as const;

/** `VolumeCommand` (modcommand.h): the value of {@link PatternCommand.VOLUMEEFFECT}. */
export const VolumeCommand = {
  VOLCMD_NONE: 0,
  VOLCMD_VOLUME: 1,
  VOLCMD_PANNING: 2,
  VOLCMD_VOLSLIDEUP: 3,
  VOLCMD_VOLSLIDEDOWN: 4,
  VOLCMD_FINEVOLUP: 5,
  VOLCMD_FINEVOLDOWN: 6,
  VOLCMD_VIBRATOSPEED: 7,
  VOLCMD_VIBRATODEPTH: 8,
  VOLCMD_PANSLIDELEFT: 9,
  VOLCMD_PANSLIDERIGHT: 10,
  VOLCMD_TONEPORTAMENTO: 11,
  VOLCMD_PORTAUP: 12,
  VOLCMD_PORTADOWN: 13,
  VOLCMD_PLAYCONTROL: 14,
  VOLCMD_OFFSET: 15,
} as const;

/** `EffectCommand` (modcommand.h): the value of {@link PatternCommand.EFFECT}. */
export const EffectCommand = {
  CMD_NONE: 0,
  CMD_ARPEGGIO: 1,
  CMD_PORTAMENTOUP: 2,
  CMD_PORTAMENTODOWN: 3,
  CMD_TONEPORTAMENTO: 4,
  CMD_VIBRATO: 5,
  CMD_TONEPORTAVOL: 6,
  CMD_VIBRATOVOL: 7,
  CMD_TREMOLO: 8,
  CMD_PANNING8: 9,
  CMD_OFFSET: 10,
  CMD_VOLUMESLIDE: 11,
  CMD_POSITIONJUMP: 12,
  CMD_VOLUME: 13,
  CMD_PATTERNBREAK: 14,
  CMD_RETRIG: 15,
  CMD_SPEED: 16,
  CMD_TEMPO: 17,
  CMD_TREMOR: 18,
  CMD_MODCMDEX: 19,
  CMD_S3MCMDEX: 20,
  CMD_CHANNELVOLUME: 21,
  CMD_CHANNELVOLSLIDE: 22,
  CMD_GLOBALVOLUME: 23,
  CMD_GLOBALVOLSLIDE: 24,
  CMD_KEYOFF: 25,
  CMD_FINEVIBRATO: 26,
  CMD_PANBRELLO: 27,
  CMD_XFINEPORTAUPDOWN: 28,
  CMD_PANNINGSLIDE: 29,
  CMD_SETENVPOSITION: 30,
  CMD_MIDI: 31,
  CMD_SMOOTHMIDI: 32,
  CMD_DELAYCUT: 33,
  CMD_XPARAM: 34,
  CMD_FINETUNE: 35,
  CMD_FINETUNE_SMOOTH: 36,
  CMD_DUMMY: 37,
  CMD_NOTESLIDEUP: 38, // IMF Gxy / PTM Jxy (Slide y notes up every x ticks)
  CMD_NOTESLIDEDOWN: 39, // IMF Hxy / PTM Kxy (Slide y notes down every x ticks)
  CMD_NOTESLIDEUPRETRIG: 40, // PTM Lxy (Slide y notes up every x ticks + retrigger note)
  CMD_NOTESLIDEDOWNRETRIG: 41, // PTM Mxy (Slide y notes down every x ticks + retrigger note)
  CMD_REVERSEOFFSET: 42, // PTM Nxx Revert sample + offset
  CMD_DBMECHO: 43, // DBM enable/disable echo
  CMD_OFFSETPERCENTAGE: 44, // PLM Percentage Offset
  CMD_DIGIREVERSESAMPLE: 45, // DIGI reverse sample
  CMD_VOLUME8: 46, // 8-bit volume
  CMD_HMN_MEGA_ARP: 47, // His Master's Noise "mega-arp"
  CMD_MED_SYNTH_JUMP: 48, // MED synth jump / MIDI panning
  CMD_AUTO_VOLUMESLIDE: 49,
  CMD_AUTO_PORTAUP: 50,
  CMD_AUTO_PORTADOWN: 51,
  CMD_AUTO_PORTAUP_FINE: 52,
  CMD_AUTO_PORTADOWN_FINE: 53,
  CMD_AUTO_PORTAMENTO_FC: 54, // Future Composer
  CMD_TONEPORTA_DURATION: 55, // Parameter = how many rows the slide should last
  CMD_VOLUMEDOWN_DURATION: 56, // Parameter = how many rows the slide should last
  CMD_VOLUMEDOWN_ETX: 57, // EasyTrax fade-out (parameter = speed, independent of song tempo)
} as const;

/** Parameter byte high nibble of `CMD_MODCMDEX` (MOD/XM Exy) and `CMD_S3MCMDEX` (S3M/IT Sxy) for "note cut". */
const CUT_SUBCOMMAND = 0xc0;

/**
 * True when the effect cuts the playing note (MOD/XM `ECx`, S3M/IT `SCx`). A cut command carries its
 * tick in the low nibble; the note is silent from that tick of the row on.
 */
export function isNoteCutEffect(effCmd: number, effVal: number): boolean {
  return (effCmd === EffectCommand.CMD_MODCMDEX || effCmd === EffectCommand.CMD_S3MCMDEX)
    && (effVal & 0xf0) === CUT_SUBCOMMAND;
}

/** True for the volume column's "set volume 0" — silences the channel without a note-off. */
export function isVolumeColumnOff(volCmd: number, volVal: number): boolean {
  return volCmd === VolumeCommand.VOLCMD_VOLUME && volVal === 0;
}

/**
 * The one-byte `volPacked` of the high-precision layout: exact `VolumeCommand` in the high nibble,
 * a 0..15 intensity in the low nibble. Set-volume and panning carry 0..64, scaled with integer
 * math (`(v * 15 + 32) >> 6`, so 64 → 15 and 32 → 8) that the WGSL mirror
 * (`packVolNibbles` in shaders/lib/openmpt_commands.wgsl) reproduces exactly; every other volume
 * command (slides, vibrato, offset, …) carries 0..15 by format and saturates at 15.
 */
export function packVolNibbles(volCmd: number, volVal: number): number {
  const cmd = volCmd & 0x0f;
  const isScaled = cmd === VolumeCommand.VOLCMD_VOLUME || cmd === VolumeCommand.VOLCMD_PANNING;
  const intensity = isScaled ? (Math.min(volVal, 64) * 15 + 32) >> 6 : Math.min(volVal, 15);
  return (cmd << 4) | intensity;
}
