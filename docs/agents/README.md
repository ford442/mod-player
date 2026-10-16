# Agent prompt templates

These are **prompts and operating notes for AI agents**, not specifications of the shipped player. They used
to sit in `docs/planning/`, which is for plans and feature specs a human would read.

| File | What it is |
|------|-----------|
| `001-sdf-spec.md`, `001a`–`001d` | Prompt chain that produces an SDF specification for a chassis design (`specs/<design>/…`) |
| `002-shader-gen.md` | Prompt: implement a spec as a WGSL shader (`src/shaders/<design>_chassis.wgsl` in the original pipeline) |
| `003-audio-reactive.md` | Prompt: add frequency-reactive animation to a static shader |
| `004-frontend-integrate.md` | Prompt: integrate the shader into the React app with bloom/FX |
| `resource-management.md` | How to run the parallel spec agents without starving a Codespace. Its `.kimi/tasks/…` paths refer to the agent runner's own task directory, which is not part of this repository |

They are kept as historical reference for how the polar-chassis shaders were produced. Nothing in the app, CI
or tests reads them. For current planning use `docs/planning/ROADMAP.md` and GitHub issues.
