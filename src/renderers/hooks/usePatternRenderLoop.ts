import { useEffect, useRef } from 'react';
import type { BloomPostProcessor } from '../../../utils/bloomPostProcessor';
import type { WebGPURenderParams } from '../params';

const THEME_TRANSITION_DURATION_MS = 400;

export interface UsePatternRenderLoopParams {
  isModuleLoaded: boolean;
  isPlaying: boolean;
  gpuReadyEffective: boolean;
  useWebGPU: boolean;
  useHTML: boolean;
  isOverlayActive: boolean;
  nightModeEnabled: boolean;
  analyserNode?: AnalyserNode | null;
  crtEnabledRef: React.MutableRefObject<boolean>;
  themeBlendRef: React.MutableRefObject<number>;
  nightModeTargetRef: React.MutableRefObject<number>;
  renderParamsRef: React.MutableRefObject<WebGPURenderParams>;
  bloomRef: React.MutableRefObject<BloomPostProcessor | null>;
  renderRef: React.MutableRefObject<(() => void) | undefined>;
  drawWebGL: () => void;
  setLocalTime: React.Dispatch<React.SetStateAction<number>>;
}

export function usePatternRenderLoop(params: UsePatternRenderLoopParams) {
  const {
    isModuleLoaded,
    isPlaying,
    gpuReadyEffective,
    useWebGPU,
    useHTML,
    isOverlayActive,
    analyserNode,
    crtEnabledRef,
    themeBlendRef,
    nightModeTargetRef,
    renderParamsRef,
    bloomRef,
    renderRef,
    drawWebGL,
    setLocalTime,
  } = params;

  const animationFrameRef = useRef<number>();
  const freqDataRef = useRef(new Uint8Array(256));

  useEffect(() => {
    let isActive = true;
    let lastTime = 0;
    const loop = (time: number) => {
      if (!isActive) return;
      animationFrameRef.current = requestAnimationFrame(loop);
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;
      const target = nightModeTargetRef.current;
      const current = themeBlendRef.current;
      if (Math.abs(current - target) > 0.001) {
        const speed = 1000 / THEME_TRANSITION_DURATION_MS;
        themeBlendRef.current = current + Math.sign(target - current) * Math.min(Math.abs(target - current), speed * dt);
        renderParamsRef.current.themeBlend = themeBlendRef.current;
      }
      if (!isModuleLoaded && !isPlaying) setLocalTime(time / 1000.0);
      if (analyserNode) {
        if (freqDataRef.current.length !== analyserNode.frequencyBinCount) {
          freqDataRef.current = new Uint8Array(analyserNode.frequencyBinCount);
        }
        analyserNode.getByteFrequencyData(freqDataRef.current);
      }
      if (gpuReadyEffective && !useHTML) {
        if (useWebGPU) {
          bloomRef.current?.updateCRT(crtEnabledRef.current ? 1.0 : 0.0);
        }
        renderRef.current?.();
      }
      if (isOverlayActive && isModuleLoaded && !useHTML) {
        drawWebGL();
      }
    };
    animationFrameRef.current = requestAnimationFrame(loop);
    return () => {
      isActive = false;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [
    isModuleLoaded, isPlaying, gpuReadyEffective, drawWebGL, useWebGPU, useHTML,
    isOverlayActive, analyserNode, crtEnabledRef, themeBlendRef, nightModeTargetRef,
    renderParamsRef, bloomRef, renderRef, setLocalTime,
  ]);
}
