import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFxHost, publishFxHost, subscribeFxHost } from '../audio/fx/fxHost';
import { ensureCommonMasterNodes, wireMasterOutput } from '../hooks/audioGraph/masterGraph';
import type { AudioGraphRefs } from '../hooks/audioGraph/types';
import {
  applyMasterLevels,
  ensureMasterOutputChain,
  releaseMasterNodes,
  type MasterGraphRefs,
} from '../utils/audioMasterGraph';
import { FxRack } from '../audio/fx/FxRack';
import { defaultFxRackState } from '../audio/fx/spec/schema';
import { readAudioGraphSources } from './helpers/audioGraphSource';
import { CHARACTER_WORKLET, FX_CROSSFADE_S } from './helpers/fxRender';
import {
  bufferFrom,
  channelsOf,
  createOfflineContext,
  installWebAudioGlobals,
  maxAbsDiff,
  nwa,
  startRenderingWithTimeout,
} from './helpers/webAudioNode';

// ── Fake-node graph (topology) ───────────────────────────────────────────────

interface FakeNode {
  __name: string;
  edges: Set<FakeNode>;
  disconnectCalls: number;
  gain: { value: number };
  connect(dest: FakeNode): FakeNode;
  disconnect(dest?: FakeNode): void;
}

/** Edges are a set, like the spec: a duplicate connect() is ignored. */
function makeNode(name: string): FakeNode {
  const node: FakeNode = {
    __name: name,
    edges: new Set(),
    disconnectCalls: 0,
    gain: { value: 1 },
    connect(dest) {
      node.edges.add(dest);
      return dest;
    },
    disconnect(dest) {
      node.disconnectCalls++;
      if (dest) node.edges.delete(dest);
      else node.edges.clear();
    },
  };
  return node;
}

function edgeList(nodes: FakeNode[]): string[] {
  return nodes.flatMap((n) => [...n.edges].map((d) => `${n.__name}->${d.__name}`)).sort();
}

function fakeMaster() {
  const destination = makeNode('destination');
  const ctx = { destination } as unknown as AudioContext;
  const input = makeNode('input');
  const direct = makeNode('direct');
  const analyser = makeNode('analyser');
  const panner = makeNode('panner');
  const gain = makeNode('gain');
  const refs: MasterGraphRefs = {
    masterInputRef: { current: input as unknown as GainNode },
    masterDirectRef: { current: direct as unknown as GainNode },
    analyserRef: { current: analyser as unknown as AnalyserNode },
    stereoPannerRef: { current: panner as unknown as StereoPannerNode },
    gainNodeRef: { current: gain as unknown as GainNode },
  };
  return { ctx, refs, nodes: { input, direct, analyser, panner, gain, destination } };
}

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

  it('ensureMasterOutputChain wires input → direct → analyser → panner → gain → destination', () => {
    const { ctx, refs, nodes } = fakeMaster();
    ensureMasterOutputChain(ctx, refs);
    expect(edgeList(Object.values(nodes))).toEqual([
      'analyser->panner',
      'direct->analyser',
      'gain->destination',
      'input->direct',
      'panner->gain',
    ]);
  });

  it('ensureMasterOutputChain is connect-only: taps and FX-rack edges survive re-assertion (#453)', () => {
    const { ctx, refs, nodes } = fakeMaster();
    ensureMasterOutputChain(ctx, refs);

    // Performance capture taps the panner; the FX rack hangs off input/analyser.
    const captureTap = makeNode('capture');
    const rackIn = makeNode('rackIn');
    const rackOut = makeNode('rackOut');
    nodes.panner.connect(captureTap);
    nodes.input.connect(rackIn);
    rackIn.connect(rackOut);
    rackOut.connect(nodes.analyser);
    nodes.direct.gain.value = 0; // rack controller owns this

    for (let i = 0; i < 3; i++) ensureMasterOutputChain(ctx, refs);

    for (const node of Object.values(nodes)) expect(node.disconnectCalls).toBe(0);
    expect(nodes.panner.edges.has(captureTap)).toBe(true);
    expect(nodes.input.edges.has(rackIn)).toBe(true);
    expect(rackOut.edges.has(nodes.analyser)).toBe(true);
    expect(nodes.direct.gain.value).toBe(0);
    expect(edgeList(Object.values(nodes))).toEqual([
      'analyser->panner',
      'direct->analyser',
      'gain->destination',
      'input->direct',
      'input->rackIn',
      'panner->capture',
      'panner->gain',
    ]);
  });

  it('ensureMasterOutputChain no-ops until every master node exists', () => {
    const { ctx, refs, nodes } = fakeMaster();
    refs.masterInputRef.current = null;
    ensureMasterOutputChain(ctx, refs);
    expect(edgeList(Object.values(nodes))).toEqual([]);
  });

  it('releaseMasterNodes disconnects and forgets every master node', () => {
    const { ctx, refs, nodes } = fakeMaster();
    ensureMasterOutputChain(ctx, refs);
    releaseMasterNodes(refs);
    expect(refs.masterInputRef.current).toBeNull();
    expect(refs.masterDirectRef.current).toBeNull();
    expect(refs.analyserRef.current).toBeNull();
    expect(refs.stereoPannerRef.current).toBeNull();
    expect(refs.gainNodeRef.current).toBeNull();
    expect(edgeList(Object.values(nodes))).toEqual([]);
  });

  it('engines connect to the master input, never straight to the analyser (#453)', () => {
    const src = readAudioGraphSources();
    expect(src).not.toMatch(/\.connect\(\s*refs\.analyserRef/);
    expect(src.match(/\.connect\(\s*refs\.masterInputRef\.current!\s*\)/g)?.length).toBe(3);
  });
});

