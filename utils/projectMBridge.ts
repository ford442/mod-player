/**
 * Project-M popup integration bridge.
 * 
 * When mod-player is opened as a popup by project-M (via window.open()),
 * this module broadcasts PCM audio data over BroadcastChannel so the
 * project-M visualizer can receive the audio stream.
 */

/**
 * Start broadcasting PCM audio data to project-M via BroadcastChannel.
 * 
 * Only activates when opened as a popup (window.opener is set).
 * Broadcasts Float32Array PCM frames at ~60fps over BroadcastChannel('projectm-audio').
 * 
 * @param analyser - AnalyserNode from the audio graph
 * @returns cleanup function to stop broadcasting and close the channel
 */
export function startProjectMBridge(analyser: AnalyserNode | null): () => void {
  // Only broadcast when opened as a popup from another window
  if (!window.opener || !analyser) {
    return () => {};
  }

  console.log('[ProjectM] Detected popup context. Starting PCM broadcast...');

  const channel = new BroadcastChannel('projectm-audio');
  const analyserNode = analyser; // narrow type from AnalyserNode | null to AnalyserNode
  const buf = new Float32Array(analyserNode.fftSize);
  let rafId: number;

  function send() {
    analyserNode.getFloatTimeDomainData(buf);
    // Use slice() so the transfer doesn't detach the original buffer
    channel.postMessage({ type: 'pcm', buffer: buf.slice() });
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
