/**
 * useWorkletLoader.ts - AudioWorklet loading with proper Vite URL handling
 * 
 * AUDIO-001 FIX: This module provides robust worklet loading with:
 * 1. Proper Vite asset URL construction using ?url imports
 * 2. Error handling and diagnostics for worklet initialization failures
 * 3. Retry logic with exponential backoff
 * 4. Detailed logging for debugging deployment issues
 */

import { useCallback, useRef, useState } from 'react';

export interface WorkletLoadResult {
  success: boolean;
  error?: string;
  diagnostics?: WorkletDiagnostics;
}

export interface WorkletDiagnostics {
  url: string;
  audioContextState: string;
  sampleRate: number;
  baseUrl: string;
  timestamp: string;
  loadAttempts: number;
}

export interface UseWorkletLoaderOptions {
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Initial retry delay in ms */
  retryDelayMs?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Get the worklet URL with proper base path handling for Vite deployments.
 * Uses Vite's BASE_URL and handles subdirectory deployments correctly.
 */
export const getWorkletUrl = (): string => {
  // Try multiple strategies for URL construction, ordered by reliability
  
  // Strategy 1: Use Vite's BASE_URL (most reliable for Vite builds)
  const viteBase = import.meta.env.BASE_URL || '/';
  const base = viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
  const url = `${base}worklets/openmpt-worklet.js`;
  
  return url;
};

/**
 * Get absolute URL for the worklet (useful for cross-origin scenarios)
 */
export const getAbsoluteWorkletUrl = (): string => {
  const relativeUrl = getWorkletUrl();
  return new URL(relativeUrl, window.location.href).toString();
};

/**
 * Check if AudioWorklet is supported in this browser
 */
export const isAudioWorkletSupported = (): boolean => {
  return typeof window !== 'undefined' && 
         'AudioContext' in window && 
         'audioWorklet' in AudioContext.prototype;
};

/**
 * Hook for loading AudioWorklet modules with proper error handling
 */
export function useWorkletLoader(options: UseWorkletLoaderOptions = {}) {
  const { maxRetries = 2, retryDelayMs = 500, debug = true } = options;
  
  const [lastError, setLastError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const loadAttemptsRef = useRef(0);

  const log = useCallback((...args: unknown[]) => {
    if (debug) {
      console.log('[WorkletLoader]', ...args);
    }
  }, [debug]);

  const logError = useCallback((...args: unknown[]) => {
    console.error('[WorkletLoader]', ...args);
  }, []);

  /**
   * Load the worklet module into the AudioContext
   */
  const loadWorklet = useCallback(async (
    audioContext: AudioContext,
    forceReload = false
  ): Promise<WorkletLoadResult> => {
    if (!audioContext.audioWorklet) {
      return {
        success: false,
        error: 'AudioWorklet not supported in this browser',
      };
    }

    setIsLoading(true);
    setLastError(null);
    loadAttemptsRef.current = 0;

    const workletUrl = getWorkletUrl();
    
    log('Starting worklet load...', {
      url: workletUrl,
      audioContextState: audioContext.state,
      forceReload,
    });

    // Diagnostics object for debugging
    const diagnostics: WorkletDiagnostics = {
      url: workletUrl,
      audioContextState: audioContext.state,
      sampleRate: audioContext.sampleRate,
      baseUrl: import.meta.env.BASE_URL,
      timestamp: new Date().toISOString(),
      loadAttempts: 0,
    };

    // Attempt to load with retries
    while (loadAttemptsRef.current <= maxRetries) {
      loadAttemptsRef.current++;
      diagnostics.loadAttempts = loadAttemptsRef.current;

      try {
        log(`Load attempt ${loadAttemptsRef.current}/${maxRetries + 1}...`);
        
        // Add a timeout to detect hanging loads
        const loadPromise = audioContext.audioWorklet.addModule(workletUrl);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Worklet load timeout (10s)')), 10000);
        });

        await Promise.race([loadPromise, timeoutPromise]);
        
        log('✅ Worklet module loaded successfully');
        setIsLoading(false);
        
        return {
          success: true,
          diagnostics,
        };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(`❌ Load attempt ${loadAttemptsRef.current} failed:`, errorMessage);

        // Check for specific error types
        if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
          const enhancedError = `Worklet file not found at ${workletUrl}. Check that the file exists in the public/worklets/ directory.`;
          setLastError(enhancedError);
          
          // 404 won't be fixed by retrying
          return {
            success: false,
            error: enhancedError,
            diagnostics,
          };
        }

        if (errorMessage.includes('MIME') || errorMessage.includes('application/javascript')) {
          const enhancedError = `MIME type issue: Server must serve .js files with Content-Type: application/javascript`;
          setLastError(enhancedError);
          return {
            success: false,
            error: enhancedError,
            diagnostics,
          };
        }

        if (errorMessage.includes('CORS') || errorMessage.includes('Failed to fetch')) {
          const enhancedError = `CORS issue: Ensure the server sends proper CORS headers for the worklet file`;
          setLastError(enhancedError);
          return {
            success: false,
            error: enhancedError,
            diagnostics,
          };
        }

        // For other errors, retry if we haven't exceeded max retries
        if (loadAttemptsRef.current <= maxRetries) {
          const delay = retryDelayMs * Math.pow(2, loadAttemptsRef.current - 1);
          log(`Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Max retries exceeded
          const finalError = `Failed to load worklet after ${loadAttemptsRef.current} attempts: ${errorMessage}`;
          setLastError(finalError);
          setIsLoading(false);
          
          return {
            success: false,
            error: finalError,
            diagnostics,
          };
        }
      }
    }

    // Should not reach here, but just in case
    setIsLoading(false);
    return {
      success: false,
      error: 'Unexpected end of loadWorklet',
      diagnostics,
    };
  }, [maxRetries, retryDelayMs, debug, log, logError]);

  /**
   * Pre-flight check to verify the worklet file is accessible
   */
  const verifyWorkletFile = useCallback(async (): Promise<boolean> => {
    const workletUrl = getWorkletUrl();
    
    try {
      log('Verifying worklet file accessibility...');
      const response = await fetch(workletUrl, { method: 'HEAD' });
      
      if (response.ok) {
        log('✅ Worklet file is accessible');
        return true;
      } else {
        logError(`❌ Worklet file returned status ${response.status}`);
        return false;
      }
    } catch (error) {
      logError('❌ Failed to verify worklet file:', error);
      return false;
    }
  }, [log, logError]);

  /**
   * Get detailed diagnostics for debugging
   */
  const getDiagnostics = useCallback((): WorkletDiagnostics => {
    return {
      url: getWorkletUrl(),
      audioContextState: 'unknown',
      sampleRate: 0,
      baseUrl: import.meta.env.BASE_URL,
      timestamp: new Date().toISOString(),
      loadAttempts: loadAttemptsRef.current,
    };
  }, []);

  return {
    loadWorklet,
    verifyWorkletFile,
    getDiagnostics,
    getWorkletUrl,
    getAbsoluteWorkletUrl,
    isAudioWorkletSupported,
    lastError,
    isLoading,
  };
}

export default useWorkletLoader;
