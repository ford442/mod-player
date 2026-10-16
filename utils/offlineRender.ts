import type { LibOpenMPT } from '../types';
import { EXPORT_SAMPLE_RATE } from './wavEncoder';
import {
  applyChannelMuteMask,
  createExtModuleFromMemory,
  destroyExtModule,
  type OpenMPTExtModule,
} from './libopenmptExt';
import {
  INTERPOLATION_SINC_LP,
  OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH,
} from './openmptRenderParams';

const CHUNK_FRAMES = 4096;

export interface OfflineRenderRequest {
  fileData: Uint8Array;
  sampleRate?: number;
  /** When false, render until module end (respect repeat count). Default true. */
  loop?: boolean;
  /** Per-channel mute flags; length may be shorter than numChannels. */
  muteMask?: boolean[];
  startSeconds?: number;
  endSeconds?: number;
}

export interface OfflineRenderResult {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  metadataDurationSeconds: number;
  renderedDurationSeconds: number;
  frameCount: number;
}

/**
 * Live playback pulls libopenmpt one AudioWorklet render quantum at a time, and its float mixer
 * rounds differently depending on how many frames each call asks for (a 4096-frame read drifts
 * ~1e-6 from 32 × 128). Reading in the same quanta makes the export bit-identical to what played
 * (#490, tests/exportLiveParity.test.ts); a crush/bit-depth stage in the FX rack would otherwise
 * turn that sub-LSB drift into whole quantization steps.
 */
const RENDER_QUANTUM_FRAMES = 128;

function readChunk(
  lib: LibOpenMPT,
  modPtr: number,
  sampleRate: number,
  frames: number,
  leftPtr: number,
  rightPtr: number,
): number {
  let total = 0;
  while (total < frames) {
    const want = Math.min(RENDER_QUANTUM_FRAMES, frames - total);
    const written = lib._openmpt_module_read_float_stereo(
      modPtr,
      sampleRate,
      want,
      leftPtr + 4 * total,
      rightPtr + 4 * total,
    );
    total += written;
    if (written < want) break;
  }
  return total;
}

/**
 * Offline faster-than-realtime render using libopenmpt in a worker or main thread.
 * Uses the ext interactive interface when a mute mask is provided.
 */
export function renderModuleOffline(
  lib: LibOpenMPT,
  request: OfflineRenderRequest,
): OfflineRenderResult {
  const sampleRate = request.sampleRate ?? EXPORT_SAMPLE_RATE;
  const filePtr = lib._malloc(request.fileData.byteLength);
  lib.HEAPU8.set(request.fileData, filePtr);

  let extHandle: OpenMPTExtModule | null = null;
  let modPtr = 0;

  try {
    if (request.muteMask && request.muteMask.some(Boolean)) {
      extHandle = createExtModuleFromMemory(lib, filePtr, request.fileData.byteLength);
      modPtr = extHandle.modPtr;
      const numChannels = lib._openmpt_module_get_num_channels(modPtr);
      applyChannelMuteMask(lib, extHandle, request.muteMask, numChannels);
    } else {
      modPtr = lib._openmpt_module_create_from_memory2(
        filePtr,
        request.fileData.byteLength,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      );
      if (!modPtr) {
        throw new Error('openmpt_module_create_from_memory2 returned 0');
      }
    }

    lib._openmpt_module_set_render_param(
      modPtr,
      OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH,
      INTERPOLATION_SINC_LP,
    );

    if (request.loop === false) {
      lib._openmpt_module_set_repeat_count(modPtr, 0);
    }

    const metadataDurationSeconds = lib._openmpt_module_get_duration_seconds(modPtr);
    const startSeconds = request.startSeconds ?? 0;
    const endSeconds = request.endSeconds ?? metadataDurationSeconds;

    if (startSeconds > 0) {
      lib._openmpt_module_set_position_seconds(modPtr, startSeconds);
    }

    const leftPtr = lib._malloc(4 * CHUNK_FRAMES);
    const rightPtr = lib._malloc(4 * CHUNK_FRAMES);

    const leftChunks: Float32Array[] = [];
    const rightChunks: Float32Array[] = [];
    let totalFrames = 0;
    const targetFrames = Math.ceil(Math.max(0, endSeconds - startSeconds) * sampleRate);

    try {
      while (true) {
        const positionBefore = lib._openmpt_module_get_position_seconds(modPtr);
        if (positionBefore >= endSeconds - 1e-9) break;

        const written = readChunk(lib, modPtr, sampleRate, CHUNK_FRAMES, leftPtr, rightPtr);
        if (written <= 0) break;

        const leftView = new Float32Array(lib.HEAPF32.buffer, leftPtr, written);
        const rightView = new Float32Array(lib.HEAPF32.buffer, rightPtr, written);
        leftChunks.push(new Float32Array(leftView));
        rightChunks.push(new Float32Array(rightView));
        totalFrames += written;

        if (targetFrames > 0 && totalFrames >= targetFrames) break;

        const positionAfter = lib._openmpt_module_get_position_seconds(modPtr);
        if (positionAfter >= endSeconds - 1e-9) break;
        if (positionAfter <= positionBefore + 1e-12 && written < CHUNK_FRAMES) break;
      }
    } finally {
      lib._free(leftPtr);
      lib._free(rightPtr);
    }

    const left = new Float32Array(totalFrames);
    const right = new Float32Array(totalFrames);
    let offset = 0;
    for (let i = 0; i < leftChunks.length; i++) {
      const chunkL = leftChunks[i];
      const chunkR = rightChunks[i];
      if (!chunkL || !chunkR) continue;
      left.set(chunkL, offset);
      right.set(chunkR, offset);
      offset += chunkL.length;
    }

    return {
      left,
      right,
      sampleRate,
      metadataDurationSeconds,
      renderedDurationSeconds: totalFrames / sampleRate,
      frameCount: totalFrames,
    };
  } finally {
    if (extHandle) {
      destroyExtModule(lib, extHandle);
    } else if (modPtr) {
      lib._openmpt_module_destroy(modPtr);
    }
    lib._free(filePtr);
  }
}
