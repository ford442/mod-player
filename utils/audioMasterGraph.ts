/** Master output chain: analyser → stereo panner → gain → destination. */

export interface MasterLevelRefs {
  stereoPannerRef: { current: StereoPannerNode | null };
  gainNodeRef: { current: GainNode | null };
}

export interface MasterGraphRefs extends MasterLevelRefs {
  analyserRef: { current: AnalyserNode | null };
}

/** Re-wire analyser → panner → gain → destination (idempotent). */
export function ensureMasterOutputChain(
  ctx: AudioContext,
  refs: MasterGraphRefs,
): void {
  const analyser = refs.analyserRef.current;
  const panner = refs.stereoPannerRef.current;
  const gain = refs.gainNodeRef.current;
  if (!analyser || !panner || !gain) return;

  try { analyser.disconnect(); } catch { /* ignore */ }
  try { panner.disconnect(); } catch { /* ignore */ }
  try { gain.disconnect(); } catch { /* ignore */ }

  analyser.connect(panner);
  panner.connect(gain);
  gain.connect(ctx.destination);
}

/** Apply UI volume (0–1) and pan (-1–1) to live master nodes. */
export function applyMasterLevels(
  refs: MasterLevelRefs,
  volume: number,
  pan: number,
): void {
  if (refs.gainNodeRef.current) {
    refs.gainNodeRef.current.gain.value = volume;
  }
  if (refs.stereoPannerRef.current) {
    refs.stereoPannerRef.current.pan.value = pan;
  }
}
