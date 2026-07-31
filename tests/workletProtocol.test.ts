import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAIN_TO_WORKLET,
  WORKLET_TO_MAIN,
  ALL_MAIN_TO_WORKLET_TYPES,
  ALL_WORKLET_TO_MAIN_TYPES,
} from '../audio-worklet/workletProtocolConstants';
import {
  parseMainToWorkletMessage,
  parseOscBufferMessage,
  parseWorkletToMainMessage,
  postLoad,
  postPlay,
  postSeek,
} from '../audio-worklet/protocol';
import { AUDIO_SAB_BYTES } from '../utils/audioReactive';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function readBootstrapConstants(): {
  MAIN_TO_WORKLET: Record<string, string>;
  WORKLET_TO_MAIN: Record<string, string>;
} {
  const src = readFileSync(
    join(ROOT, 'public/worklets/worklet-protocol-constants.js'),
    'utf8',
  );
  const mainMatch = src.match(/var MAIN_TO_WORKLET = Object\.freeze\(\{([\s\S]*?)\}\)/);
  const workletMatch = src.match(/var WORKLET_TO_MAIN = Object\.freeze\(\{([\s\S]*?)\}\)/);
  expect(mainMatch, 'MAIN_TO_WORKLET block').toBeTruthy();
  expect(workletMatch, 'WORKLET_TO_MAIN block').toBeTruthy();

  const parseBlock = (block: string) =>
    Object.fromEntries(
      [...block.matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]),
    );

  return {
    MAIN_TO_WORKLET: parseBlock(mainMatch![1]!),
    WORKLET_TO_MAIN: parseBlock(workletMatch![1]!),
  };
}

describe('workletProtocol constants parity', () => {
  it('bootstrap JS mirrors TypeScript canonical constants', () => {
    const bootstrap = readBootstrapConstants();
    expect(bootstrap.MAIN_TO_WORKLET).toEqual(MAIN_TO_WORKLET);
    expect(bootstrap.WORKLET_TO_MAIN).toEqual(WORKLET_TO_MAIN);
  });

  it('hooks import protocol helpers instead of raw type literals', () => {
    const useAudioGraph = readFileSync(join(ROOT, 'hooks/useAudioGraph.ts'), 'utf8');
    const useLibOpenMPT = readFileSync(join(ROOT, 'hooks/useLibOpenMPT.ts'), 'utf8');
    expect(useAudioGraph).toContain("from '../audio-worklet/protocol'");
    expect(useAudioGraph).toContain('parseWorkletToMainMessageOrWarn');
    expect(useAudioGraph).toContain('dispatchWorkletToMainMessage');
    expect(useLibOpenMPT).toContain('parseOscBufferMessage');
    expect(useLibOpenMPT).not.toMatch(/as SharedArrayBuffer/);
  });

  it('worklet references WorkletProtocolConstants bootstrap', () => {
    const worklet = readFileSync(join(ROOT, 'public/worklets/openmpt-worklet.js'), 'utf8');
    expect(worklet).toContain('WorkletProtocolConstants');
    expect(worklet).toContain('parseMainToWorklet');
    expect(worklet).toContain('WT.position');
    expect(worklet).toContain('MT.load');
  });
});

describe('parseWorkletToMainMessage', () => {
  it('accepts a valid position message', () => {
    const parsed = parseWorkletToMainMessage({
      type: WORKLET_TO_MAIN.position,
      order: 1,
      row: 8,
      positionSeconds: 12.5,
      bpm: 125,
      channelVU: [0.1, 0.2],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.message.type === WORKLET_TO_MAIN.position) {
      expect(parsed.message.order).toBe(1);
    }
  });

  it('rejects malformed position messages', () => {
    const parsed = parseWorkletToMainMessage({
      type: WORKLET_TO_MAIN.position,
      order: 'bad',
      row: 0,
      positionSeconds: 1,
      bpm: 125,
    });
    expect(parsed.ok).toBe(false);
  });

  it('rejects unknown message types', () => {
    const parsed = parseWorkletToMainMessage({ type: 'totally-unknown', foo: 1 });
    expect(parsed.ok).toBe(false);
  });

  it('validates oscBuffer SharedArrayBuffer size', () => {
    const smallSab = new SharedArrayBuffer(8);
    const parsed = parseWorkletToMainMessage({
      type: WORKLET_TO_MAIN.oscBuffer,
      buffer: smallSab,
    });
    expect(parsed.ok).toBe(false);

    const validSab = new SharedArrayBuffer(AUDIO_SAB_BYTES);
    const ok = parseWorkletToMainMessage({
      type: WORKLET_TO_MAIN.oscBuffer,
      buffer: validSab,
    });
    expect(ok.ok).toBe(true);
    expect(parseOscBufferMessage({ type: WORKLET_TO_MAIN.oscBuffer, buffer: validSab })).not.toBeNull();
  });

  it('accepts loaded / ended / seekAck / error variants', () => {
    expect(parseWorkletToMainMessage({ type: WORKLET_TO_MAIN.loaded }).ok).toBe(true);
    expect(parseWorkletToMainMessage({ type: WORKLET_TO_MAIN.ended }).ok).toBe(true);
    expect(parseWorkletToMainMessage({ type: WORKLET_TO_MAIN.seekAck }).ok).toBe(true);
    expect(
      parseWorkletToMainMessage({ type: WORKLET_TO_MAIN.error, message: 'boom' }).ok,
    ).toBe(true);
  });
});

describe('parseMainToWorkletMessage', () => {
  it('accepts typed outbound helpers', () => {
    const buf = new Uint8Array([1, 2, 3]);
    expect(parseMainToWorkletMessage(postPlay()).ok).toBe(true);
    expect(parseMainToWorkletMessage(postLoad(buf)).ok).toBe(true);
    expect(parseMainToWorkletMessage(postSeek(2, 16, 1.5)).ok).toBe(true);
  });

  it('rejects malformed load payloads', () => {
    expect(parseMainToWorkletMessage({ type: MAIN_TO_WORKLET.load }).ok).toBe(false);
    expect(parseMainToWorkletMessage({ type: MAIN_TO_WORKLET.seek, order: -1, row: 0 }).ok).toBe(false);
  });

  it('covers every declared message type string', () => {
    expect(ALL_MAIN_TO_WORKLET_TYPES.length).toBeGreaterThan(0);
    expect(ALL_WORKLET_TO_MAIN_TYPES.length).toBeGreaterThan(0);
    for (const t of ALL_MAIN_TO_WORKLET_TYPES) {
      expect(typeof t).toBe('string');
    }
    for (const t of ALL_WORKLET_TO_MAIN_TYPES) {
      expect(typeof t).toBe('string');
    }
  });
});
