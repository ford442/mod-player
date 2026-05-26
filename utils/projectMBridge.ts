/**
 * Project-M popup / iframe integration bridge.
 *
 * When mod-player is opened as a popup (window.opener) or embedded in an
 * iframe (window.parent !== window) by the project-M demo, this module
 * forwards time-domain PCM audio data so the visualizer can receive the
 * audio stream.
 *
 * Three delivery channels are used in parallel:
 *   1. BroadcastChannel('projectm-audio') – same-origin tabs / service workers
 *   2. window.opener.postMessage()         – popup launched via window.open()
 *   3. window.parent.postMessage()         – embedded iframe context
 */

/** Default FFT size used when the AnalyserNode hasn't been configured yet. */
const DEFAULT_FFT_SIZE = 2048;

/** Shape of every PCM message sent to project-M.
 *
 * `channels` is always 1 (mono) because getFloatTimeDomainData() returns a
 * single mono-mixed buffer.  The projectM receiver protocol expects this
 * field to be present so it can allocate the right number of sample arrays.
 */
interface ProjectMPcmMessage {
  type: 'pcm';
  buffer: Float32Array;
  /** Number of audio channels in the buffer (always mono / 1). */
  channels: 1;
}

/**
 * Start broadcasting PCM audio data to project-M.
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
    `[ProjectM] Detected ${isPopup ? 'popup' : 'iframe'} context. Starting PCM broadcast...`
  );

  const channel = new BroadcastChannel('projectm-audio');
  const analyserNode = analyser;
  const buf = new Float32Array(analyserNode.fftSize || DEFAULT_FFT_SIZE);
  let rafId: number;

  function send() {
    analyserNode.getFloatTimeDomainData(buf);
    // Use slice() so the transfer doesn't detach the reusable buffer
    const copy = buf.slice();
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
  console.log('[ProjectM] PCM broadcast started');

  return () => {
    console.log('[ProjectM] Stopping PCM broadcast...');
    cancelAnimationFrame(rafId);
    channel.close();
  };
}
