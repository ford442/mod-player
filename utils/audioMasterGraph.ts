/**
 * Master output chain (#453):
 *
 *   engine → masterInput → masterDirect → analyser → stereo panner → gain → destination
 *
 * Every engine (JS worklet, ScriptProcessor fallback) connects to `masterInput`,
 * never to the analyser. The FX rack (audio/fx/, lazy) attaches in parallel to
 * `masterDirect` — masterInput → rack → analyser — and owns `masterDirect.gain`.
 * With no rack attached (or the rack collapsed) the path is unity gain all the
 * way, so output is sample-identical to the pre-rack graph.
 */

export interface MasterLevelRefs {
  stereoPannerRef: { current: StereoPannerNode | null };
  gainNodeRef: { current: GainNode | null };
}

export interface MasterGraphRefs extends MasterLevelRefs {
  masterInputRef: { current: GainNode | null };
  masterDirectRef: { current: GainNode | null };
  analyserRef: { current: AnalyserNode | null };
}

/**
 * Assert masterInput → masterDirect → analyser → panner → gain → destination.
 *
 * Connect-only, and therefore idempotent: the Web Audio spec ignores a
 * connect() whose termini already exist. It never disconnects, so re-asserting
 * on every play / hot reload keeps parallel taps alive — the performance
 * capture's MediaStreamDestination on the panner, and the FX rack's edges.
 */
export function ensureMasterOutputChain(
  ctx: BaseAudioContext,
  refs: MasterGraphRefs,
): void {
  const input = refs.masterInputRef.current;
  const direct = refs.masterDirectRef.current;
  const analyser = refs.analyserRef.current;
  const panner = refs.stereoPannerRef.current;
  const gain = refs.gainNodeRef.current;
  if (!input || !direct || !analyser || !panner || !gain) return;

  input.connect(direct);
  direct.connect(analyser);
  analyser.connect(panner);
  panner.connect(gain);
  gain.connect(ctx.destination);
}

/** Disconnect and forget every master node (their context is closing or replaced). */
export function releaseMasterNodes(refs: MasterGraphRefs): void {
  const nodes = [
    refs.masterInputRef,
    refs.masterDirectRef,
    refs.analyserRef,
    refs.stereoPannerRef,
    refs.gainNodeRef,
  ] as const;
  for (const ref of nodes) {
    try { ref.current?.disconnect(); } catch { /* closed context */ }
    ref.current = null;
  }
}

/**
 * Write an AudioParam only when its value would change.
 *
 * The master chain must be sample-identical to the pre-rack graph, whose pan
 * and gain were each written exactly once. Chrome 156+ renders a StereoPanner
 * whose `pan.value` was written twice (before and after it was connected, even
 * to the same value) one float32 ulp off from a single write (5.96e-8 on the
 * fx-smoke null check; every Chrome up to 155 is exact). `AudioParam.value`
 * reads back float32, hence the `fround`.
 */
export function setParamIfChanged(param: AudioParam, value: number): void {
  if (param.value !== Math.fround(value)) param.value = value;
}

/** Apply UI volume (0–1) and pan (-1–1) to live master nodes. */
export function applyMasterLevels(
  refs: MasterLevelRefs,
  volume: number,
  pan: number,
): void {
  if (refs.gainNodeRef.current) {
    setParamIfChanged(refs.gainNodeRef.current.gain, volume);
  }
  if (refs.stereoPannerRef.current) {
    setParamIfChanged(refs.stereoPannerRef.current.pan, pan);
  }
}
