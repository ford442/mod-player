---
title: "P2: Instrument / sample inspector MVP (tables, waveforms, LED correlation)"
priority: P2
type: Feature
complexity: L
labels: [feature, library, visualization, enhancement]
---

## Problem / opportunity

XASM-1 is an excellent pattern visualizer but a weak **module inspector**. Metadata shows instrument names; sample PCM/loop data is not surfaced. Planning doc `docs/planning/instrument-inspector-mvp.md` already defines architecture: worker-side format parsers, downsampled waveforms, virtualized tables, correlation with v0.56+ instrument palette LEDs.

This turns the app from “player with pretty lights” into a creator/education tool without leaving the browser.

## Proposed solution

Follow the existing MVP plan:

1. **Worker extract** — format-specific sample extract (XM/IT/MOD/S3M) in parser worker; downsample to ~256 peaks; return `SampleInfo` / instrument table types.
2. **UI** — virtualized instrument + sample tables (`@tanstack/react-virtual` already installed); waveform canvas; selection state.
3. **Correlation** — highlight selected instrument on pattern viz / palette mode when shader supports it (`instrumentPalette`, `paletteMode`).
4. Wire through store/context (after issue 03) rather than expanding MainLayout props.

Reuse `tests/sampleExtract/` foundations if present.

## Acceptance criteria

- [ ] Loading a representative XM and IT shows instrument + sample lists without main-thread freezes
- [ ] Selecting a sample shows a downsampled waveform
- [ ] Selecting an instrument can emphasize matching notes/LEDs on at least one palette-capable shader (v0.56+)
- [ ] Unit tests cover extract/downsample for at least two formats
- [ ] Feature is discoverable in UI without breaking default play flow

## Dependencies / libraries

None new (virtualization + zustand already present). No new WASM APIs required — file parsers as planned.

## Notes

Builds on worker parse path and palette work already shipped. Defer full sample editing.
