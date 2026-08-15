import { describe, expect, it } from 'vitest';
import { selectInspectorList } from '../utils/inspectorListKind';

describe('selectInspectorList', () => {
  it('prefers instruments when numInstruments > 0 (XM/IT)', () => {
    const result = selectInspectorList(
      3,
      ['Lead', 'Bass', ''],
      ['smplA', 'smplB', 'smplC', 'smplD'],
    );
    expect(result.kind).toBe('instruments');
    expect(result.names).toEqual(['Lead', 'Bass', '']);
  });

  it('falls back to samples when numInstruments === 0 (MOD/S3M)', () => {
    const samples = ['Kick', '', 'Snare'];
    const result = selectInspectorList(0, [], samples);
    expect(result.kind).toBe('samples');
    expect(result.names).toBe(samples);
  });

  it('returns empty samples list when both namespaces are empty', () => {
    const result = selectInspectorList(0, [], []);
    expect(result.kind).toBe('samples');
    expect(result.names).toEqual([]);
  });

  it('does not use sample count when instruments exist', () => {
    const result = selectInspectorList(1, ['Pad'], []);
    expect(result.kind).toBe('instruments');
    expect(result.names).toEqual(['Pad']);
  });
});
