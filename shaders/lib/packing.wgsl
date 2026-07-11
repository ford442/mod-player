// packing.wgsl — bit-field unpack + TRIG-001 / DURA cell classification
// Single source of truth for PackedA/PackedB decode used by circular night family.
//#include "lib/notes.wgsl"
//#include "lib/dura.wgsl"

// Raw fields extracted from high-precision GPU packing
//   PackedA: [Note(8) | Instr(8) | Duration(8) | VolNibble(8)]
//   PackedB: [EffCmd(8) | EffVal(8) | DurFlags(7)+pad | VolCmdFull(8)]  (+ trigger bit)
struct PackedCellFields {
  note: u32,
  instRaw: u32,
  durationRaw: u32,
  volPacked: u32,
  effCmd: u32,
  effVal: u32,
  durationFlags: u32,
  volCmdFull: u32,
  isExpressionOnly: bool,
  inst: u32,
  volCmd: u32,
  volVal: u32,
}

fn unpackCellFields(packedA: u32, packedB: u32) -> PackedCellFields {
  var f: PackedCellFields;
  f.note = (packedA >> 24u) & 255u;
  f.instRaw = (packedA >> 16u) & 255u;
  f.durationRaw = (packedA >> 8u) & 255u;
  f.volPacked = packedA & 255u;
  f.effCmd = (packedB >> 24u) & 255u;
  f.effVal = (packedB >> 16u) & 255u;
  f.durationFlags = (packedB >> 8u) & 0x7Fu;
  f.volCmdFull = packedB & 255u;
  f.isExpressionOnly = (f.instRaw & 128u) != 0u;
  f.inst = f.instRaw & 127u;
  f.volCmd = (f.volPacked >> 4u) << 4u;
  f.volVal = (f.volPacked & 0x0Fu) << 4u;
  return f;
}

// TRIG-001 cell-type flags derived from note range + duration metadata
struct CellClass {
  isNoteOn: bool,
  isNoteOff: bool,
  isExprOnly: bool,
  isSustain: bool,
  isDead: bool,
}

fn classifyCell(note: u32, isExpressionOnly: bool, dInfo: NoteDurationInfo) -> CellClass {
  var c: CellClass;
  c.isNoteOn = (note > 0u && note < NOTE_OFF_MIN && dInfo.isTrigger);
  c.isNoteOff = (note >= NOTE_OFF_MIN);
  c.isExprOnly = (!c.isNoteOn && !c.isNoteOff && isExpressionOnly);
  c.isSustain = (
    note > 0u && note < NOTE_OFF_MIN &&
    !dInfo.isTrigger &&
    dInfo.duration > 0u &&
    dInfo.rowOffset > 0u &&
    !dInfo.isNoteOff
  );
  c.isDead = (!c.isNoteOn && !c.isExprOnly && !c.isSustain && !c.isNoteOff);
  return c;
}
