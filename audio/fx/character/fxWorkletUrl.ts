import fxCharacterVersion from '../../../audio-worklet/js/fx-character-version.generated.json';
import { detectRuntimeBase } from '../../../src/lib/paths';

/**
 * URL of the compiled character-stage worklet (#453). `?v=` is the content
 * hash written by scripts/build-js-worklet.mjs, so it changes exactly when the
 * processor does (AudioWorklet modules are cached aggressively).
 */
export function characterWorkletUrl(): string {
  return `${detectRuntimeBase()}worklets/fx-character-worklet.js?v=${fxCharacterVersion.version}`;
}
