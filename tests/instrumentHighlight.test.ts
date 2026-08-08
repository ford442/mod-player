import { describe, expect, it } from 'vitest';
import { fillUniformPayload } from '../utils/gpuPacking';

describe('instrumentHighlight uniform slot 33', () => {
  it('writes highlightInstrument at uint[33] and returns 144 bytes', () => {
    const buf = new ArrayBuffer(152);
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

    expect(byteLength).toBe(144);
    expect(uint[32]).toBe(1);
    expect(uint[33]).toBe(7);
  });

  it('defaults highlightInstrument to 0', () => {
    const buf = new ArrayBuffer(152);
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

describe('accessibility uniforms (slots 34-35)', () => {
  function makeUniformBuffers() {
    const buf = new ArrayBuffer(152);
    return { uint: new Uint32Array(buf), float: new Float32Array(buf) };
  }

  const BASE_PARAMS = {
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
    activeChannels: [] as number[],
    isModuleLoaded: false,
  } as const;

  it('motionScale defaults to 1.0 (normal motion)', () => {
    const { uint, float } = makeUniformBuffers();
    fillUniformPayload('extended', { ...BASE_PARAMS }, uint, float);
    expect(float[34]).toBeCloseTo(1.0);
  });

  it('motionScale is 0.0 when motionScale=0 (reduced-motion)', () => {
    const { uint, float } = makeUniformBuffers();
    fillUniformPayload('extended', { ...BASE_PARAMS, motionScale: 0.0 }, uint, float);
    expect(float[34]).toBeCloseTo(0.0);
  });

  it('motionScale clamps to [0, 1]', () => {
    const { uint, float } = makeUniformBuffers();
    fillUniformPayload('extended', { ...BASE_PARAMS, motionScale: 2.5 }, uint, float);
    expect(float[34]).toBeCloseTo(1.0);

    fillUniformPayload('extended', { ...BASE_PARAMS, motionScale: -0.5 }, uint, float);
    expect(float[34]).toBeCloseTo(0.0);
  });

  it('highContrast defaults to 0 (off)', () => {
    const { uint, float } = makeUniformBuffers();
    fillUniformPayload('extended', { ...BASE_PARAMS }, uint, float);
    expect(uint[35]).toBe(0);
  });

  it('highContrast = 1 when highContrast flag is truthy', () => {
    const { uint, float } = makeUniformBuffers();
    fillUniformPayload('extended', { ...BASE_PARAMS, highContrast: 1 }, uint, float);
    expect(uint[35]).toBe(1);
  });
});