// ── fxHost ───────────────────────────────────────────────────────────────────

describe('fxHost', () => {
  afterEach(() => publishFxHost(null));

  it('publishes host changes, deduplicated by node identity', () => {
    const seen: unknown[] = [];
    const unsubscribe = subscribeFxHost((h) => seen.push(h));
    const host = {
      ctx: {} as BaseAudioContext,
      masterInput: {} as GainNode,
      masterDirect: {} as GainNode,
      analyser: {} as AnalyserNode,
    };
    publishFxHost(host);
    publishFxHost({ ...host }); // same nodes → no event
    publishFxHost(null);
    unsubscribe();
    publishFxHost(host);
    expect(seen).toEqual([host, null]);
    expect(getFxHost()).toBe(host);
  });
});

// ── Real Web Audio (node-web-audio-api) ──────────────────────────────────────

const SR = 48_000;
const LEN = SR / 2;
const VOLUME = 0.8;
const PAN = 0.25;

function program(): Float32Array<ArrayBuffer>[] {
  const left = new Float32Array(LEN);
  const right = new Float32Array(LEN);
  let seed = 0x9e3779b9;
  for (let i = 0; i < LEN; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff - 0.5) * 0.05;
    left[i] = 0.6 * Math.sin((2 * Math.PI * 110 * i) / SR) + noise;
    right[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / SR) - noise;
  }
  return [left, right];
}

function graphRefs(): AudioGraphRefs {
  return {
    masterInputRef: { current: null },
    masterDirectRef: { current: null },
    analyserRef: { current: null },
    stereoPannerRef: { current: null },
    gainNodeRef: { current: null },
  } as unknown as AudioGraphRefs;
}

/** The pre-#453 graph, built by hand: source → analyser → panner → gain → destination. */
async function renderLegacy(input: Float32Array<ArrayBuffer>[]): Promise<Float32Array<ArrayBuffer>[]> {
  const ctx = createOfflineContext({ length: LEN, sampleRate: SR });
  const src = new nwa.AudioBufferSourceNode(ctx, { buffer: bufferFrom(ctx, input) });
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;
  const panner = ctx.createStereoPanner();
  panner.pan.value = PAN;
  const gain = ctx.createGain();
  gain.gain.value = VOLUME;
  src.connect(analyser);
  analyser.connect(panner);
  panner.connect(gain);
  gain.connect(ctx.destination);
  src.start(0);
  return channelsOf(await startRenderingWithTimeout(ctx));
}

