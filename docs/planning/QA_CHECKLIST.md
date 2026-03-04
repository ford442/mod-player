# QA Checklist - MOD Player Release Readiness

This checklist ensures the MOD player meets quality standards before each release.

## ✅ Build & Type Safety

- [ ] `npm run build` completes without errors
- [ ] `npm run typecheck` passes with strict settings
- [ ] No TypeScript `any` types in new code
- [ ] WASM build script (`build-wasm.sh`) is executable and works

## ✅ Code Quality

- [ ] `npm run lint` passes (or has < 50 warnings)
- [ ] No `console.log` statements in production code (except error handling)
- [ ] No unused imports or variables
- [ ] All `TODO` comments have associated issue numbers

## ✅ WebGPU/WebGL Rendering

- [ ] Pattern display renders correctly in WebGPU mode (Chrome/Edge)
- [ ] Pattern display renders correctly in WebGL fallback mode
- [ ] Caps (frosted glass effect) render on top of pattern
- [ ] No visual glitches during resize
- [ ] Debug overlay (press 'D') shows correct values

## ✅ Audio Playback

- [ ] MOD files load and play correctly
- [ ] XM files load and play correctly
- [ ] AudioWorklet engine starts without errors
- [ ] No audio crackling or dropouts during playback
- [ ] Volume control works smoothly
- [ ] Seeking to different positions works

## ✅ UI/UX

- [ ] File drag-and-drop works
- [ ] File picker works on all supported browsers
- [ ] Playlist navigation (prev/next) works
- [ ] Play/pause toggle works correctly
- [ ] Channel meters display VU levels
- [ ] Pattern sequencer displays current pattern

## ✅ Browser Compatibility

- [ ] Chrome 120+ (WebGPU enabled)
- [ ] Edge 120+ (WebGPU enabled)
- [ ] Firefox (WebGL fallback)
- [ ] Safari 17+ (WebGL fallback)

## ✅ Performance

- [ ] 60fps maintained during playback
- [ ] No memory leaks (check DevTools Memory tab)
- [ ] Audio thread doesn't glitch under load

## ✅ Repository Hygiene

- [ ] No build artifacts in git (`dist/`, `build.log`, etc.)
- [ ] No IDE files in git (`.idea/`, `.vscode/`)
- [ ] Planning docs organized in `docs/planning/`
- [ ] `.gitignore` is up to date

## ✅ Deployment

- [ ] `dist/` folder contains all necessary assets
- [ ] Shaders are included in `dist/shaders/`
- [ ] WASM worklet files are present (if pre-built)
- [ ] No broken relative paths in deployed build

## Quick Smoke Test Commands

```bash
# Full build check
npm ci
npm run typecheck
npm run build

# WASM build (requires Emscripten)
source /opt/emsdk/emsdk_env.sh
./build-wasm.sh

# Dev server test
npm run dev
# Then open http://localhost:5173 and test playback
```

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Code Review | | | |
| QA Test | | | |
| Release Mgr | | | |
