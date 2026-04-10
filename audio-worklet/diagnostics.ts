/**
 * AUDIO-001: AudioWorklet Diagnostics
 * 
 * This module provides diagnostic utilities for debugging AudioWorklet loading issues.
 * Use these functions to troubleshoot worklet initialization failures.
 */

export interface WorkletDiagnostics {
  audioContextSupported: boolean;
  audioWorkletSupported: boolean;
  crossOriginIsolated: boolean;
  userAgent: string;
  baseUrl: string;
  workletUrl: string;
  timestamp: string;
}

export interface WorkletLoadResult {
  success: boolean;
  error?: string;
  loadTimeMs?: number;
  diagnostics?: WorkletDiagnostics;
}

/**
 * Get comprehensive diagnostics about the browser's AudioWorklet support
 */
export function getWorkletDiagnostics(workletUrl: string): WorkletDiagnostics {
  return {
    audioContextSupported: typeof window !== 'undefined' && 'AudioContext' in window,
    audioWorkletSupported: typeof window !== 'undefined' && 
      'AudioContext' in window && 
      'audioWorklet' in AudioContext.prototype,
    crossOriginIsolated: window.crossOriginIsolated,
    userAgent: navigator.userAgent,
    baseUrl: import.meta.env.BASE_URL,
    workletUrl,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Log worklet diagnostics to console
 */
export function logWorkletDiagnostics(workletUrl: string): void {
  const diag = getWorkletDiagnostics(workletUrl);
  
  console.group('🔊 AudioWorklet Diagnostics');
  console.log('AudioContext Supported:', diag.audioContextSupported ? '✅' : '❌');
  console.log('AudioWorklet Supported:', diag.audioWorkletSupported ? '✅' : '❌');
  console.log('Cross-Origin Isolated:', diag.crossOriginIsolated ? '✅' : '❌');
  console.log('Base URL:', diag.baseUrl);
  console.log('Worklet URL:', diag.workletUrl);
  console.log('User Agent:', diag.userAgent.substring(0, 80) + '...');
  console.groupEnd();
}

/**
 * Check if the worklet file is accessible via fetch
 * This can help diagnose CORS and 404 issues
 */
export async function checkWorkletAccessibility(workletUrl: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const response = await fetch(workletUrl, { method: 'HEAD' });
    if (response.ok) {
      return { ok: true, status: response.status };
    } else {
      return { 
        ok: false, 
        status: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }
  } catch (e) {
    return { 
      ok: false, 
      error: (e as Error).message 
    };
  }
}

/**
 * Test worklet loading with detailed error reporting
 */
export async function testWorkletLoading(workletUrl: string): Promise<WorkletLoadResult> {
  const startTime = performance.now();
  const diagnostics = getWorkletDiagnostics(workletUrl);
  
  // Check basic support
  if (!diagnostics.audioContextSupported) {
    return {
      success: false,
      error: 'AudioContext not supported in this browser',
      diagnostics,
    };
  }
  
  if (!diagnostics.audioWorkletSupported) {
    return {
      success: false,
      error: 'AudioWorklet not supported in this browser',
      diagnostics,
    };
  }
  
  // Check file accessibility
  const accessibility = await checkWorkletAccessibility(workletUrl);
  if (!accessibility.ok) {
    return {
      success: false,
      error: `Worklet file not accessible: ${accessibility.error}. Check deployment and CORS settings.`,
      diagnostics,
    };
  }
  
  // Try to create AudioContext and load worklet
  try {
    const ctx = new AudioContext({ latencyHint: 'playback' });
    
    // Resume context (required for audio to work)
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    
    // Attempt to load worklet module
    await ctx.audioWorklet.addModule(workletUrl);
    
    const loadTimeMs = Math.round(performance.now() - startTime);
    
    // Clean up
    await ctx.close();
    
    return {
      success: true,
      loadTimeMs,
      diagnostics,
    };
  } catch (e) {
    const errorMsg = (e as Error).message || 'Unknown error';
    
    // Provide helpful error messages for common issues
    if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
      return {
        success: false,
        error: `Network error loading worklet: ${errorMsg}. Check CORS headers and network connectivity.`,
        diagnostics,
      };
    }
    
    if (errorMsg.includes('MIME') || errorMsg.includes('application/javascript')) {
      return {
        success: false,
        error: `MIME type error: ${errorMsg}. Ensure server serves .js files with Content-Type: application/javascript`,
        diagnostics,
      };
    }
    
    if (errorMsg.includes('registerProcessor')) {
      return {
        success: false,
        error: `Worklet registration error: ${errorMsg}. The worklet file may be corrupted or incompatible.`,
        diagnostics,
      };
    }
    
    return {
      success: false,
      error: `Worklet load failed: ${errorMsg}`,
      diagnostics,
    };
  }
}

/**
 * Run full diagnostics and output to console
 * Call this from browser console to debug worklet issues
 */
export async function runWorkletDiagnostics(workletUrl: string): Promise<void> {
  console.group('🔊 AudioWorklet Full Diagnostics');
  
  logWorkletDiagnostics(workletUrl);
  
  console.log('Testing worklet accessibility...');
  const accessibility = await checkWorkletAccessibility(workletUrl);
  if (accessibility.ok) {
    console.log('✅ Worklet file accessible (HTTP', accessibility.status + ')');
  } else {
    console.error('❌ Worklet file not accessible:', accessibility.error);
  }
  
  console.log('Testing worklet loading...');
  const result = await testWorkletLoading(workletUrl);
  if (result.success) {
    console.log('✅ Worklet loaded successfully in', result.loadTimeMs + 'ms');
  } else {
    console.error('❌ Worklet load failed:', result.error);
  }
  
  console.groupEnd();
}

// Export for use in browser console
declare global {
  interface Window {
    workletDiagnostics: {
      log: typeof logWorkletDiagnostics;
      test: typeof testWorkletLoading;
      run: typeof runWorkletDiagnostics;
      checkAccess: typeof checkWorkletAccessibility;
    };
  }
}

// Make available on window for debugging
if (typeof window !== 'undefined') {
  window.workletDiagnostics = {
    log: logWorkletDiagnostics,
    test: testWorkletLoading,
    run: runWorkletDiagnostics,
    checkAccess: checkWorkletAccessibility,
  };
}