/** The production path: ensureCommonMasterNodes + an engine connected to masterInput. */
async function renderProduction(
  input: Float32Array<ArrayBuffer>[],
  attachBypassedRack: boolean,
): Promise<Float32Array<ArrayBuffer>[]> {
  const ctx = createOfflineContext({ length: LEN, sampleRate: SR });
  const refs = graphRefs();
  ensureCommonMasterNodes(ctx as unknown as AudioContext, refs, VOLUME, PAN);
  if (attachBypassedRack) {
    // Stand-in for a rack with every slot bypassed: unity chain in parallel,
    // dry path faded out — the state FxRack holds between attach and collapse.
    const rackIn = ctx.createGain();
    const rackReturn = ctx.createGain();
    refs.masterInputRef.current!.connect(rackIn);
    rackIn.connect(rackReturn);
    rackReturn.connect(refs.analyserRef.current!);
    refs.masterDirectRef.current!.gain.value = 0;
  }
  // Hot reload / every play re-asserts the chain; it must not disturb anything.
  wireMasterOutput(ctx as unknown as AudioContext, refs, VOLUME, PAN);
  const src = new nwa.AudioBufferSourceNode(ctx, { buffer: bufferFrom(ctx, input) });
  src.connect(refs.masterInputRef.current!);
  src.start(0);
  return channelsOf(await startRenderingWithTimeout(ctx));
}

describe('master graph null test (#453 acceptance 1)', () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  afterEach(() => publishFxHost(null));

  it('the masterInput/masterDirect chain is sample-identical to the pre-rack graph', async () => {
    const input = program();
    const legacy = await renderLegacy(input);
    const current = await renderProduction(input, false);
    expect(maxAbsDiff(current, legacy)).toBe(0);
  });

  it('an attached rack with every slot bypassed is sample-identical too', async () => {
    const input = program();
    const legacy = await renderLegacy(input);
    const attached = await renderProduction(input, true);
    expect(maxAbsDiff(attached, legacy)).toBe(0);
  });

  it('a real FxRack attached with every slot bypassed, then collapsed, matches the pre-rack graph', async () => {
    installWebAudioGlobals();
    const input = program();
    const legacy = await renderLegacy(input);

    const ctx = createOfflineContext({ length: LEN, sampleRate: SR });
    const refs = graphRefs();
    ensureCommonMasterNodes(ctx as unknown as AudioContext, refs, VOLUME, PAN);
    // Modules created but bypassed: their slots are unity wires.
    const rack = await FxRack.create(ctx, defaultFxRackState(), {
      mode: 'live',
      characterWorkletUrl: CHARACTER_WORKLET,
    });
    await rack.prepare(['character', 'eq', 'comp']);
    const attachAt = (128 * 10) / SR;
    const collapseAt = (128 * 100) / SR;
    rack.attach(
      {
        masterInput: refs.masterInputRef.current!,
        masterDirect: refs.masterDirectRef.current!,
        analyser: refs.analyserRef.current!,
      },
      attachAt,
    );
    rack.collapse(collapseAt);
    wireMasterOutput(ctx as unknown as AudioContext, refs, VOLUME, PAN); // a play / hot reload mid-way
    const src = new nwa.AudioBufferSourceNode(ctx, { buffer: bufferFrom(ctx, input) });
    src.connect(refs.masterInputRef.current!);
    src.start(0);
    const out = channelsOf(await startRenderingWithTimeout(ctx));

    const f = (t: number) => Math.round(t * SR);
    const settled = (t: number) => f(t + FX_CROSSFADE_S) + 1;
    expect(maxAbsDiff(out, legacy, 0, f(attachAt))).toBe(0); //               direct path
    expect(maxAbsDiff(out, legacy, settled(attachAt), f(collapseAt))).toBe(0); // through the bypassed rack
    expect(maxAbsDiff(out, legacy, settled(collapseAt))).toBe(0); //             collapsed again
    // During each 10 ms complementary fade the two identical paths sum to x within float rounding.
    expect(maxAbsDiff(out, legacy)).toBeLessThan(1e-6);
  });

  it('ensureCommonMasterNodes publishes the host and recreates nodes for a new context', () => {
    const refs = graphRefs();
    const first = createOfflineContext({ length: 128, sampleRate: SR });
    ensureCommonMasterNodes(first as unknown as AudioContext, refs, 1, 0);
    const firstInput = refs.masterInputRef.current;
    expect(getFxHost()?.ctx).toBe(first);
    expect(getFxHost()?.masterInput).toBe(firstInput);

    ensureCommonMasterNodes(first as unknown as AudioContext, refs, 1, 0);
    expect(refs.masterInputRef.current).toBe(firstInput);

    const second = createOfflineContext({ length: 128, sampleRate: SR });
    ensureCommonMasterNodes(second as unknown as AudioContext, refs, 1, 0);
    expect(refs.masterInputRef.current).not.toBe(firstInput);
    expect(refs.masterInputRef.current?.context).toBe(second);
    expect(refs.analyserRef.current?.context).toBe(second);
    expect(getFxHost()?.ctx).toBe(second);
  });
});
