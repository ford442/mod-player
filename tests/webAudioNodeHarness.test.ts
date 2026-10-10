/**
 * Spike for the #453 FX-rack test harness: node-web-audio-api must give us an
 * exact, deterministic OfflineAudioContext — including an AudioWorklet inside
 * the offline context — before any sample-level FX test relies on it.
 *
 * Deliberately not relied on: OfflineAudioContext.suspend(). node-web-audio-api
 * registers it asynchronously, so a fast render can race past the suspend
 * point and reject it (seen under full-suite load). Tests schedule automation
 * ahead of time instead.
 */
import { describe, expect, it } from 'vitest';
import {
  WEB_AUDIO_TIMEOUT_MS,
  bufferFrom,
  channelsOf,
  maxAbsDiff,
  nwa,
  renderOffline,
  repoPath,
} from './helpers/webAudioNode';

const SR = 48_000;
const LEN = SR / 2;

function testSignal(): Float32Array<ArrayBuffer>[] {
  const left = new Float32Array(LEN);
  const right = new Float32Array(LEN);
  for (let i = 0; i < LEN; i++) {
    left[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR);
    right[i] = 0.25 * Math.sin((2 * Math.PI * 331 * i) / SR) + 0.1;
  }
  return [left, right];
}

describe('node-web-audio-api harness (#453)', { timeout: WEB_AUDIO_TIMEOUT_MS }, () => {
  it('renders a unity-gain chain bit-exactly', async () => {
    const input = testSignal();
    const out = await renderOffline({ length: LEN, sampleRate: SR }, (ctx) => {
      const src = new nwa.AudioBufferSourceNode(ctx, { buffer: bufferFrom(ctx, input) });
      const a = ctx.createGain();
      const b = ctx.createGain();
      src.connect(a).connect(b).connect(ctx.destination);
      src.start(0);
    });
    expect(maxAbsDiff(channelsOf(out), input)).toBe(0);
  });

  it('sums x·0 + x·1 back to x exactly (the bypass identity the rack relies on)', async () => {
    const input = testSignal();
    const out = await renderOffline({ length: LEN, sampleRate: SR }, (ctx) => {
      const src = new nwa.AudioBufferSourceNode(ctx, { buffer: bufferFrom(ctx, input) });
      const off = new nwa.GainNode(ctx, { gain: 0 });
      const on = new nwa.GainNode(ctx, { gain: 1 });
      src.connect(off).connect(ctx.destination);
      src.connect(on).connect(ctx.destination);
      src.start(0);
    });
    expect(maxAbsDiff(channelsOf(out), input)).toBe(0);
  });

  it('runs an AudioWorklet inside an OfflineAudioContext, deterministically and with no latency', async () => {
    const input = testSignal();
    const render = () =>
      renderOffline({ length: LEN, sampleRate: SR }, async (ctx) => {
        await ctx.audioWorklet.addModule(repoPath('tests/fixtures/worklets/passthrough-processor.js'));
        const src = new nwa.AudioBufferSourceNode(ctx, { buffer: bufferFrom(ctx, input) });
        const node = new nwa.AudioWorkletNode(ctx, 'test-passthrough', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: 'explicit',
          parameterData: { gain: 1 },
        });
        src.connect(node).connect(ctx.destination);
        src.start(0);
      });
    const first = channelsOf(await render());
    const second = channelsOf(await render());
    expect(maxAbsDiff(first, second)).toBe(0);
    expect(maxAbsDiff(first, input)).toBe(0);
  });
});
