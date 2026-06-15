/**
 * Project-M popup / iframe integration bridge.
 *
 * When mod-player is opened as a popup (window.opener) or embedded in an
 * iframe (window.parent !== window) by the project-M demo, this module
 * forwards time-domain PCM audio data so the visualizer can receive the
 * audio stream.
 *
 * Two delivery paths are supported:
 *
 *   ── New (preferred): worklet-driven PCM ──────────────────────────────────
 *   broadcastPcmBlock() is called from the AudioWorklet message handler
 *   whenever the worklet emits a 'projectm-pcm' block.  The PCM is rendered
 *   inside process() at audio-clock rate, so it carries no RAF jitter and
 *   contains authentic stereo samples straight from the WASM renderer.
 *   Block size is fixed (~512 samples) as required by Project-M.
 *
 *   ── Legacy (fallback): requestAnimationFrame + AnalyserNode ─────────────
 *   startProjectMBridge() starts a ~60 fps RAF loop that calls
 *   AnalyserNode.getFloatTimeDomainData().  This path is retained for
 *   non-worklet engines (ScriptProcessor fallback) and for backward
 *   compatibility, but suffers from variable block sizes, background-tab
 *   throttling, and mono-only output.
 *
 * Three delivery channels are used in parallel by both paths:
 *   1. BroadcastChannel('projectm-audio') – same-origin tabs / service workers
 *   2. window.opener.postMessage()         – popup launched via window.open()
 *   3. window.parent.postMessage()         – embedded iframe context
 */

/** Default FFT size used when the AnalyserNode hasn't been configured yet. */
const DEFAULT_FFT_SIZE = 2048;

/** Shape of every PCM message sent to project-M.
 *
 * `channels` is 1 (mono) for the legacy RAF path or 2 (interleaved stereo)
 * for the worklet-driven path.  Stereo buffers are laid out as
 * L0,R0, L1,R1, … so receivers can handle either width by checking this field.
 */
interface ProjectMPcmMessage {
  type: 'pcm';
  buffer: Float32Array;
  /** Number of audio channels: 1 = mono (legacy RAF path), 2 = interleaved stereo (worklet path). */
  channels: 1 | 2;
}

// ── Shared channel for worklet-driven PCM blocks ──────────────────────────────
// Lazily created on the first broadcastPcmBlock() call and kept open for the
// page lifetime (no cleanup needed since BroadcastChannel is low-weight and
// the worklet path is active as long as the page is alive).
let _workletPcmChannel: BroadcastChannel | null = null;

// ── Worklet-path liveness, used to suppress the legacy RAF path ───────────────
// broadcastPcmBlock() stamps this on every call. The legacy RAF send() loop
// checks it and stays silent while the worklet path is actively delivering
// blocks, so Project-M never receives duplicated (stereo worklet + mono RAF)
// PCM. If the worklet path falls silent (e.g. the engine switches to the
// ScriptProcessor fallback), the RAF path resumes within WORKLET_ACTIVE_WINDOW_MS.
let _lastWorkletBroadcast = 0;
const WORKLET_ACTIVE_WINDOW_MS = 250;

/**
 * Broadcast a pre-rendered PCM block to Project-M receivers.
 *
 * This is the new audio-clock-accurate path.  Call it from the AudioWorklet
 * message handler whenever a 'projectm-pcm' event arrives; the worklet has
 * already accumulated a fixed-size block (default 512 samples per channel)
 * so the block size is stable and the timing matches the audio render clock.
 *
 * The function is a no-op when the page is neither a popup nor an iframe,
 * so it is safe to call unconditionally.
 *
 * @param buffer   Float32Array of PCM samples (interleaved stereo or mono)
 * @param channels 2 for interleaved stereo (L0,R0,L1,R1,…), 1 for mono
 */
