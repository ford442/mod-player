/**
 * #492: the main thread (zod, audio-worklet/protocol.ts) and the worklet (allocation-free guard,
 * audio-worklet/workletProtocolGuard.ts) validate the postMessage protocol from ONE table
 * (audio-worklet/workletProtocolConstants.ts). This runs every message type of both directions —
 * valid, at the boundaries, and broken field by field — through both validators and requires the
 * same verdict, so a rule cannot exist on one side only.
 */
import { describe, expect, it } from 'vitest';
import {
  LEGACY_LOAD_SPEC,
  MAIN_TO_WORKLET,
  MAIN_TO_WORKLET_SPEC,
  MAX_VU_CHANNELS,
  OSC_BUFFER_MIN_BYTES,
  WORKLET_TO_MAIN,
  WORKLET_TO_MAIN_SPEC,
  type FieldSpec,
  type MessageSpec,
} from '../audio-worklet/workletProtocolConstants';
import {
  fieldValueMatches,
  validateMainToWorklet,
  validateWorkletToMain,
} from '../audio-worklet/workletProtocolGuard';
import {
  parseMainToWorkletMessage,
  parseWorkletToMainMessage,
  postCtlSetText,
  postGetOscBuffer,
  postInitLib,
  postLoad,
  postPause,
  postPlay,
  postReturnPcmBuffer,
  postSeek,
  postSetAudioDiag,
  postSetAudioLite,
  postSetChannelMute,
  postSetPositionRing,
  postSetProjectmPcm,
  postSetRenderParam,
} from '../audio-worklet/protocol';
import { AUDIO_SAB_BYTES } from '../utils/audioReactive';

/** A valid value for a field kind. */
function validValue(spec: FieldSpec): unknown {
  switch (spec.kind) {
    case 'nonNegInt': return 3;
    case 'finite': return 1.5;
    case 'boolean': return true;
    case 'string': return 'x';
    case 'nonEmptyString': return 'x';
    case 'arrayBuffer': return new ArrayBuffer(8);
    case 'modulePayload': return new Uint8Array(4);
    case 'float32Array': return new Float32Array(4);
    case 'sharedArrayBuffer': return new SharedArrayBuffer(spec.minBytes ?? 64);
    case 'finiteArray': return [0.5, 1];
    case 'pcmChannels': return 2;
  }
}

/** Values at the edge of the kind that must still be accepted. */
function boundaryValues(spec: FieldSpec): unknown[] {
  switch (spec.kind) {
    case 'nonNegInt': return [0, Number.MAX_SAFE_INTEGER];
    case 'finite': return [0, -1e308, Number.MIN_VALUE];
    case 'string': return [''];
    case 'arrayBuffer': return [new ArrayBuffer(0)];
    case 'modulePayload': return [new ArrayBuffer(4)];
    case 'sharedArrayBuffer': return spec.minBytes ? [new SharedArrayBuffer(spec.minBytes)] : [new SharedArrayBuffer(1)];
    case 'finiteArray': return [[], new Array(spec.maxLength ?? 128).fill(0)];
    case 'pcmChannels': return [1];
    default: return [];
  }
}

/** Values the kind must reject. */
function invalidValues(spec: FieldSpec): unknown[] {
  const common = [null, {}, Symbol.for('x')];
  switch (spec.kind) {
    case 'nonNegInt': return [...common, -1, 1.5, Number.NaN, Infinity, 2 ** 53, '3', true];
    case 'finite': return [...common, Number.NaN, Infinity, -Infinity, '1', false];
    case 'boolean': return [...common, 1, 'true'];
    case 'string': return [...common, 3, false];
    case 'nonEmptyString': return [...common, '', 3];
    case 'arrayBuffer': return [...common, new Uint8Array(4), new SharedArrayBuffer(4), 'x'];
    case 'modulePayload': return [...common, [1, 2], 'x', new Float32Array(2)];
    case 'float32Array': return [...common, new Float64Array(4), [1, 2], new ArrayBuffer(8)];
    case 'sharedArrayBuffer':
      return [
        ...common,
        new ArrayBuffer(spec.minBytes ?? 64),
        ...(spec.minBytes ? [new SharedArrayBuffer(spec.minBytes - 1)] : []),
      ];
    case 'finiteArray':
      return [
        ...common,
        [Number.NaN],
        [1, Infinity],
        ['1'],
        'x',
        new Float32Array(2),
        ...(spec.maxLength !== undefined ? [new Array(spec.maxLength + 1).fill(0)] : []),
      ];
    case 'pcmChannels': return [...common, 0, 3, '2', 1.5];
  }
}

function build(type: string | undefined, spec: MessageSpec, withOptional: boolean): Record<string, unknown> {
  const msg: Record<string, unknown> = type === undefined ? {} : { type };
  for (const [name, field] of Object.entries(spec.fields)) {
    if (field.optional && !withOptional) continue;
    msg[name] = validValue(field);
  }
  return msg;
}

interface Case {
  label: string;
  data: unknown;
  valid: boolean;
}

