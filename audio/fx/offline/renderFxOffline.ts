/**
 * WAV export through the FX rack (#453): the libopenmpt render (dry, from the
 * export worker) pushed through an OfflineAudioContext built by the same
 * buildFxGraph() the live rack is — so what you hear is what you export.
 *
 * OfflineAudioContext exists only on the main thread, so this runs there,
 * lazily imported by hooks/useOfflineExport.ts when the rack is on.
 *
 * - The state goes through its serialized form first (exactly what a preset or
 *   the store would hand over).
 * - The render is extended by the rack's latency + tail (compressor
 *   look-ahead, character resampler delay, room IR) so nothing is cut off; the
 *   latency is kept, as in live playback.
 * - Each OfflineAudioContext needs its own worklet addModule and its own IR
 *   decode at its own rate; the rack's loaders handle both.
 */
import { CHARACTER_LATENCY_FRAMES } from '../../../audio-worklet/fxCharacterParams';
import { buildFxGraph } from '../buildFxGraph';
import { COMP_LOOKAHEAD_S } from '../modules/compModule';
import { IR_MANIFEST } from '../room/irCatalog';
import type { IrLoader } from '../room/irLoader';
import { parseFxRackState } from '../spec/schema';
import { isModuleActive, type FxRackState } from '../types';

export interface DryRender {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

export interface RenderFxOfflineOptions {
  characterWorkletUrl?: string;
  irLoader?: IrLoader;
  /** 0…1 as the offline render advances (browsers; uses suspend()). */
  onProgress?: (fraction: number) => void;
}

export interface FxOfflineResult {
  left: Float32Array;
  right: Float32Array;
  /**
   * The rendered buffer `left` / `right` view. Kept referenced on purpose:
   * some engines (node-web-audio-api) free a buffer's native memory when the
   * AudioBuffer object is collected, even while channel views are alive.
   */
  buffer: AudioBuffer;
  sampleRate: number;
  /** Seconds appended after the dry render (latency + tails). */
  tailSeconds: number;
  /** Things the export did differently from live playback (e.g. room unavailable here). */
  warnings: string[];
}

/** Peak bytes per stereo frame: dry input, source buffer, rendered output, WAV encode. */
const BYTES_PER_FRAME = 28;
/** Beyond this the export would likely exhaust a tab's memory. */
export const FX_EXPORT_MAX_BYTES = 1.5 * 1024 ** 3;
const TAIL_MARGIN_S = 0.05;

export class FxExportTooLongError extends Error {
  constructor(readonly seconds: number) {
    super(
      `A ${Math.round(seconds / 60)}-minute export through the FX rack needs too much memory. ` +
        'Export a shorter range, or switch the rack off for a dry export.',
    );
    this.name = 'FxExportTooLongError';
  }
}

/** Latency + tail of the active modules, from the state alone (sizes the offline context). */
export function fxTailSeconds(state: FxRackState, sampleRate: number): number {
  let tail = 0;
  if (isModuleActive(state, 'character')) tail += (2 * CHARACTER_LATENCY_FRAMES) / sampleRate;
  if (isModuleActive(state, 'comp')) tail += 2 * COMP_LOOKAHEAD_S;
  if (isModuleActive(state, 'room')) {
    const room = state.modules.room.params;
    tail += (IR_MANIFEST[room.ir]?.durationSeconds ?? 1) + room.predelay / 1000;
  }
  return tail > 0 ? tail + TAIL_MARGIN_S : 0;
}

export function assertExportFits(frames: number, sampleRate: number): void {
  if (frames * BYTES_PER_FRAME > FX_EXPORT_MAX_BYTES) throw new FxExportTooLongError(frames / sampleRate);
}

export async function renderFxOffline(
  dry: DryRender,
  state: FxRackState,
  opts: RenderFxOfflineOptions = {},
): Promise<FxOfflineResult> {
  const fx = parseFxRackState(JSON.parse(JSON.stringify(state)));
  const { sampleRate } = dry;
  const dryFrames = Math.min(dry.left.length, dry.right.length);
  const tailSeconds = fxTailSeconds(fx, sampleRate);
  const length = dryFrames + Math.ceil(tailSeconds * sampleRate);
  assertExportFits(length, sampleRate);

  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  const rack = await buildFxGraph(ctx, fx, {
    ...(opts.characterWorkletUrl ? { characterWorkletUrl: opts.characterWorkletUrl } : {}),
    ...(opts.irLoader ? { irLoader: opts.irLoader } : {}),
  });
  const warnings: string[] = [];
  if (rack.unavailable.has('room') && isModuleActive(fx, 'room')) {
    warnings.push('Room IRs could not be loaded in this browser — exported without the room.');
  }

  // The source spans the whole render, zero-padded past the song — like the
  // live engine, which keeps producing silence. A source that *ends* mid-render
  // puts Chrome's downstream nodes into tail handling, and the room's tail then
  // no longer matches what playback produces.
  const source = ctx.createBufferSource();
  const buffer = ctx.createBuffer(2, length, sampleRate);
  buffer.copyToChannel(dry.left.subarray(0, dryFrames) as Float32Array<ArrayBuffer>, 0);
  buffer.copyToChannel(dry.right.subarray(0, dryFrames) as Float32Array<ArrayBuffer>, 1);
  source.buffer = buffer;
  source.connect(rack.input);
  rack.output.connect(ctx.destination);
  source.start(0);

  if (opts.onProgress) {
    const report = opts.onProgress;
    const duration = length / sampleRate;
    for (let step = 1; step < 10; step++) {
      const at = (duration * step) / 10;
      ctx.suspend(at).then(
        () => {
          report(step / 10);
          void ctx.resume();
        },
        () => {
          /* a progress tick is best-effort */
        },
      );
    }
  }

  const rendered = await ctx.startRendering();
  rack.dispose();
  return {
    left: rendered.getChannelData(0),
    right: rendered.getChannelData(1),
    buffer: rendered,
    sampleRate,
    tailSeconds,
    warnings,
  };
}
