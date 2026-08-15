/**
 * #354 regression lock — behavioral tests that go RED if the production guards
 * for (a) position postMessage throttle and (b) hot-reload node reuse + load
 * token are weakened or removed.
 *
 * Prefer pure decision helpers (utils/workletAudioLifecycle.ts) + source
 * invariants over brittle full-hook mocks. Fake audio clock only — no sleeps.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readLibOpenMPTSources, readTransportActionsSource } from './helpers/libOpenMPTSource';
import { readAudioGraphSources } from './helpers/audioGraphSource';
import {
  WORKLET_POSITION_REPORT_HZ,
  WORKLET_POSITION_REPORT_INTERVAL_SEC,
  canReuseWorkletNode,
  countThrottledPositionReports,
  planJsWorkletHotReloadPlay,
  shouldAcceptWorkletLoadedAck,
  shouldDisconnectWorkletOnPlay,
  shouldForceWorkletModuleLoad,
  shouldPostInitLib,
  shouldReportWorkletPosition,
} from '../utils/workletAudioLifecycle';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// ── (a) Position postMessage cadence ≤ ~60 Hz ───────────────────────────────

describe('#354 position postMessage throttle (behavioral)', () => {
  it('allows a report when the interval has elapsed', () => {
    expect(shouldReportWorkletPosition(0, Number.NEGATIVE_INFINITY)).toBe(true);
    expect(shouldReportWorkletPosition(1 / 60, 0)).toBe(true);
    expect(shouldReportWorkletPosition(0.02, 0)).toBe(true); // 20 ms > 16.6 ms
  });

  it('suppresses reports inside the ~60 Hz window', () => {
    // 128-sample quantum @ 44.1 kHz ≈ 2.9 ms — far below 16.6 ms
    const quantum = 128 / 44100;
    expect(shouldReportWorkletPosition(quantum, 0)).toBe(false);
    expect(shouldReportWorkletPosition(1 / 60 - 1e-6, 0)).toBe(false);
  });

  it('caps reports to ≤~60 Hz over a simulated 1 s of audio quanta (fake clock)', () => {
    // Pre-fix flood: one postMessage per quantum → ~344 Hz at 128/44100.
    const unthrottled = countThrottledPositionReports({
      durationSec: 1,
      intervalSec: 0, // every quantum
    });
    expect(unthrottled).toBeGreaterThan(300);

    const throttled = countThrottledPositionReports({ durationSec: 1 });
    // Quantum-aligned checks land slightly under the ideal 60 Hz ceiling (never above).
    expect(throttled).toBeLessThanOrEqual(WORKLET_POSITION_REPORT_HZ + 1);
    expect(throttled).toBeGreaterThanOrEqual(50);
    expect(throttled).toBeLessThan(unthrottled / 4);
  });

  it('stays near 60 Hz across a longer simulated window', () => {
    const durationSec = 5;
    const reports = countThrottledPositionReports({ durationSec });
    const hz = reports / durationSec;
    // Must not flood; must still refresh UI often enough for playhead prediction.
    expect(hz).toBeLessThanOrEqual(WORKLET_POSITION_REPORT_HZ + 0.5);
    expect(hz).toBeGreaterThanOrEqual(50);
  });


  it('interval constant matches production worklet (1/60)', () => {
    expect(WORKLET_POSITION_REPORT_INTERVAL_SEC).toBeCloseTo(1 / 60, 12);
    expect(WORKLET_POSITION_REPORT_HZ).toBe(60);
  });
});

// ── (b) Hot reload: reuse node + load-token ack ─────────────────────────────

describe('#354 hot-reload node reuse + load token (behavioral)', () => {
  it('reuses the same JS worklet node on a second play (no disconnect)', () => {
    const cold = planJsWorkletHotReloadPlay({
      activeEngine: 'worklet',
      workletLoaded: false,
      hasWorkletNode: false,
      libJsText: 'glue',
      moduleToken: 1,
      lastSentToken: -1,
      forceModuleLoad: true,
    });
    expect(cold.reuseNode).toBe(false);
    expect(cold.disconnectNode).toBe(false);
    expect(cold.postInitLib).toBe(true);
    expect(cold.postModuleLoad).toBe(true);

    // Second load after processModuleData bumped the token and stopMusic(false)
    // left the node alive with workletLoaded still true.
    const hot = planJsWorkletHotReloadPlay({
      activeEngine: 'worklet',
      workletLoaded: true,
      hasWorkletNode: true,
      libJsText: 'glue',
      moduleToken: 2,
      lastSentToken: 1,
      forceModuleLoad: true,
    });
    expect(hot.reuseNode).toBe(true);
    expect(hot.disconnectNode).toBe(false);
    expect(hot.postInitLib).toBe(false);
    expect(hot.postModuleLoad).toBe(true);
  });

  it('simulates a two-load session: one node identity, zero disconnects on hot path', () => {
    let node: { id: number } | null = null;
    let nextId = 1;
    let disconnectCount = 0;
    let initLibCount = 0;
    let loadCount = 0;
    let lastSentToken = -1;

    const runPlay = (moduleToken: number, forceModuleLoad: boolean) => {
      const hasNode = node != null;
      const decision = planJsWorkletHotReloadPlay({
        activeEngine: 'worklet',
        workletLoaded: hasNode,
        hasWorkletNode: hasNode,
        libJsText: 'glue',
        moduleToken,
        lastSentToken,
        forceModuleLoad,
      });

      if (decision.disconnectNode && node) {
        disconnectCount += 1;
        node = null;
      }
      if (!node) {
        node = { id: nextId++ };
      }
      if (decision.postInitLib) initLibCount += 1;
      if (decision.postModuleLoad) {
        loadCount += 1;
        lastSentToken = moduleToken;
      }
      return node;
    };

    const first = runPlay(1, true);
    const second = runPlay(2, true);

    expect(first).toBe(second); // same object identity
    expect(disconnectCount).toBe(0);
    expect(initLibCount).toBe(1); // cold only
    expect(loadCount).toBe(2); // both modules delivered
    expect(lastSentToken).toBe(2);
  });

  it('ignores stale/mismatched loaded acks and honors the current token', () => {
    // After hot reload: we sent token 2; a late ack for token 1 must be dropped.
    expect(shouldAcceptWorkletLoadedAck(2, 1)).toBe(false);
    expect(shouldAcceptWorkletLoadedAck(2, 2)).toBe(true);
    expect(shouldAcceptWorkletLoadedAck(1, 1)).toBe(true);
    // Token advanced on main thread but load not yet posted — still mismatch.
    expect(shouldAcceptWorkletLoadedAck(3, 2)).toBe(false);
  });

  it('forceModuleLoad / token advance both require a fresh worklet load', () => {
    expect(shouldForceWorkletModuleLoad(5, 5, false)).toBe(false);
    expect(shouldForceWorkletModuleLoad(5, 5, undefined)).toBe(false);
    expect(shouldForceWorkletModuleLoad(5, 5, true)).toBe(true);
    expect(shouldForceWorkletModuleLoad(6, 5, false)).toBe(true);
    expect(shouldForceWorkletModuleLoad(6, 5, true)).toBe(true);
  });

  it('pre-fix disconnect behavior: cannot reuse ⇒ disconnect on play', () => {
    // If canReuseWorkletNode were always false (pre-#354 disconnect path),
    // an existing node would be torn down on every play.
    expect(shouldDisconnectWorkletOnPlay(true, false)).toBe(true);
    expect(shouldDisconnectWorkletOnPlay(true, true)).toBe(false);
    expect(
      canReuseWorkletNode({
        activeEngine: 'worklet',
        workletLoaded: true,
        hasWorkletNode: true,
      }),
    ).toBe(true);
    expect(shouldPostInitLib(true, 'glue')).toBe(false);
  });
});

// ── Source invariants — production must call the guards ─────────────────────

describe('#354 production source invariants', () => {
  const workletSource = readFileSync(join(ROOT, 'public/worklets/openmpt-worklet.js'), 'utf8');
  const useAudioGraph = readAudioGraphSources(ROOT);
  const useLibOpenMPT = readLibOpenMPTSources(ROOT);
  const useWorkletLoader = readFileSync(join(ROOT, 'hooks/useWorkletLoader.ts'), 'utf8');
  const lifecycle = readFileSync(join(ROOT, 'utils/workletAudioLifecycle.ts'), 'utf8');

  it('worklet throttles position posts at 1/60 s (not every quantum)', () => {
    expect(workletSource).toMatch(/positionReportInterval\s*=\s*1\s*\/\s*60/);
    expect(workletSource).toContain('lastPositionReportTime');
    // The interval check is hoisted into shouldReportPosition so the report-only
    // work (rowFraction, VU sweep) shares the same gate as the postMessage.
    expect(workletSource).toMatch(
      /shouldReportPosition\s*=\s*\n?\s*currentTime\s*-\s*this\.lastPositionReportTime\s*>=\s*this\.positionReportInterval/,
    );
    // Guard condition must gate postMessage({ type: WT.position
    const throttleBlock = workletSource.match(
      /if\s*\(\s*shouldReportPosition\s*\)\s*\{[\s\S]*?type:\s*WT\.position/,
    );
    expect(throttleBlock, 'position postMessage must sit inside the ~60 Hz throttle if').toBeTruthy();
    // Must not post position unconditionally every process() without the interval check nearby
    expect(workletSource).toMatch(/lastPositionReportTime\s*=\s*currentTime/);
  });

  it('report-only WASM queries stay behind the 60 Hz gate', () => {
    // get_time_at_position (up to 3 WASM calls) only feeds rowFraction in the
    // position post — it must not run on every quantum.
    expect(workletSource).toMatch(
      /if\s*\(\s*shouldReportPosition\s*\)\s*\{[\s\S]*?typeof lib\._openmpt_module_get_time_at_position/,
    );
    // Same for the up-to-32 per-channel VU queries.
    const vuBlock = workletSource.match(
      /if\s*\(\s*shouldReportPosition\s*\)\s*\{[\s\S]*?_openmpt_module_get_current_channel_vu_mono/,
    );
    expect(vuBlock, 'VU sweep must be sampled at report rate, not per quantum').toBeTruthy();
  });

  it('avoids per-quantum TypedArray/GC allocs in the sample copy path', () => {
    // subarray()+set allocated 2 views every quantum (~700 GC objects/s) and
    // contributed to skip→crackle cascades at pattern boundaries.
    expect(workletSource).not.toMatch(
      /\.set\(\s*this\._leftHeapView\.subarray/,
    );
    expect(workletSource).not.toMatch(
      /\.set\(\s*this\._rightHeapView\.subarray/,
    );
    // Manual element copy from cached heap views
    expect(workletSource).toMatch(/outL\[i\]\s*=\s*leftSrc\[i\]/);
    expect(workletSource).toMatch(/outR\[i\]\s*=\s*rightSrc\[i\]/);
    // VU array is grown once then reused (not `channelVU = []` + push each report)
    expect(workletSource).toContain('this._channelVuArr');
    expect(workletSource).not.toMatch(/channelVU\s*=\s*\[\s*\]\s*;/);
  });

  it('gates full audio-reactive SAB update behind the 60 Hz report path', () => {
    // Full IIR band-split every quantum ate into the ~2.9 ms budget at XM wraps.
    const processIdx = workletSource.lastIndexOf('process(_inputs, outputs, _parameters)');
    const processBody = workletSource.slice(processIdx);
    // _updateAudioReactive must only be called inside shouldReportPosition block
    const callIdx = processBody.indexOf('this._updateAudioReactive(');
    expect(callIdx).toBeGreaterThan(0);
    const beforeCall = processBody.slice(0, callIdx);
    // Nearest preceding shouldReportPosition gate
    expect(beforeCall).toMatch(/if\s*\(\s*shouldReportPosition\s*\)\s*\{[\s\S]*$/);
  });

  it('projectm-pcm blocks are opt-in, not posted unconditionally', () => {
    expect(workletSource).toContain('this._projectmPcmEnabled = false;');
    expect(workletSource).toMatch(/if\s*\(\s*this\._projectmPcmEnabled\s*\)/);
    expect(useAudioGraph).toContain('postSetProjectmPcm(hasProjectMConsumer())');
  });

  it('audioDiag timing mode is opt-in and reports wrap overruns', () => {
    expect(workletSource).toContain('this._audioDiag = false;');
    expect(workletSource).toMatch(/type:\s*WT\.audioDiag/);
    expect(useAudioGraph).toContain('postSetAudioDiag(isAudioDiagEnabled())');
    expect(useAudioGraph).toContain('__AUDIO_DIAG__');
  });

  it('play path uses shouldForceWorkletModuleLoad + shouldAcceptWorkletLoadedAck', () => {
    const jsDispatch = readFileSync(join(ROOT, 'audio-worklet/jsWorkletDispatch.ts'), 'utf8');
    expect(useAudioGraph).toContain('shouldForceWorkletModuleLoad');
    expect(useAudioGraph).toContain('dispatchWorkletToMainMessage');
    expect(jsDispatch).toContain('shouldAcceptWorkletLoadedAck');
    expect(useAudioGraph).toContain('canReuseWorkletNode');
    expect(useAudioGraph).toContain('Hot reload — keeping existing worklet wiring');
    // Stale-ack path must remain
    expect(useAudioGraph).toMatch(/Ignoring stale worklet loaded ack/);
  });

  it('processModuleData bumps load token and loadModule forces worklet load', () => {
    expect(useLibOpenMPT).toContain('workletModuleTokenRef.current += 1');
    expect(useLibOpenMPT).toContain('forceModuleLoad: true');
    expect(useLibOpenMPT).toContain('workletModuleTokenRef');
  });

  it('lifecycle module exports the #354 helpers used by tests and hooks', () => {
    expect(lifecycle).toContain('shouldReportWorkletPosition');
    expect(lifecycle).toContain('shouldAcceptWorkletLoadedAck');
    expect(lifecycle).toContain('shouldForceWorkletModuleLoad');
    expect(lifecycle).toContain('planJsWorkletHotReloadPlay');
    expect(lifecycle).toContain('WORKLET_POSITION_REPORT_INTERVAL_SEC');
  });

  it('WORKLET_VERSION stays cache-busted at ≥ 11 after audioDiag Date.now fix', () => {
    const m = useWorkletLoader.match(/WORKLET_VERSION\s*=\s*['"](\d+)['"]/);
    expect(m, 'WORKLET_VERSION must be defined').toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(11);
  });

  it('gates get_time_at_position + channel VU behind the position throttle (XM stutter)', () => {
    // Expensive helpers must not run every quantum — only inside the ~60 Hz report block.
    const throttleIdx = workletSource.indexOf(
      'currentTime - this.lastPositionReportTime >= this.positionReportInterval',
    );
    expect(throttleIdx).toBeGreaterThan(0);
    const afterThrottle = workletSource.slice(throttleIdx);
    expect(afterThrottle).toContain('_openmpt_module_get_time_at_position');
    expect(afterThrottle).toContain('_openmpt_module_get_current_channel_vu_mono');

    // Before the throttle check in process(), those calls must not appear.
    const processIdx = workletSource.lastIndexOf('process(_inputs, outputs, _parameters)');
    const processBody = workletSource.slice(processIdx, throttleIdx);
    expect(processBody).not.toContain('_openmpt_module_get_time_at_position');
    expect(processBody).not.toContain('_openmpt_module_get_current_channel_vu_mono');
    // Non-report quanta must also skip bpm/speed/order/position_seconds queries
    // (only last-reported values are reused) so pattern-boundary quanta free budget.
    expect(processBody).not.toContain('_openmpt_module_get_current_estimated_bpm');
    expect(processBody).not.toContain('_openmpt_module_get_current_speed');
  });

  it('uses real-time-friendly interpolation filter length 4 (not 8)', () => {
    expect(workletSource).toMatch(/_openmpt_module_set_render_param\(\s*this\.modulePtr\s*,\s*2\s*,\s*4\s*\)/);
    expect(workletSource).not.toMatch(/_openmpt_module_set_render_param\(\s*this\.modulePtr\s*,\s*2\s*,\s*8\s*\)/);
  });
});

// ── ScriptProcessor fallback structural immunity ────────────────────────────

describe('#354 ScriptProcessor fallback structural immunity', () => {
  const useAudioGraph = readAudioGraphSources(ROOT);
  const transportActions = readTransportActionsSource(ROOT);

  it('SP path updates position in-process (no worklet position postMessage flood)', () => {
    // ScriptProcessor onaudioprocess calls applyWorkletPositionSample directly —
    // there is no port.postMessage({ type: 'position' }) on that path.
    expect(useAudioGraph).toContain('createScriptProcessor');
    expect(useAudioGraph).toContain('applyWorkletPositionSample');
    // Large buffer ⇒ callback rate ≈ 44100/4096 ≈ 10.8 Hz ≪ 350 Hz flood.
    expect(useAudioGraph).toMatch(/SP_BUFFER\s*=\s*4096/);
  });

  it('stopMusic tears down ScriptProcessor on every stop/reload', () => {
    expect(transportActions).toContain('scriptProcessorRef.current.disconnect()');
    expect(transportActions).toContain('scriptProcessorRef.current = null');
    expect(transportActions).toContain('spFallbackTriggered.current = false');
  });
});
