/**
 * wasm_workers_tls.cpp – main-thread TLS repair for -sWASM_WORKERS builds (#491).
 *
 * Linked into every wasm that runs NativeEngine (the AudioWorklet build and
 * the Node benchmark), so they behave the same. Never part of the host build.
 */

// With -sWASM_WORKERS (and no pthreads) Emscripten sets the main thread's
// __tls_base but never calls __wasm_init_tls(), so the TLS relocations
// wasm-ld emits for thread_locals defined in other objects are never
// applied: on the main thread they resolve to their raw offset, i.e. an
// address near 0 (the far end of the stack, which sits first in memory).
// Native wasm exceptions keep the catch selector in one of them —
// libunwind's thread_local __wasm_lpad_context — so on the main thread
// every typed catch silently failed: libopenmpt's own
// `catch (const BitReader::eof&)` around IT sample decompression was
// skipped, and a truncated sample block came back as "unknown internal
// error" instead of a normal load (#491). Wasm Workers (the AudioWorklet
// thread) are initialised properly by the runtime.
//
// The fix applies the relocations once, before any constructor that could
// touch TLS, and only when the probe shows they are missing — so a runtime
// that does initialise TLS (pthreads, a fixed emsdk) is left alone.
extern "C" void __wasm_init_tls(void* memory);
extern "C" __attribute__((weak)) thread_local char __wasm_lpad_context;

__attribute__((constructor(101))) static void apply_main_thread_tls_relocations() {
    char* const base = static_cast<char*>(__builtin_wasm_tls_base());
    if (!base || !&__wasm_lpad_context) return;
    const char* ctx = &__wasm_lpad_context;
    if (ctx >= base && ctx < base + __builtin_wasm_tls_size()) return; // already relocated
    __wasm_init_tls(base);
}

