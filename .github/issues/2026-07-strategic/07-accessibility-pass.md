---
title: "P2: Accessibility pass (reduced motion, contrast, color-blind, SR transport)"
priority: P2
type: Feature
complexity: M
labels: [feature, ui, enhancement]
---

## Problem / opportunity

Prior tracker item **#317** (closed/unfiled in current empty tracker) still matches product need: the player is highly visual (bloom, night modes, LED palettes) with limited accommodation for reduced motion, high contrast, color-vision deficiency, or screen-reader users of transport controls.

A visual-only slice was sketched in `weekly_plan.md` (reduced-motion + color-blind palettes + high-contrast) as intentionally decoupled from the audio path.

## Proposed solution

Ship in two slices:

### Slice A — Visual (safe, shader-adjacent)
1. Respect `prefers-reduced-motion`: gate bloom pulse, CRT, non-essential animation uniforms via registry/meta flags.
2. Add color-blind-safe palette presets (`utils/accessiblePalettes.ts`) selectable in settings.
3. High-contrast theme tokens in CSS variable system (`index.css` themes).

### Slice B — Transport a11y
1. Ensure play/stop/seek/volume controls have correct ARIA roles/labels.
2. Live region announcements for load/error/playing state (careful: don’t spam 60 Hz).
3. Keyboard path already strong (`useKeyboardShortcuts`) — document + ensure focus order with canvas hit-test UI.

Prefer landing Slice A after MainLayout store (issue 03) so settings don’t add more props.

## Acceptance criteria

- [ ] Reduced-motion preference disables or softens non-essential motion (documented behavior)
- [ ] At least one color-blind-safe palette + high-contrast theme available
- [ ] Primary transport controls are keyboard operable and labeled for AT
- [ ] No regression to default visual look when a11y options are off
- [ ] Docs: short a11y section in README or `docs/SHADER_UI_GUIDE.md`

## Dependencies / libraries

None required. Optional: axe-core / `@axe-core/playwright` for CI smoke (only if team wants; not mandatory for MVP).

## Notes

Grounded in prior #317 scope; do not invent a full WCAG audit product — ship the highest-impact accommodations first.
