import type { PatternMatrix } from '../../../types';
import type { WebGPURenderParams } from '../params';
import { resolveLiveChannels } from '../params';
import {
  packPatternMatrix,
  packPatternMatrixHighPrecision,
  packPatternMatrixComputeInput,
  createBufferWithData,
  buildRowFlags,
  fillChannelStates,
  verifyDurationParity,
  DEFAULT_ROWS,
  DEFAULT_CHANNELS,
} from '../../../utils/gpuPacking';
import {
  runNoteDurationCompute,
  canUseComputePath,
  readbackBuffer,
  type NoteDurationComputeState,
} from '../../../utils/computeNoteDuration';
import { usesHighPrecisionPacking, type LayoutType } from '../../../utils/shaderVersion';
import type { GpuResourcePool } from '../../../utils/gpuResourcePool';

const CELLS_USAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;

export interface CellsUploadOptions {
  device: GPUDevice;
  pool: GpuResourcePool;
  shaderFile: string;
  matrix: PatternMatrix | null;
  padTopChannel: boolean;
  liteMode: boolean;
  computeState: NoteDurationComputeState | null;
  releaseExisting?: boolean;
  onParityError?: (message: string) => void;
}

export interface CellsUploadResult {
  buffer: GPUBuffer;
}

export function uploadCellsBuffer(options: CellsUploadOptions): CellsUploadResult {
  const {
    device,
    pool,
    shaderFile,
    matrix,
    padTopChannel,
    liteMode,
    computeState,
    releaseExisting = false,
  } = options;

  const isHighPrec = usesHighPrecisionPacking(shaderFile);
  const useCompute = !liteMode && isHighPrec && computeState && canUseComputePath(matrix);

  if (useCompute) {
    const rawPacked = packPatternMatrixComputeInput(matrix, padTopChannel);
    const rawBuffer = pool.track(
      createBufferWithData(device, rawPacked.packedData, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
      'matrix',
    );
    const numRows = matrix?.numRows ?? DEFAULT_ROWS;
    const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
    const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;
    const buffer = pool.track(
      runNoteDurationCompute(device, computeState, rawBuffer, numRows, numChannels, padTopChannel),
      'matrix',
    );
    pool.destroyTracked(rawBuffer);

    if (import.meta.env.DEV && options.onParityError) {
      void (async () => {
        const gpuData = await readbackBuffer(device, buffer, buffer.size);
        if (gpuData) {
          const parity = verifyDurationParity(gpuData, matrix, padTopChannel);
          if (!parity.ok && parity.errorSummary) {
            options.onParityError!(parity.errorSummary);
          } else if (parity.ok) {
            console.log('[DURA-PARITY] ✓');
          }
        }
      })();
    }

    return { buffer };
  }

  const packFunc = isHighPrec ? packPatternMatrixHighPrecision : packPatternMatrix;
  const { packedData } = packFunc(matrix, padTopChannel);
  const buffer = pool.acquireBuffer('cells', packedData.byteLength, CELLS_USAGE, (buf) => {
    device.queue.writeBuffer(buf, 0, packedData.buffer, packedData.byteOffset, packedData.byteLength);
  }, 'matrix');

  if (releaseExisting) {
    void buffer;
  }

  return { buffer };
}

export interface ExtendedBuffersState {
  rowFlagsBuffer: GPUBuffer | null;
  channelsBuffer: GPUBuffer | null;
  channelBufferData: ArrayBuffer | null;
  channelDataView: DataView | null;
}

export interface ExtendedUploadOptions {
  device: GPUDevice;
  pool: GpuResourcePool;
  matrix: PatternMatrix | null;
  params: WebGPURenderParams;
  layoutType: LayoutType;
  /** When true, create empty channel buffer (shader init). When false, fill from live channels. */
  initEmpty: boolean;
  numChannelsOverride?: number;
}

export function uploadExtendedBuffers(
  options: ExtendedUploadOptions,
  state: ExtendedBuffersState,
): void {
  const { device, pool, matrix, params, layoutType, initEmpty, numChannelsOverride } = options;
  if (layoutType !== 'extended') return;

  const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
  const numChannels = numChannelsOverride ?? (params.padTopChannel ? rawChannels + 1 : rawChannels);
  const numRows = matrix?.numRows ?? DEFAULT_ROWS;

  const flags = buildRowFlags(numRows);
  if (!state.rowFlagsBuffer || state.rowFlagsBuffer.size < flags.byteLength) {
    if (state.rowFlagsBuffer) {
      pool.releaseBuffer('rowFlags', state.rowFlagsBuffer, CELLS_USAGE);
    }
    state.rowFlagsBuffer = pool.acquireBuffer('rowFlags', flags.byteLength, CELLS_USAGE, (buf) => {
      device.queue.writeBuffer(buf, 0, flags.buffer, flags.byteOffset, flags.byteLength);
    }, 'matrix');
  } else {
    device.queue.writeBuffer(state.rowFlagsBuffer, 0, flags.buffer, flags.byteOffset, flags.byteLength);
  }

  const channelsCount = initEmpty
    ? Math.max(1, rawChannels)
    : Math.max(1, numChannels - (params.padTopChannel ? 1 : 0));
  const totalCount = numChannels;
  const requiredSize = totalCount * 32;

  if (!state.channelBufferData || state.channelBufferData.byteLength < requiredSize) {
    state.channelBufferData = new ArrayBuffer(requiredSize);
    state.channelDataView = new DataView(state.channelBufferData);
  } else {
    new Uint8Array(state.channelBufferData).fill(0, 0, requiredSize);
  }

  if (initEmpty) {
    fillChannelStates([], channelsCount, state.channelDataView!, params.padTopChannel);
  } else {
    fillChannelStates(resolveLiveChannels(params), channelsCount, state.channelDataView!, params.padTopChannel);
  }

  if (!state.channelsBuffer || state.channelsBuffer.size < requiredSize) {
    if (state.channelsBuffer) {
      pool.releaseBuffer('channels', state.channelsBuffer, CELLS_USAGE);
    }
    state.channelsBuffer = pool.acquireBuffer('channels', requiredSize, CELLS_USAGE, (buf) => {
      device.queue.writeBuffer(buf, 0, state.channelBufferData!);
    }, 'matrix');
  } else {
    device.queue.writeBuffer(state.channelsBuffer, 0, state.channelBufferData!, 0, requiredSize);
  }
}

export function syncChannelBuffer(
  device: GPUDevice,
  pool: GpuResourcePool,
  params: WebGPURenderParams,
  state: ExtendedBuffersState,
): boolean {
  const count = Math.max(1, params.matrix?.numChannels ?? DEFAULT_CHANNELS);
  const totalCount = params.padTopChannel ? count + 1 : count;
  const requiredSize = totalCount * 32;

  if (!state.channelBufferData || state.channelBufferData.byteLength < requiredSize) {
    state.channelBufferData = new ArrayBuffer(requiredSize);
    state.channelDataView = new DataView(state.channelBufferData);
  } else {
    new Uint8Array(state.channelBufferData).fill(0, 0, requiredSize);
  }

  fillChannelStates(resolveLiveChannels(params), count, state.channelDataView!, params.padTopChannel);

  let recreated = false;
  if (!state.channelsBuffer || state.channelsBuffer.size < requiredSize) {
    if (state.channelsBuffer) {
      pool.releaseBuffer('channels', state.channelsBuffer, CELLS_USAGE);
    }
    state.channelsBuffer = pool.acquireBuffer('channels', requiredSize, CELLS_USAGE, (buf) => {
      device.queue.writeBuffer(buf, 0, state.channelBufferData!);
    }, 'matrix');
    recreated = true;
  } else {
    device.queue.writeBuffer(state.channelsBuffer, 0, state.channelBufferData!, 0, requiredSize);
  }

  return recreated;
}

export function assertCellsBufferSize(
  buffer: GPUBuffer | null,
  numRows: number,
  numChannels: number,
): void {
  if (!import.meta.env?.DEV || !buffer) return;
  const expectedBytes = numRows * numChannels * 2 * 4;
  if (buffer.size !== expectedBytes) {
    console.error(
      `[WebGPURenderer INVARIANT] cells buffer size mismatch. ` +
      `bufferSize=${buffer.size}, expectedBytes=${expectedBytes}, ` +
      `expectedCells=${numRows * numChannels}`,
    );
  }
}

export { CELLS_USAGE };
