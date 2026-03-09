import re

# Fix useLibOpenMPT.ts - replace tempCtx probe with API check
with open('hooks/useLibOpenMPT.ts', 'r') as f:
    content = f.read()

# Replace the tempCtx block
old_probe = '''try {
          console.log("[INIT] Testing AudioWorklet support...");
          const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
          await tempCtx.audioWorklet.addModule(WORKLET_URL);
          setIsWorkletSupported(true);
          setActiveEngine('worklet');
          await tempCtx.close();
          console.log('[INIT] AudioWorklet support confirmed');
        } catch (e) {
          console.warn("[INIT] AudioWorklet not available:", e);
          setIsWorkletSupported(false);
          setStatus("Error: AudioWorklet not supported in this browser/context.");
        }'''

new_probe = '''// AudioWorklet support check - API only, no early addModule()
        console.log("[INIT] Testing AudioWorklet support...");
        const AudioCtxClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioCtxClass && !!AudioCtxClass.prototype.audioWorklet) {
          setIsWorkletSupported(true);
          setActiveEngine('worklet');
          console.log('✅ [INIT] AudioWorklet support confirmed via API check');
        } else {
          console.warn("⚠️ [INIT] AudioWorklet not available");
          setIsWorkletSupported(false);
          setStatus("Error: AudioWorklet not supported in this browser.");
        }'''

if old_probe in content:
    content = content.replace(old_probe, new_probe)
    print("✅ Fixed tempCtx probe in useLibOpenMPT.ts")
else:
    print("⚠️ tempCtx pattern not found - checking content...")
    # Try simpler replacement
    content = content.replace(
        'const tempCtx = new (window.AudioContext || window.webkitAudioContext)();',
        '// Removed tempCtx - using API check only'
    )
    content = content.replace(
        'await tempCtx.audioWorklet.addModule(WORKLET_URL);',
        '// addModule() now only called during playback'
    )
    print("✅ Applied partial fix")

with open('hooks/useLibOpenMPT.ts', 'w') as f:
    f.write(content)

print("Done with useLibOpenMPT.ts")
