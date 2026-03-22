// Pure function to extract a pattern matrix from a loaded libopenmpt module.
// Separated from useLibOpenMPT to keep the hook under 777 lines.

import { LibOpenMPT, PatternMatrix } from '../types';

export const DEFAULT_ROWS = 64;
export const DEFAULT_CHANNELS = 4;

export function getPatternMatrix(
  lib: LibOpenMPT,
  modPtr: number,
  patternIndex: number,
  orderIndex: number
): PatternMatrix {
  const numRows = lib._openmpt_module_get_pattern_num_rows(modPtr, patternIndex);
  const numChannels = lib._openmpt_module_get_num_channels(modPtr);
  const rows: any[][] = [];

  for (let r = 0; r < numRows; r++) {
    const rowData: any[] = [];
    for (let c = 0; c < numChannels; c++) {
      const note    = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 0);
      const inst    = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 1);
      const volCmd  = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 2);
      const volVal  = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 3);
      const effCmd  = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 4);
      const effVal  = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 5);

      rowData.push({
        type: note > 0 ? 'note' : 'empty',
        text: '',
        note, inst, volCmd, volVal, effCmd, effVal,
      });
    }
    rows.push(rowData);
  }

  return { order: orderIndex, patternIndex, numRows, numChannels, rows };
}
