/** Primary list kind for the Module Info instrument/sample inspector. */
export type InspectorListKind = 'instruments' | 'samples';

export interface InspectorListSelection {
  kind: InspectorListKind;
  names: readonly string[];
}

/**
 * Choose instruments vs samples for the inspector.
 * XM/IT typically have numInstruments > 0; MOD/S3M often report 0 instruments
 * and only samples — listing "Instrument 0,1,2…" would be wrong.
 */
export function selectInspectorList(
  numInstruments: number,
  instruments: readonly string[],
  samples: readonly string[],
): InspectorListSelection {
  if (numInstruments > 0) {
    return { kind: 'instruments', names: instruments };
  }
  return { kind: 'samples', names: samples };
}
