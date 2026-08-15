/**
 * WebGPU boot probe report — hard-fail surface for PatternDisplay.
 *
 * Phase policy: WebGPU is required for the GPU viz session. Probe fail does
 * **not** auto-start WebGL2/HTML shader backends. Tracker audio may continue.
 */

export type WebGPUProbeStage =
  | 'api'
  | 'adapter'
  | 'device'
  | 'canvas'
  | 'ready'
  | 'lost';

export interface WebGPUProbeAdapterInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

export interface WebGPUProbeReport {
  ok: boolean;
  stage: WebGPUProbeStage;
  browserBrand: string;
  userAgent: string;
  error?: string;
  adapterInfo?: WebGPUProbeAdapterInfo;
  timestamp: number;
  /** When true, further requestDevice() calls are blocked this session. */
  sessionBlocked: boolean;
}

declare global {
  interface Window {
    /** Latest WebGPU probe / device lifecycle report (debug overlay + tests). */
    __WEBGPU_PROBE__?: WebGPUProbeReport;
  }
}

let sessionHardFailReason: string | null = null;
let lastReport: WebGPUProbeReport | null = null;

/** Detect Chrome / Edge / other for probe logs (navigator.userAgentData when present). */
export function detectBrowserBrand(
  nav: Navigator = typeof navigator !== 'undefined' ? navigator : ({} as Navigator),
): string {
  const uaData = (nav as Navigator & {
    userAgentData?: { brands?: Array<{ brand: string; version: string }> };
  }).userAgentData;
  if (uaData?.brands?.length) {
    const brands = uaData.brands.map((b) => b.brand).filter((b) => !/not.?a.?brand/i.test(b));
    if (brands.some((b) => /edg/i.test(b))) return 'Edge';
    if (brands.some((b) => /chrome/i.test(b))) return 'Chrome';
    if (brands.some((b) => /chromium/i.test(b))) return 'Chromium';
    if (brands[0]) return brands[0];
  }
  const ua = nav.userAgent ?? '';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  return 'Unknown';
}

export function isWebGPUSessionBlocked(): boolean {
  return sessionHardFailReason != null;
}

export function getWebGPUSessionBlockReason(): string | null {
  return sessionHardFailReason;
}

export function getLastWebGPUProbeReport(): WebGPUProbeReport | null {
  return lastReport;
}

/** Test helper. */
export function resetWebGPUProbeStateForTests(): void {
  sessionHardFailReason = null;
  lastReport = null;
  if (typeof window !== 'undefined') {
    try {
      delete window.__WEBGPU_PROBE__;
    } catch {
      /* ignore */
    }
  }
}

function publish(report: WebGPUProbeReport): WebGPUProbeReport {
  lastReport = report;
  if (typeof window !== 'undefined') {
    window.__WEBGPU_PROBE__ = report;
  }
  return report;
}

export function publishWebGPUProbeReport(
  partial: Omit<WebGPUProbeReport, 'timestamp' | 'sessionBlocked' | 'browserBrand' | 'userAgent'> & {
    browserBrand?: string;
    userAgent?: string;
    sessionBlocked?: boolean;
  },
): WebGPUProbeReport {
  const browserBrand = partial.browserBrand ?? detectBrowserBrand();
  const userAgent =
    partial.userAgent
    ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const sessionBlocked = partial.sessionBlocked ?? isWebGPUSessionBlocked();
  const report: WebGPUProbeReport = {
    ok: partial.ok,
    stage: partial.stage,
    browserBrand,
    userAgent,
    timestamp: Date.now(),
    sessionBlocked,
  };
  if (partial.error != null) report.error = partial.error;
  if (partial.adapterInfo != null) report.adapterInfo = partial.adapterInfo;
  return publish(report);
}

/**
 * Mark this page session as WebGPU hard-failed. Subsequent
 * `requestWebGPUDevice` calls must not call `requestDevice()` (#395).
 */
export function markWebGPUSessionFailed(
  stage: WebGPUProbeStage,
  error: string,
  adapterInfo?: WebGPUProbeAdapterInfo,
): WebGPUProbeReport {
  sessionHardFailReason = error;
  const report = publishWebGPUProbeReport({
    ok: false,
    stage,
    error,
    sessionBlocked: true,
    ...(adapterInfo ? { adapterInfo } : {}),
  });
  console.error(
    `[WebGPU probe] HARD FAIL (${report.browserBrand}) stage=${stage}: ${error}`,
    adapterInfo ?? '',
  );
  return report;
}

export function publishWebGPUProbeReady(
  adapterInfo?: WebGPUProbeAdapterInfo,
): WebGPUProbeReport {
  sessionHardFailReason = null;
  return publishWebGPUProbeReport({
    ok: true,
    stage: 'ready',
    sessionBlocked: false,
    ...(adapterInfo ? { adapterInfo } : {}),
  });
}

/** Best-effort adapter info (async `adapter.requestAdapterInfo` when available). */
export async function readAdapterInfo(
  adapter: GPUAdapter,
): Promise<WebGPUProbeAdapterInfo | undefined> {
  try {
    const withInfo = adapter as GPUAdapter & {
      requestAdapterInfo?: () => Promise<{
        vendor?: string;
        architecture?: string;
        device?: string;
        description?: string;
      }>;
      info?: {
        vendor?: string;
        architecture?: string;
        device?: string;
        description?: string;
      };
    };
    if (typeof withInfo.requestAdapterInfo === 'function') {
      const info = await withInfo.requestAdapterInfo();
      return {
        ...(info.vendor != null ? { vendor: info.vendor } : {}),
        ...(info.architecture != null ? { architecture: info.architecture } : {}),
        ...(info.device != null ? { device: info.device } : {}),
        ...(info.description != null ? { description: info.description } : {}),
      };
    }
    if (withInfo.info) {
      const info = withInfo.info;
      return {
        ...(info.vendor != null ? { vendor: info.vendor } : {}),
        ...(info.architecture != null ? { architecture: info.architecture } : {}),
        ...(info.device != null ? { device: info.device } : {}),
        ...(info.description != null ? { description: info.description } : {}),
      };
    }
  } catch {
    /* ignore */
  }
  return undefined;
}
