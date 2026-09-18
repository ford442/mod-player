# Export & Performance Capture

Creators can export audio and record performance clips from the player UI (**Export** panel in the right column).

## Features

| Feature | Implementation | Notes |
|---------|----------------|-------|
| **Offline WAV** | `workers/openmpt-export.worker.ts` + `utils/offlineRender.ts` | Renders in a dedicated worker; UI stays responsive |
| **Channel mute mask** | libopenmpt ext `interactive.set_channel_mute_status` | Toggle channels in Export panel; mutes apply only when ≥1 channel is muted |
| **Performance capture** | `MediaRecorder` + `canvas.captureStream()` + parallel audio tap | Saves WebM/MP4 depending on browser |

## Duration parity (acceptance)

Exported WAV length is compared to `openmpt_module_get_duration_seconds()` metadata. Export is considered successful when:

```
|renderedSeconds − metadataSeconds| ≤ 1/30 s   (one 30 fps frame)
```

The offline renderer uses 44.1 kHz stereo, Sinc+LP interpolation (`OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH` = 3, value 8), and `set_repeat_count(0)` for a single pass (no loop).

## Browser support matrix — canvas + audio recording

| Browser | Offline WAV | `canvas.captureStream` (WebGL2) | `canvas.captureStream` (WebGPU) | MediaRecorder VP9+Opus | Notes |
|---------|-------------|----------------------------------|----------------------------------|------------------------|-------|
| Chrome 120+ | ✅ | ✅ | ⚠️ Varies | ✅ `video/webm;codecs=vp9,opus` | Prefer `?renderer=webgl2` for reliable capture |
| Edge 120+ | ✅ | ✅ | ⚠️ Varies | ✅ | Same Chromium stack as Chrome |
| Firefox 115+ | ✅ | ✅ | ❌ / limited | ✅ VP8+Opus typical | WebGPU capture often unavailable |
| Safari 17+ | ✅ | ✅ | ❌ | ⚠️ Often `video/mp4` only | May need user gesture; test mime fallback |
| Mobile Chrome | ✅ | ⚠️ | ❌ | ⚠️ | High CPU; short clips recommended |
| Mobile Safari | ✅ | ⚠️ | ❌ | ⚠️ HEVC/MP4 | Audio tap requires active playback graph |

### COOP/COEP and AudioContext (native engine)

| Engine | Audio for recording | Guidance |
|--------|---------------------|----------|
| JS AudioWorklet | Tap `stereoPanner` → `MediaStreamDestination` in main `AudioContext` | **Required for capture** |
| ScriptProcessor fallback | Same main-context tap | Supported |
| Native C++ worklet | Same shared `AudioContext`; C++ node in the master graph | **Record clip works** (`?engine=native`) |

There is now exactly **one** `AudioContext` per page session, built by
`utils/audioContextFactory.ts` (`latencyHint` from the stage-mode / `?latency=`
profile, `sampleRate` locked to 48 000). Both engines attach to it — the C++
engine via `init_audio_with_context` — so MediaRecorder always taps the same
graph that is being heard and **no engine blocks Record clip**.

The old `?engine=native&nativeCtx=legacy` dual-context path (C++ owning a
second `AudioContext`, PCM bridged over a ring / MediaStream) has been removed.
It silently blocked capture and put the native frame clock in a different
domain from the main graph. The param is now ignored.

Offline WAV export never depended on any of this — it uses a worker, not
MediaRecorder.

Cross-origin isolation (`crossOriginIsolated`) is required for SharedArrayBuffer / native engine but does not block `MediaRecorder` when using the JS worklet path.

## API surface

```ts
// hooks/useOfflineExport.ts
exportWav({ fileData, fileName, muteMask?, startSeconds?, endSeconds? })

// hooks/usePerformanceCapture.ts
start({ getRenderer, audioContext, audioTapNode, preferWebGL2 })
stop() / cancel()
```

## Files

- `utils/audioContextFactory.ts` — the one `AudioContext` both engines share
- `utils/wavEncoder.ts` — PCM float → 16-bit WAV
- `utils/offlineRender.ts` — libopenmpt offline render loop
- `utils/libopenmptExt.ts` — interactive channel mute via ext interface
- `utils/performanceCapture.ts` — capture helpers + mime probing
- `components/ExportPanel.tsx` — UI

## Manual test checklist

1. Load `4-mat_madness.mod`, open Export panel, click **Download WAV** — file plays in an external player.
2. Mute channel 1, export again — kick/snare balance should change vs full mix.
3. Play module, click **Record clip**, wait ~5 s, **Stop** — WebM contains audio + visuals (WebGL2 renderer).
4. `?engine=native` — Record clip works without switching to JS, and no dual-context warning appears.
   The debug panel should report the same `AudioContext.state` / `sampleRate` (48 000) as a JS-engine
   play in the same tab; `?nativeCtx=legacy` is ignored.
5. Offline WAV still works on either engine (worker path).
