/**
 * Audio product-flow smoke — config + console tripwires (#380).
 *
 * Default module verified in hooks/useLibOpenMPT.ts: `4-mat_madness.mod`.
 * XM fixture: public/test.xm (same as visual-smoke MODULE_URLS).
 */

export const DEFAULT_MOD_PATH = '/4-mat_madness.mod';
export const XM_FIXTURE_PATH = '/test.xm';

/** Minimum wall-clock window (ms) to sample counter monotonicity. */
export const ADVANCE_SAMPLE_MS = Number(process.env.AUDIO_SMOKE_ADVANCE_MS || 2000);

/** Poll interval while waiting for counters to move. */
export const ADVANCE_POLL_MS = Number(process.env.AUDIO_SMOKE_POLL_MS || 200);

/** Fail when more than this many `ended` logs appear in one phase (runaway loop). */
export const MAX_ENDED_LOGS_PER_PHASE = Number(process.env.AUDIO_SMOKE_MAX_ENDED || 2);

/**
 * Console lines that should fail the smoke run.
 * Applied to both console.error and console.warn (audio diag overruns log as warn).
 */
export const AUDIO_CONSOLE_FAIL_PATTERNS = [
  /\[PLAY\]\s*Worklet error:/i,
  /Rejected worklet→main message/i,
  /Rejected worklet->main message/i,
  /Failed to load AudioWorklet module/i,
  /Failed to create\/load AudioWorkletNode/i,
  /Worklet WASM init failed/i,
  /\[WorkletLoader\].*Failed/i,
];

/** Count repeated ended messages — runaway `ended → seek 0` loop from #329. */
export const AUDIO_CONSOLE_ENDED_PATTERN = /\[PLAY\]\s*Worklet reported module ended/i;

/** Headless Chromium args — no WebGPU flags needed for audio-only smoke. */
export const AUDIO_CHROME_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,720',
];

export function buildAudioSmokeUrl(baseUrl, { audioDiag = true, engine = 'js', renderer = 'webgl2' } = {}) {
  const root = baseUrl.replace(/\/$/, '');
  const params = new URLSearchParams();
  params.set('renderer', renderer);
  params.set('engine', engine);
  if (audioDiag) params.set('audioDiag', '1');
  return `${root}/?${params.toString()}`;
}

export function classifyAudioConsole(lines, { maxEndedPerPhase = MAX_ENDED_LOGS_PER_PHASE } = {}) {
  const failures = [];
  const warnings = [];
  let endedCount = 0;

  for (const line of lines) {
    if (AUDIO_CONSOLE_ENDED_PATTERN.test(line)) {
      endedCount++;
      if (endedCount > maxEndedPerPhase) {
        failures.push(`runaway ended loop: ${line}`);
      }
      continue;
    }
    if (AUDIO_CONSOLE_FAIL_PATTERNS.some((re) => re.test(line))) {
      failures.push(line);
    }
  }

  return { failures, warnings, endedCount };
}
