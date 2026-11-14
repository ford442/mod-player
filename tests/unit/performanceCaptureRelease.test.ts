/**
 * Recording teardown: the canvas captureStream track is stopped (it used to keep a 30 fps capture
 * running after every recording), and the audio tap is released only after the recorder's final
 * flush (releasing it first cut off the tail).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCombinedCaptureStream, finishRecording, type StoppableRecorder } from '../../utils/performanceCapture';

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeTrack(kind: string) {
  return { kind, stop: vi.fn() };
}

class FakeMediaStream {
  constructor(private readonly tracks: ReturnType<typeof fakeTrack>[] = []) {}
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
}

describe('createCombinedCaptureStream cleanup', () => {
  it('disconnects the tap and stops the video and audio capture tracks', () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const videoTrack = fakeTrack('video');
    const audioTrack = fakeTrack('audio');
    const videoStream = new FakeMediaStream([videoTrack]) as unknown as MediaStream;
    const destination = { stream: new FakeMediaStream([audioTrack]) };
    const ctx = { createMediaStreamDestination: () => destination } as unknown as AudioContext;
    const tap = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;

    const { cleanupAudioTap } = createCombinedCaptureStream(videoStream, ctx, tap);
    cleanupAudioTap();

    expect(tap.disconnect).toHaveBeenCalledWith(destination);
    expect(videoTrack.stop).toHaveBeenCalled();
    expect(audioTrack.stop).toHaveBeenCalled();
  });
});

describe('finishRecording', () => {
  it('releases the capture only after the recorder has stopped', async () => {
    const order: string[] = [];
    let onStop: (() => void) | null = null;
    const recorder: StoppableRecorder = {
      state: 'recording',
      stop: () => {
        order.push('stop');
        // The final dataavailable + stop arrive asynchronously, like MediaRecorder's.
        setTimeout(() => { order.push('stopped'); onStop?.(); }, 0);
      },
      addEventListener: ((_type: string, listener: () => void) => { onStop = listener; }) as StoppableRecorder['addEventListener'],
    };
    await finishRecording(recorder, () => order.push('release'));
    expect(order).toEqual(['stop', 'stopped', 'release']);
  });

  it('still releases an already inactive recorder', async () => {
    const release = vi.fn();
    const recorder = { state: 'inactive', stop: vi.fn(), addEventListener: vi.fn() } as unknown as StoppableRecorder;
    await finishRecording(recorder, release);
    expect(release).toHaveBeenCalledTimes(1);
    expect(recorder.stop).not.toHaveBeenCalled();
  });
});
