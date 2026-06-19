import { LITE_MAX_VISIBLE_ROWS } from './geometryConstants';
import { probeWebGPUAdapter } from '../src/renderers/rendererSelection';

export interface DeviceCapabilities {
  isLite: boolean;
  reason: string;
  maxVisibleRows: number;
  bloom: 'off' | 'single' | 'full';
  preferredShaderId: string;
}

const LITE_PREFERRED_SHADER = 'patternv0.21.wgsl';
const DEFAULT_DESKTOP_SHADER = 'patternv0.50.wgsl';

function detectCapabilities(): DeviceCapabilities {
  const params = new URLSearchParams(window.location.search);
  const urlLite = params.get('lite');
  if (urlLite === '1') {
    return {
      isLite: true,
      reason: 'url_override_on',
      maxVisibleRows: LITE_MAX_VISIBLE_ROWS,
      bloom: 'off',
      preferredShaderId: LITE_PREFERRED_SHADER,
    };
  }
  if (urlLite === '0') {
    return {
      isLite: false,
      reason: 'url_override_off',
      maxVisibleRows: 64,
      bloom: 'full',
      preferredShaderId: DEFAULT_DESKTOP_SHADER,
    };
  }

  try {
    const stored = localStorage.getItem('xasm1_lite_mode');
    if (stored === '1') {
      return {
        isLite: true,
        reason: 'localstorage_override_on',
        maxVisibleRows: LITE_MAX_VISIBLE_ROWS,
        bloom: 'off',
        preferredShaderId: LITE_PREFERRED_SHADER,
      };
    }
    if (stored === '0') {
      return {
        isLite: false,
        reason: 'localstorage_override_off',
        maxVisibleRows: 64,
        bloom: 'full',
        preferredShaderId: DEFAULT_DESKTOP_SHADER,
      };
    }
  } catch { /* ignore quota/security errors */ }

  const isMobile =
    (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile ??
    /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if (isMobile) {
    return {
      isLite: true,
      reason: 'mobile_detected',
      maxVisibleRows: LITE_MAX_VISIBLE_ROWS,
      bloom: 'off',
      preferredShaderId: LITE_PREFERRED_SHADER,
    };
  }

  if (!('gpu' in navigator)) {
    return {
      isLite: true,
      reason: 'webgpu_missing',
      maxVisibleRows: LITE_MAX_VISIBLE_ROWS,
      bloom: 'off',
      preferredShaderId: LITE_PREFERRED_SHADER,
    };
  }

  return {
    isLite: false,
    reason: 'desktop_default',
    maxVisibleRows: 64,
    bloom: 'full',
    preferredShaderId: DEFAULT_DESKTOP_SHADER,
  };
}

export const DEVICE_CAPABILITIES: DeviceCapabilities = detectCapabilities();

// Fire-and-forget async GPU adapter inspection for low-power hints.
// Only refines the decision if no manual override is active.
if (!DEVICE_CAPABILITIES.reason.includes('override')) {
  probeWebGPUAdapter()
    .then((adapterOk) => {
      if (!adapterOk) return;
      return navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
    })
    .then((adapter) => {
      if (!adapter) return;
      const info = adapter.info as GPUAdapterInfo | undefined;
      if (!info) return;
      const vendor = info.vendor?.toLowerCase() ?? '';
      const arch = info.architecture?.toLowerCase() ?? '';
      const isIntegrated =
        vendor.includes('intel') ||
        arch.includes('intel') ||
        arch.includes('integrated');
      if (isIntegrated && !DEVICE_CAPABILITIES.reason.includes('mobile')) {
        DEVICE_CAPABILITIES.isLite = true;
        DEVICE_CAPABILITIES.reason = 'integrated_gpu';
        DEVICE_CAPABILITIES.maxVisibleRows = LITE_MAX_VISIBLE_ROWS;
        DEVICE_CAPABILITIES.bloom = 'off';
        DEVICE_CAPABILITIES.preferredShaderId = LITE_PREFERRED_SHADER;
      }
    })
    .catch(() => {});
}

export function setLiteOverride(value: boolean | null): void {
  try {
    if (value === null) {
      localStorage.removeItem('xasm1_lite_mode');
    } else {
      localStorage.setItem('xasm1_lite_mode', value ? '1' : '0');
    }
  } catch {
    /* ignore */
  }
  const refreshed = detectCapabilities();
  DEVICE_CAPABILITIES.isLite = refreshed.isLite;
  DEVICE_CAPABILITIES.reason = refreshed.reason;
  DEVICE_CAPABILITIES.maxVisibleRows = refreshed.maxVisibleRows;
  DEVICE_CAPABILITIES.bloom = refreshed.bloom;
  DEVICE_CAPABILITIES.preferredShaderId = refreshed.preferredShaderId;
}