export function broadcastPcmBlock(buffer: Float32Array, channels: 1 | 2): void {
  const isPopup = !!window.opener;
  const isIframe = window.parent !== window;

  if (!isPopup && !isIframe) return;

  // Mark the worklet path as live so the legacy RAF loop yields to it.
  _lastWorkletBroadcast = performance.now();

  if (!_workletPcmChannel) {
    _workletPcmChannel = new BroadcastChannel('projectm-audio');
  }

  const msg: ProjectMPcmMessage = { type: 'pcm', buffer, channels };

  // 1. BroadcastChannel – reaches same-origin contexts
  _workletPcmChannel.postMessage(msg);

  // 2. Direct postMessage to opener (popup mode)
  if (isPopup) {
    try {
      window.opener.postMessage(msg, '*');
    } catch {
      // opener may be cross-origin or closed; ignore
    }
  }

  // 3. Direct postMessage to parent frame (iframe mode)
  if (isIframe) {
    try {
      window.parent.postMessage(msg, '*');
    } catch {
      // parent may be cross-origin; ignore
    }
  }
}

/**
 * Start broadcasting PCM audio data to project-M via the legacy RAF path.
 *
 * @deprecated Prefer the worklet-driven path (broadcastPcmBlock) which delivers
 * audio-clock-accurate fixed-size blocks without RAF jitter.  This function is
 * retained as a fallback for non-worklet engines (e.g. ScriptProcessorNode).
 *
 * Activates when:
 *   - opened as a popup (window.opener is set), OR
 *   - embedded in an iframe (window.parent !== window)
 *
 * Broadcasts Float32Array PCM frames at ~60fps via BroadcastChannel AND
 * direct postMessage to opener/parent so both use-cases are covered.
 *
 * The targetOrigin for postMessage is intentionally `'*'` because the
 * project-M demo can be hosted on any origin and the PCM samples contain no
 * sensitive user data.  Restrict this if the host origin becomes fixed.
 *
 * @param analyser - AnalyserNode from the audio graph
 * @returns cleanup function to stop broadcasting and close the channel
 */
export function startProjectMBridge(analyser: AnalyserNode | null): () => void {
  const isPopup = !!window.opener;
  const isIframe = window.parent !== window;

  if ((!isPopup && !isIframe) || !analyser) {
    return () => {};
  }

  console.log(
    `[ProjectM] Detected ${isPopup ? 'popup' : 'iframe'} context. Starting legacy RAF PCM broadcast...`
  );

  // Use a dedicated channel for the RAF path so it doesn't interfere with
  // the worklet-driven broadcastPcmBlock() channel.
  const channel = new BroadcastChannel('projectm-audio');
  const analyserNode = analyser;
  const buf = new Float32Array(analyserNode.fftSize || DEFAULT_FFT_SIZE);
  let rafId: number;

  function send() {
    // Yield to the worklet-driven path while it is actively delivering blocks.
    // broadcastPcmBlock() carries authentic fixed-size stereo straight from the
    // WASM renderer; sending the AnalyserNode tap on top of it would duplicate
    // PCM (mono + stereo) into the same receivers. Only fall back to this path
    // when the worklet has gone quiet (non-worklet engine / ScriptProcessor).
    if (performance.now() - _lastWorkletBroadcast < WORKLET_ACTIVE_WINDOW_MS) {
      rafId = requestAnimationFrame(send);
      return;
    }

    analyserNode.getFloatTimeDomainData(buf);
    // Use slice() so the transfer doesn't detach the reusable buffer
    const copy = buf.slice();
    // Legacy path always sends mono (channels: 1)
    const msg: ProjectMPcmMessage = { type: 'pcm', buffer: copy, channels: 1 };

    // 1. BroadcastChannel – reaches same-origin contexts
    channel.postMessage(msg);

    // 2. Direct postMessage to opener (popup mode)
    if (isPopup) {
      try {
        window.opener.postMessage(msg, '*');
      } catch {
        // opener may be cross-origin or closed; ignore
      }
    }

    // 3. Direct postMessage to parent frame (iframe mode)
    if (isIframe) {
      try {
        window.parent.postMessage(msg, '*');
      } catch {
        // parent may be cross-origin; ignore
      }
    }

    rafId = requestAnimationFrame(send);
  }

  rafId = requestAnimationFrame(send);
  console.log('[ProjectM] Legacy RAF PCM broadcast started');

  return () => {
    console.log('[ProjectM] Stopping legacy RAF PCM broadcast...');
    cancelAnimationFrame(rafId);
    channel.close();
  };
}
