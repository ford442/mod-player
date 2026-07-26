import { describe, expect, it } from 'vitest';
import { fillUniformPayload } from '../utils/gpuPacking';

describe('instrumentHighlight uniform slot 33', () => {
  it('writes highlightInstrument at uint[33] and returns 136 bytes', () => {
    const buf = new ArrayBuffer(144);
    const uint = new Uint32Array(buf);
    const float = new Float32Array(buf);

    const byteLength = fillUniformPayload(
      'extended',
      {
        numRows: 64,
        numChannels: 4,
        playheadRow: 0,
        isPlaying: true,
        cellW: 1,
        cellH: 1,
        canvasW: 1024,
        canvasH: 1024,
        tickOffset: 0,
        bpm: 125,
        timeSec: 0,
        beatPhase: 0,
        groove: 0,
        kickTrigger: 0,
        activeChannels: [0],
        isModuleLoaded: true,
        paletteMode: 1,
        highlightInstrument: 7,
      },
      uint,
      float,
    );

    expect(byteLength).toBe(136);
    expect(uint[32]).toBe(1);
    expect(uint[33]).toBe(7);
  });

  it('defaults highlightInstrument to 0', () => {
    const buf = new ArrayBuffer(144);
    const uint = new Uint32Array(buf);
    const float = new Float32Array(buf);

    fillUniformPayload(
      'extended',
      {
        numRows: 32,
        numChannels: 4,
        playheadRow: 0,
        isPlaying: false,
        cellW: 1,
        cellH: 1,
        canvasW: 512,
        canvasH: 512,
        tickOffset: 0,
        bpm: 120,
        timeSec: 0,
        beatPhase: 0,
        groove: 0,
        kickTrigger: 0,
        activeChannels: [],
        isModuleLoaded: false,
      },
      uint,
      float,
    );

    expect(uint[33]).toBe(0);
  });
});
