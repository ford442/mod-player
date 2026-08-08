/**
 * Pure helpers for audio smoke counter monotonicity (#380).
 * Imported by scripts/audio-smoke.mjs and Vitest (tests/audioSmokeCounters.test.ts).
 */

/** @typedef {{ positionSec: number|null, order: number|null, row: number|null, rowFraction: number|null, isPlaying: boolean, audioEngine: string|null, audioContextState: string|null }} PlaybackCounters */

/**
 * Parse SeekBar time text (`M:SS`) into seconds.
 * @param {string|null|undefined} text
 * @returns {number|null}
 */
export function parseSeekBarTime(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const match = /^(\d+):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return minutes * 60 + seconds;
}

/**
 * Build a composite playback fingerprint for monotonicity checks.
 * @param {PlaybackCounters} counters
 * @returns {string}
 */
export function counterFingerprint(counters) {
  const parts = [
    counters.positionSec != null ? `p:${counters.positionSec}` : null,
    counters.order != null ? `o:${counters.order}` : null,
    counters.row != null ? `r:${counters.row}` : null,
    counters.rowFraction != null ? `rf:${counters.rowFraction.toFixed(4)}` : null,
  ].filter(Boolean);
  return parts.join('|') || 'empty';
}

/**
 * True when at least one counter field moved forward meaningfully.
 * @param {PlaybackCounters} before
 * @param {PlaybackCounters} after
 * @returns {{ advanced: boolean, reason: string }}
 */
export function countersAdvanced(before, after) {
  if (after.positionSec != null && before.positionSec != null && after.positionSec > before.positionSec) {
    return { advanced: true, reason: `positionSec ${before.positionSec}→${after.positionSec}` };
  }
  if (after.order != null && before.order != null && after.order > before.order) {
    return { advanced: true, reason: `order ${before.order}→${after.order}` };
  }
  if (after.row != null && before.row != null && after.row !== before.row) {
    return { advanced: true, reason: `row ${before.row}→${after.row}` };
  }
  if (
    after.rowFraction != null &&
    before.rowFraction != null &&
    Math.abs(after.rowFraction - before.rowFraction) > 0.01
  ) {
    return { advanced: true, reason: `rowFraction ${before.rowFraction.toFixed(3)}→${after.rowFraction.toFixed(3)}` };
  }
  return {
    advanced: false,
    reason: `no movement: ${counterFingerprint(before)} → ${counterFingerprint(after)}`,
  };
}

/**
 * Fail when pattern-boundary quanta exceeded budget during a playback window.
 * @param {number} baseline
 * @param {{ wrapOverruns?: number }|null|undefined} after
 * @returns {{ ok: boolean, reason: string, delta: number }}
 */
export function checkWrapOverrunDelta(baseline, after) {
  const delta = (after?.wrapOverruns ?? 0) - baseline;
  if (delta > 0) {
    return { ok: false, reason: `wrapOverruns +${delta} (baseline=${baseline})`, delta };
  }
  return { ok: true, reason: `wrapOverruns stable at ${after?.wrapOverruns ?? baseline}`, delta };
}

/**
 * Fail when pattern-boundary quanta exceeded budget (?audioDiag=1) — absolute check.
 * @param {{ wrapOverruns?: number, totalOverruns?: number }|null|undefined} diag
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkAudioDiag(diag) {
  if (!diag) {
    return { ok: true, reason: 'audioDiag not populated yet' };
  }
  if ((diag.wrapOverruns ?? 0) > 0) {
    return { ok: false, reason: `wrapOverruns=${diag.wrapOverruns}` };
  }
  return { ok: true, reason: 'wrapOverruns=0' };
}

/**
 * Browser-side reader — injected via page.evaluate.
 * Keep in sync with tests/audioSmokeCounters.test.ts fixtures.
 */
export function readPlaybackCountersInBrowser() {
  const hooks = window.__TEST_HOOKS__;
  const diag = window.__AUDIO_DIAG__;
  const seekRoot = document.querySelector('.flex.items-center.gap-3.text-xs.font-mono.select-none');
  const timeText = seekRoot?.querySelector('span')?.textContent ?? null;

  const parseTime = (text) => {
    if (!text) return null;
    const trimmed = text.trim();
    const match = /^(\d+):(\d{2})$/.exec(trimmed);
    if (!match) return null;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    return minutes * 60 + seconds;
  };

  return {
    positionSec: parseTime(timeText),
    order: diag?.order ?? null,
    row: diag?.row ?? hooks?.getPlaybackRow?.() ?? null,
    rowFraction: hooks?.getPlaybackRowFraction?.() ?? null,
    isPlaying: hooks?.getIsPlaying?.() ?? false,
    audioEngine: hooks?.getAudioEngine?.() ?? null,
    audioContextState: hooks?.getAudioContextState?.() ?? null,
    audioDiag: diag
      ? {
          wrapOverruns: diag.wrapOverruns ?? 0,
          totalOverruns: diag.totalOverruns ?? 0,
          wrapMaxProcessMs: diag.wrapMaxProcessMs ?? 0,
          budgetMs: diag.budgetMs ?? 0,
          order: diag.order ?? null,
          row: diag.row ?? null,
        }
      : null,
  };
}
