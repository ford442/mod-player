// @ts-nocheck
// Pure function to extract a pattern matrix from a loaded libopenmpt module.
// Separated from useLibOpenMPT to keep the hook under 777 lines.

import { decodeEffectCode } from './effectCodes';

export function getPatternMatrix(lib, modPtr, patternIndex, orderIndex) {
  if (!lib) return { order: orderIndex, patternIndex, numRows: 64, numChannels: 4, rows: [] };

  const numRows = lib._openmpt_module_get_pattern_num_rows(modPtr, patternIndex);
  const numChannels = lib._openmpt_module_get_num_channels(modPtr);
  const rows = [];

  for (let r = 0; r < numRows; r++) {
    const rowData = [];
    for (let c = 0; c < numChannels; c++) {
      const note   = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 0);
      const inst   = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 1);
      const volCmd = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 2);
      const volVal = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 3);
      const effCmd = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 4);
      const effVal = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 5);

      // Decode effect to activeEffect ID for visualization (0-15)
      const activeEffect = decodeEffectCode(effCmd, effVal);

      rowData.push({
        type: note > 0 ? 'note' : 'empty',
        text: '',
        note, inst, volCmd, volVal, effCmd, effVal,
        activeEffect,
      });
    }
    rows.push(rowData);
  }

  return { order: orderIndex, patternIndex, numRows, numChannels, rows };
}
