// lib/openmpt_commands.wgsl
// libopenmpt command values the GPU packers need. Mirrors utils/openmptCommands.ts (values from
// soundlib/modcommand.h, libopenmpt 0.8.9); tests/patternCommandMapping.test.ts pins every value
// here to the TS module and to what the committed wasm returns.

const VOLCMD_VOLUME: u32    = 1u;
const VOLCMD_PANNING: u32   = 2u;
const CMD_MODCMDEX: u32     = 19u;
const CMD_S3MCMDEX: u32     = 20u;

// MOD/XM ECx and S3M/IT SCx: note cut after x ticks (utils/openmptCommands.ts isNoteCutEffect).
fn isEffectCut(effCmd: u32, effVal: u32) -> bool {
    return (effCmd == CMD_MODCMDEX || effCmd == CMD_S3MCMDEX) && (effVal & 0xF0u) == 0xC0u;
}

// Volume column "set volume 0" (utils/openmptCommands.ts isVolumeColumnOff).
fn isVolumeOff(volCmd: u32, volVal: u32) -> bool {
    return volCmd == VOLCMD_VOLUME && volVal == 0u;
}

// volPacked of the high-precision layout: exact VolumeCommand in the high nibble, 0..15 intensity
// in the low nibble (utils/openmptCommands.ts packVolNibbles — same integer math).
fn packVolNibbles(volCmd: u32, volVal: u32) -> u32 {
    let cmd = volCmd & 0x0Fu;
    var intensity = min(volVal, 15u);
    if (cmd == VOLCMD_VOLUME || cmd == VOLCMD_PANNING) {
        intensity = (min(volVal, 64u) * 15u + 32u) >> 6u;
    }
    return (cmd << 4u) | intensity;
}
