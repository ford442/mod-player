import { describe, expect, it } from 'vitest';
import { applyMasterLevels, ensureMasterOutputChain } from '../utils/audioMasterGraph';

describe('audioMasterGraph', () => {
  it('applyMasterLevels sets gain and pan on live nodes', () => {
    const gain = { gain: { value: 1 } } as GainNode;
    const panner = { pan: { value: 0 } } as StereoPannerNode;
    const refs = {
      gainNodeRef: { current: gain },
      stereoPannerRef: { current: panner },
    };

    applyMasterLevels(refs, 0.25, -0.5);

    expect(gain.gain.value).toBe(0.25);
    expect(panner.pan.value).toBe(-0.5);
  });

  it('applyMasterLevels no-ops when nodes are missing', () => {
    expect(() => applyMasterLevels(
      { gainNodeRef: { current: null }, stereoPannerRef: { current: null } },
      0.5,
      0,
    )).not.toThrow();
  });

  it('ensureMasterOutputChain wires analyser → panner → gain → destination', () => {
    const connections: string[] = [];
    const makeNode = (name: string) => ({
      connect(dest: unknown) {
        connections.push(`${name}->${(dest as { __name?: string }).__name ?? 'unknown'}`);
        return dest;
      },
      disconnect() { /* ignore */ },
      __name: name,
    });

    const ctx = { destination: { __name: 'destination' } } as unknown as AudioContext;
    const analyser = makeNode('analyser') as unknown as AnalyserNode;
    const panner = makeNode('panner') as unknown as StereoPannerNode;
    const gain = makeNode('gain') as unknown as GainNode;

    ensureMasterOutputChain(ctx, {
      analyserRef: { current: analyser },
      stereoPannerRef: { current: panner },
      gainNodeRef: { current: gain },
    });

    expect(connections).toEqual([
      'analyser->panner',
      'panner->gain',
      'gain->destination',
    ]);
  });
});
