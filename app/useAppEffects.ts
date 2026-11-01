import { useEffect } from 'react';
import { startProjectMBridge } from '../utils/projectMBridge';
import { startAnalyserAnalysis } from '../utils/audioAnalysisBus';
import { usesOscilloscope } from '../utils/shaderVersion';
import { usePlayerEngine, usePlayerEngineInstance } from '../hooks/usePlayerEngine';
import { useDisplayShader } from '../hooks/usePlayerView';
import { usePlayerUiStore } from '../store/playerUiStore';
import { useShaderPrefsStore } from '../store/shaderPrefsStore';

/** Theme attribute on <html>, and the steps-length reset for shaders without a steps control. */
export function useAppPresentationEffects(): void {
  const theme = usePlayerUiStore((s) => s.theme);
  const setStepsLength = useShaderPrefsStore((s) => s.setStepsLength);
  const { isStepsShader } = useDisplayShader();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!isStepsShader) setStepsLength(32);
  }, [isStepsShader, setStepsLength]);
}

/** Consumers of the engine's audio taps: the ProjectM bridge, the analysis bus fallback, the scope buffer. */
export function useAppAudioTaps(): void {
  const engine = usePlayerEngineInstance();
  const analyserNode = usePlayerEngine((s) => s.analyserNode);
  const { displayShaderFile } = useDisplayShader();

  useEffect(() => startProjectMBridge(analyserNode), [analyserNode]);

  // Fallback producer for the analysis bus. Parks itself while the WebGPU
  // compute pass is publishing, so on a GPU-capable session this costs one idle
  // RAF tick and no analyser reads; in lite mode it is the only producer.
  useEffect(() => startAnalyserAnalysis(analyserNode), [analyserNode]);

  useEffect(() => {
    if (usesOscilloscope(displayShaderFile)) engine.requestOscBuffer();
  }, [engine, displayShaderFile]);
}