function casesFor(type: string | undefined, spec: MessageSpec): Case[] {
  const cases: Case[] = [
    { label: 'all fields', data: build(type, spec, true), valid: true },
    { label: 'required fields only', data: build(type, spec, false), valid: true },
    { label: 'unknown extra field', data: { ...build(type, spec, true), extra: 'kept or dropped' }, valid: true },
  ];
  for (const [name, field] of Object.entries(spec.fields)) {
    const withField = (value: unknown) => ({ ...build(type, spec, true), [name]: value });
    const without = build(type, spec, true);
    delete without[name];
    cases.push({ label: `${name} absent`, data: without, valid: Boolean(field.optional) });
    cases.push({ label: `${name} = undefined`, data: withField(undefined), valid: Boolean(field.optional) });
    for (const value of boundaryValues(field)) {
      cases.push({ label: `${name} = boundary ${show(value)}`, data: withField(value), valid: true });
    }
    for (const value of invalidValues(field)) {
      cases.push({ label: `${name} = ${show(value)}`, data: withField(value), valid: false });
    }
  }
  return cases;
}

function show(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) return `${value.constructor.name}(${value.byteLength})`;
  if (ArrayBuffer.isView(value)) return `${value.constructor.name}(${(value as Uint8Array).length})`;
  if (typeof value === 'symbol') return 'symbol';
  return JSON.stringify(value) ?? String(value);
}

const zodWorkletToMain = (data: unknown) => parseWorkletToMainMessage(data).ok;
const zodMainToWorklet = (data: unknown) => parseMainToWorkletMessage(data).ok;
const guardWorkletToMain = (data: unknown) => validateWorkletToMain(data) !== null;
const guardMainToWorklet = (data: unknown) => validateMainToWorklet(data) !== null;

function expectParity(cases: Case[], zod: (d: unknown) => boolean, guard: (d: unknown) => boolean): void {
  const disagreements = cases
    .map((c) => ({ ...c, zod: zod(c.data), guard: guard(c.data) }))
    .filter((c) => c.zod !== c.guard || c.zod !== c.valid)
    .map((c) => `${c.label}: expected ${c.valid ? 'accept' : 'reject'}, zod ${c.zod ? 'accepts' : 'rejects'}, guard ${c.guard ? 'accepts' : 'rejects'}`);
  expect(disagreements).toEqual([]);
}

describe('worklet protocol: zod and the worklet guard agree (one table, #492)', () => {
  describe.each(Object.entries(WORKLET_TO_MAIN_SPEC))('worklet → main %s', (type, spec) => {
    it('accepts and rejects exactly the same messages', () => {
      expectParity(casesFor(type, spec), zodWorkletToMain, guardWorkletToMain);
    });
  });

  describe.each(Object.entries(MAIN_TO_WORKLET_SPEC))('main → worklet %s', (type, spec) => {
    it('accepts and rejects exactly the same messages', () => {
      expectParity(casesFor(type, spec), zodMainToWorklet, guardMainToWorklet);
    });
  });

  it('main → worklet legacy load shim ({ moduleData }, no type)', () => {
    expectParity(casesFor(undefined, LEGACY_LOAD_SPEC), zodMainToWorklet, guardMainToWorklet);
  });

  it('agree on messages that are not messages', () => {
    const notMessages: Case[] = [null, undefined, 3, 'position', [], [{ type: 'play' }], { type: 'nope' }, { type: 7 }]
      .map((data) => ({ label: show(data), data, valid: false }));
    expectParity(notMessages, zodWorkletToMain, guardWorkletToMain);
    expectParity(notMessages, zodMainToWorklet, guardMainToWorklet);
  });

  it('covers every message type constant', () => {
    expect(Object.keys(WORKLET_TO_MAIN_SPEC).sort()).toEqual(Object.values(WORKLET_TO_MAIN).sort());
    expect(Object.keys(MAIN_TO_WORKLET_SPEC).sort()).toEqual(Object.values(MAIN_TO_WORKLET).sort());
  });

  it('round-trips every outbound helper through both validators', () => {
    const outbound = [
      postInitLib('glue', new ArrayBuffer(8)),
      postInitLib('glue'),
      postLoad(new Uint8Array(4)),
      postLoad(new ArrayBuffer(4)),
      postPlay(),
      postPause(),
      postSeek(2, 16, 1.25),
      postSeek(0, 0),
      postGetOscBuffer(),
      postSetAudioLite(true),
      postSetProjectmPcm(false),
      postSetAudioDiag(true),
      postSetChannelMute(5, true),
      postSetRenderParam(3, 8),
      postCtlSetText('play.at_end', 'continue'),
      postReturnPcmBuffer(new Float32Array(new ArrayBuffer(16))),
      postSetPositionRing(new SharedArrayBuffer(64)),
    ];
    expect(new Set(outbound.map((m) => m.type)).size).toBe(Object.keys(MAIN_TO_WORKLET_SPEC).length);
    for (const message of outbound) {
      expect(zodMainToWorklet(message), message.type).toBe(true);
      expect(guardMainToWorklet(message), message.type).toBe(true);
    }
  });

  it('keeps the table constants in step with their sources of truth', () => {
    expect(OSC_BUFFER_MIN_BYTES).toBe(AUDIO_SAB_BYTES);
    expect(WORKLET_TO_MAIN_SPEC.position.fields.channelVU.maxLength).toBe(MAX_VU_CHANNELS);
    expect(MAX_VU_CHANNELS).toBe(64);
    expect(fieldValueMatches({ kind: 'finiteArray', maxLength: MAX_VU_CHANNELS }, new Array(64).fill(0.5))).toBe(true);
  });
});
