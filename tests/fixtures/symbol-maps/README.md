# Symbol-map fixtures

Hand-written `<pair>.<?v= key>.symbols` files in the format emscripten's `--emit-symbol-map` writes (`index:name`, one
function per line, imports first; C++ names keep their `::`). The keys (`f1x7ure0aa`, `f1x7ure0bb`)
are deliberately not real cache keys, so a test can never pick up a map from `vendor/symbol-maps/`
by accident. (No emsdk in the environment that wrote them; a real map from CI's
`libopenmpt-symbol-maps` artifact can replace them as long as the indices the tests use stay meaningful.) Used by `tests/unit/symbolicate.test.ts` and `tests/build/symbolicateCli.test.ts`.
